import { describe, it, expect } from "vitest";
import { runwayClosureRead } from "../lib/runwayClosure";
import { upcomingClosureLine } from "../lib/limfac";

// OJAQ's construction closure (2026-11-02, "OJAQ only has one runway, why am I
// getting this for routine construction"). Monday 0600Z: the MON 1400-1700
// occurrence is ~8 h off.
const REAL = "A0467/26 RWY CLSD DUE TO CONST WORK EXC EMERG AND SPECIAL FLT. SUN TUE WED 1400 - 1800, MON 1400 - 1700, 20 SEP 14:00 2026 UNTIL 18 NOV 18:00 2026. CREATED: 14 SEP 12:02 2026";
const MON_0600 = Date.parse("2026-11-02T06:00:00Z");
const MON_1500 = Date.parse("2026-11-02T15:00:00Z");
const notam = (text: string, start = "2026-09-20T14:00:00Z", end = "2026-11-18T18:00:00Z") =>
  ({ category: "runway", rank: 0, text, start, end, runwaysClosed: ["ALL"] });

describe("runwayClosureRead — timing × runway count", () => {
  it("a scheduled closure 8 h out is not a closure now: amber for the sole runway, said as the field closing for the window", () => {
    const r = runwayClosureRead(notam(REAL), MON_0600, 1, "RWY 01/19");
    expect(r.timing).toBe("soon");
    expect(r.severity).toBe("amber");
    expect(r.sole).toBe(true);
    expect(r.routine).toBe(true);
    expect(r.text).toMatch(/^Sole runway RWY 01\/19 closes 1400–1700Z \(in ~8 h, scheduled works\) — field closed for that window, open outside it$/);
    expect(r.text).not.toMatch(/single-runway/i);
  });
  it("inside the occurrence the sole runway closed is RED and says the field is closed", () => {
    const r = runwayClosureRead(notam(REAL), MON_1500, 1, "RWY 01/19");
    expect(r.timing).toBe("now");
    expect(r.severity).toBe("red");
    expect(r.text).toMatch(/CLOSED until 1700Z .* field closed/);
  });
  it("an undesignated RWY CLSD is THE runway even with no count", () => {
    const r = runwayClosureRead(notam(REAL), MON_1500, 0, "RWY");
    expect(r.sole).toBe(true);
    expect(r.severity).toBe("red");
  });
  it("one of several runways: amber now, a note (green) while still to come", () => {
    const t = "RWY 16R/34L CLSD DUE WIP";
    const now = runwayClosureRead({ category: "runway", rank: 0, text: t, start: "2026-11-02T05:00:00Z", end: "2026-11-02T09:00:00Z" }, MON_0600, 2, "RWY 16R/34L");
    expect(now).toMatchObject({ timing: "now", severity: "amber" });
    expect(now.text).toMatch(/1 other runway open/);
    const later = runwayClosureRead({ category: "runway", rank: 0, text: t, start: "2026-11-02T12:00:00Z", end: "2026-11-02T14:00:00Z" }, MON_0600, 2, "RWY 16R/34L");
    expect(later).toMatchObject({ timing: "soon", severity: "green" });
  });
  it("an unknown count never assumes a second runway", () => {
    const r = runwayClosureRead({ category: "runway", rank: 0, text: "RWY 09/27 CLSD", start: "2026-11-02T05:00:00Z", end: "2026-11-02T09:00:00Z" }, MON_0600, 0, "RWY 09/27");
    expect(r.severity).toBe("red");
    expect(r.text).toMatch(/runway count UNKNOWN/);
  });
  it("a schedule whose next occurrence is past 48 h is a note, never red", () => {
    const fri = Date.parse("2026-11-06T06:00:00Z");   // Fri 0600 → next is Sun 1400 (56 h)
    const r = runwayClosureRead(notam(REAL), fri, 1, "RWY 01/19");
    expect(r).toMatchObject({ timing: "later", severity: "green" });
  });
  it("a standing closure with no times is in effect now", () => {
    const r = runwayClosureRead({ category: "runway", rank: 0, text: "RWY 01/19 CLSD" }, MON_0600, 1, "RWY 01/19");
    expect(r).toMatchObject({ timing: "now", severity: "red" });
  });
});

describe("upcomingClosureLine — the SITREP's sentence states the runway count", () => {
  const base = { label: "RWY 01/19", window: "1400–1700Z", startsInH: 8, recurring: true, routine: true };
  it("sole runway: field closed for the window, never single-runway", () => {
    const s = upcomingClosureLine({ ...base, sole: true, runwayCount: 1 });
    expect(s).toBe("sole runway RWY 01/19 closes 1400–1700Z (in ~8 h; scheduled works, recurring NOTAM) — no launch or recovery inside that window, field open outside it");
  });
  it("several runways names the others; unknown count says so", () => {
    expect(upcomingClosureLine({ ...base, sole: false, runwayCount: 3 })).toMatch(/2 other runways stay open/);
    expect(upcomingClosureLine({ ...base, sole: false, runwayCount: 2 })).toMatch(/the other runway stays open/);
    expect(upcomingClosureLine({ ...base, sole: false, runwayCount: 0 })).toMatch(/runway count UNKNOWN/);
  });
});
