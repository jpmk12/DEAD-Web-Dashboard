import { describe, it, expect } from "vitest";
import { closureWindows, windowConflicts, windowLabel, parseNotamSchedule, type ClosureWindow } from "../lib/sitrepSignals";
import type { TafSegment } from "../lib/sitrepSignals";

const NOW = Date.UTC(2026, 6, 6, 6, 0);           // 06Z
const H = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const notam = (text: string, category = "runway", start?: number, end?: number) => ({
  category, rank: 1, text,
  ...(start !== undefined ? { start: iso(start) } : {}),
  ...(end !== undefined ? { end: iso(end) } : {}),
});

describe("closureWindows", () => {
  it("builds a clamped bar from B)/C) times and classifies the kind", () => {
    const w = closureWindows([notam("RWY 06/24 CLSD DUE WIP", "runway", NOW + 7.5 * H, NOW + 16 * H)], NOW);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ label: "RWY 06/24", kind: "closure", openEnded: false });
    expect(w[0].fromMs).toBe(NOW + 7.5 * H);
    expect(w[0].toMs).toBe(NOW + 16 * H);
  });

  it("open-ended (no C) end) runs to the horizon and is flagged; no times at all → excluded", () => {
    const w = closureWindows([notam("TWY A CLSD", "taxiway", NOW - 2 * H)], NOW, 48);
    expect(w).toHaveLength(1);
    expect(w[0].openEnded).toBe(true);
    expect(w[0].fromMs).toBe(NOW);                       // clamped: already in effect
    expect(w[0].toMs).toBe(NOW + 48 * H);
    expect(closureWindows([notam("RWY 18/36 CLSD")], NOW)).toHaveLength(0);
  });

  it("flags a bounded window whose end falls past the horizon as beyondHorizon (not openEnded)", () => {
    const w = closureWindows([notam("RWY 06/24 CLSD", "runway", NOW - 1 * H, NOW + 200 * H)], NOW, 48);
    expect(w).toHaveLength(1);
    expect(w[0].openEnded).toBe(false);        // it HAS a C) end…
    expect(w[0].beyondHorizon).toBe(true);     // …but it's past +48h
    expect(w[0].toMs).toBe(NOW + 48 * H);       // clamped to the edge
    // A window ending inside the horizon is neither.
    const inside = closureWindows([notam("RWY 06/24 CLSD", "runway", NOW, NOW + 6 * H)], NOW, 48);
    expect(inside[0].beyondHorizon).toBe(false);
    expect(inside[0].openEnded).toBe(false);
  });

  it("skips expired, beyond-horizon, and non-window NOTAMs", () => {
    const w = closureWindows([
      notam("RWY 06/24 CLSD", "runway", NOW - 10 * H, NOW - 2 * H),          // expired
      notam("TWY B CLSD", "taxiway", NOW + 50 * H, NOW + 60 * H),            // starts past horizon
      notam("CRANE 120FT AGL 1NM E AD", "obstacle", NOW, NOW + 5 * H),       // not a window pattern
    ], NOW, 48);
    expect(w).toHaveLength(0);
  });

  it("does NOT bar lighting-component outages (covert/RAI/edge lights U/S) — they stay text rows", () => {
    const w = closureWindows([
      notam("RWY 06/24 COVERT LGTS OTS", "lighting", NOW - 1 * H, NOW + 40 * H),
      notam("RWY 24 RWY ALIGNMENT INDICATOR LGT UNSERVICEABLE", "lighting", NOW - 1 * H, NOW + 40 * H),
      notam("PAPI RWY 06 U/S", "lighting", NOW, NOW + 6 * H),
    ], NOW, 48);
    expect(w).toHaveLength(0);
  });

  it("still bars an electronic NAVAID or whole-surface U/S (not lighting)", () => {
    const w = closureWindows([
      notam("ILS RWY 24 U/S", "navaid", NOW + 1 * H, NOW + 6 * H),
      notam("RWY 06/24 U/S DUE STANDING WATER", "runway", NOW + 1 * H, NOW + 6 * H),
    ], NOW, 48);
    expect(w).toHaveLength(2);
    expect(w.every((x) => x.kind === "unserviceable")).toBe(true);
  });

  it("classifies unserviceable and fuel-limited kinds; closures sort first", () => {
    const w = closureWindows([
      notam("ILS RWY 24 U/S", "navaid", NOW + 19 * H, NOW + 31 * H),
      notam("JET A1 FUEL LIMITED", "services", NOW + 1 * H, NOW + 5 * H),
      notam("AD CLSD EXC EMERG", "services", NOW + 2 * H, NOW + 4 * H),
    ], NOW);
    expect(w.map((x) => x.kind)).toEqual(["closure", "unserviceable", "limited"]);
    expect(w[0].label).toBe("Airfield");
    expect(w[1].label).toBe("ILS RWY 24");
    expect(w[2].label).toBe("Fuel");
  });
});

describe("windowLabel", () => {
  it("extracts asset labels from NOTAM text", () => {
    expect(windowLabel("RWY 08L/26R CLSD", "runway")).toBe("RWY 08L/26R");
    expect(windowLabel("TWY A3 CLSD BTN TWY A AND APRON", "taxiway")).toBe("TWY A3");
    expect(windowLabel("VOR U/S", "navaid")).toBe("VOR");
  });

  it("labels common non-runway subjects instead of the bucket name", () => {
    expect(windowLabel("GPS RAIM OUTAGE PREDICTED", "other")).toBe("GPS / RAIM");
    expect(windowLabel("OBST CRANE ERECTED 1.2NM SW", "other")).toBe("Obstacle");
    expect(windowLabel("PJE WI 5NM RADIUS", "other")).toBe("Parachute (PJE)");
    expect(windowLabel("UAS ACT WI 3NM", "other")).toBe("UAS / drone");
    expect(windowLabel("TFR ACT", "airspace")).toBe("Airspace");
    expect(windowLabel("ACFT PARKING STANDS 1-4 CLSD", "other")).toBe("Parking");
  });

  it("falls back to a text snippet — never the useless bucket word 'Other'", () => {
    const label = windowLabel("SFC MARKINGS OBSCURED DUE SNOW COVERAGE", "other");
    expect(label).not.toBe("Other");
    expect(label.startsWith("SFC MARKINGS")).toBe(true);
    expect(label.endsWith("…")).toBe(true);
    expect(label.endsWith(" …")).toBe(false); // trailing space trimmed before the ellipsis
    // Short subjects render whole, without an ellipsis.
    expect(windowLabel("DECLARED DIST AMENDED", "other")).toBe("DECLARED DIST AMENDED");
  });
});

describe("windowConflicts", () => {
  const seg = (cat: TafSegment["cat"], fromH: number, toH: number): TafSegment =>
    ({ cat, fromMs: NOW + fromH * H, toMs: NOW + toH * H, label: "" });
  const win = (label: string, kind: ClosureWindow["kind"], fromH: number, toH: number): ClosureWindow =>
    ({ label, kind, fromMs: NOW + fromH * H, toMs: NOW + toH * H, openEnded: false, beyondHorizon: false, text: "" });

  it("flags a runway closure overlapping forecast IFR, ignores non-overlap and non-runway", () => {
    const conflicts = windowConflicts(
      [win("RWY 06/24", "closure", 7.5, 16), win("TWY A", "closure", 7.5, 16), win("ILS RWY 24", "unserviceable", 8, 12)],
      [seg("VFR", 0, 11), seg("IFR", 11, 18)],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain("RWY 06/24 closure");
    expect(conflicts[0]).toContain("IFR");
    // no overlap → no conflict
    expect(windowConflicts([win("RWY 06/24", "closure", 0, 4)], [seg("IFR", 11, 18)])).toHaveLength(0);
  });

  it("picks the worst overlapping category", () => {
    const c = windowConflicts(
      [win("Airfield", "closure", 6, 20)],
      [seg("IFR", 7, 10), seg("LIFR", 12, 14)],
    );
    expect(c[0]).toContain("LIFR");
  });
});

// ── NOTAM activity schedules ────────────────────────────────────────────────
// Regression: a construction closure whose B)/C) span is two months but whose
// E) text restricts it to a few hours on a few weekdays. Painting the validity
// span drew a solid 48-h CLOSED bar and drove a permanent single-runway CCIR.
const REAL = "A0467/26 RWY CLSD DUE TO CONST WORK EXC EMERG AND SPECIAL FLT. SUN TUE WED 1400 - 1800, MON 1400 - 1700, 20 SEP 14:00 2026 UNTIL 18 NOV 18:00 2026. CREATED: 14 SEP 12:02 2026";

describe("parseNotamSchedule", () => {
  it("reads multi-clause day/hour schedules and ignores the validity dates", () => {
    const rules = parseNotamSchedule(REAL)!;
    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual({ days: [0, 2, 3], startMin: 14 * 60, endMin: 18 * 60 }); // SUN TUE WED
    expect(rules[1]).toEqual({ days: [1], startMin: 14 * 60, endMin: 17 * 60 });       // MON
  });

  it("handles DAILY and weekday ranges; no day token at all → null (continuous)", () => {
    expect(parseNotamSchedule("RWY CLSD DAILY 0600-0800")![0].days).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(parseNotamSchedule("TWY A CLSD MON-FRI 0800-1600")![0].days).toEqual([1, 2, 3, 4, 5]);
    expect(parseNotamSchedule("RWY 06/24 CLSD DUE WIP")).toBeNull();
    // Validity dates alone must not be mistaken for a schedule.
    expect(parseNotamSchedule("RWY CLSD 20 SEP 14:00 2026 UNTIL 18 NOV 18:00 2026")).toBeNull();
  });

  it("day token present but times unreadable → [] (schedule exists, unparseable)", () => {
    expect(parseNotamSchedule("RWY CLSD MON THU AS PUBLISHED BY NOTAM")).toEqual([]);
  });
});

describe("closureWindows — scheduled closures", () => {
  // Tue 22 Sep 2026 06:48Z, inside the NOTAM's 20 Sep – 18 Nov validity.
  const TUE = Date.UTC(2026, 8, 22, 6, 48);
  const sched = [notam(REAL, "runway", Date.UTC(2026, 8, 20, 14, 0), Date.UTC(2026, 10, 18, 18, 0))];

  it("emits one bar per occurrence, not one spanning the validity", () => {
    const w = closureWindows(sched, TUE, 48);
    // Horizon Tue 06:48Z → Thu 06:48Z covers Tue and Wed only; Thu is not in
    // the schedule, so exactly two 4-hour bars.
    expect(w).toHaveLength(2);
    expect(w.every((x) => x.recurring === true)).toBe(true);
    expect(w[0].fromMs).toBe(Date.UTC(2026, 8, 22, 14, 0));
    expect(w[0].toMs).toBe(Date.UTC(2026, 8, 22, 18, 0));
    expect(w[1].fromMs).toBe(Date.UTC(2026, 8, 23, 14, 0));
    expect(w[1].toMs).toBe(Date.UTC(2026, 8, 23, 18, 0));
    // The bug: nothing may claim the runway is shut right now.
    expect(w.some((x) => x.fromMs <= TUE && x.toMs > TUE)).toBe(false);
  });

  it("MON uses its own shorter 1400-1700 clause", () => {
    const w = closureWindows(sched, Date.UTC(2026, 8, 21, 6, 0), 24);   // Mon
    expect(w).toHaveLength(1);
    expect(w[0].toMs).toBe(Date.UTC(2026, 8, 21, 17, 0));
  });

  it("no occurrence inside the horizon → no bar at all", () => {
    // Thu 24 Sep 06:00Z → Fri 06:00Z: neither day is in the schedule.
    expect(closureWindows(sched, Date.UTC(2026, 8, 24, 6, 0), 24)).toHaveLength(0);
  });

  it("clips an occurrence already under way to now", () => {
    const w = closureWindows(sched, Date.UTC(2026, 8, 22, 15, 0), 6);   // mid-closure
    expect(w[0].fromMs).toBe(Date.UTC(2026, 8, 22, 15, 0));
    expect(w[0].toMs).toBe(Date.UTC(2026, 8, 22, 18, 0));
  });

  it("unparseable schedule is marked indeterminate and never counts as a conflict", () => {
    const w = closureWindows(
      [notam("RWY 06/24 CLSD MON THU AS PUBLISHED", "runway", TUE - H, TUE + 200 * H)], TUE, 48);
    expect(w).toHaveLength(1);
    expect(w[0].indeterminate).toBe(true);
    const ifr: TafSegment[] = [{ cat: "IFR", fromMs: TUE, toMs: TUE + 12 * H, label: "06Z" }];
    expect(windowConflicts(w, ifr)).toEqual([]);
  });

  it("a genuinely continuous closure still draws one bar", () => {
    const w = closureWindows([notam("RWY 06/24 CLSD DUE WIP", "runway", TUE - H, TUE + 10 * H)], TUE, 48);
    expect(w).toHaveLength(1);
    expect(w[0].recurring).toBeUndefined();
    expect(w[0].fromMs).toBe(TUE);
  });
});
