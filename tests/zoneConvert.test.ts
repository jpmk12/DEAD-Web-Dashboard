import { describe, expect, it } from "vitest";
import { resolveWall, wallToMs, inZone } from "@/lib/plannerTools";
import {
  offsetAt, dstInfo, dstWord, zoneChanges, nextZoneChange, zoneChangeLine,
  zoneAbbrev, resolveZoneInput, cityOf, allZones,
} from "@/lib/zoneConvert";

const NY = "America/New_York";

describe("resolveWall", () => {
  it("an ordinary time is one instant and agrees with wallToMs", () => {
    const r = resolveWall("2026-07-04", "14:00", NY)!;
    expect(r.kind).toBe("ok");
    expect(r.ms).toBe(Date.UTC(2026, 6, 4, 18, 0));
    expect(wallToMs("2026-07-04", "14:00", NY)).toBe(r.ms);
  });
  it("the spring-forward hour does not exist — read as the instant after the gap", () => {
    const r = resolveWall("2026-03-08", "02:30", NY)!;
    expect(r.kind).toBe("gap");
    expect(r.shiftMin).toBe(60);
    expect(inZone(r.ms, NY).hhmm).toBe("03:30");
    expect(wallToMs("2026-03-08", "02:30", NY)).toBe(r.ms);
  });
  it("the fall-back hour happens twice — first and second an hour apart", () => {
    const r = resolveWall("2026-11-01", "01:30", NY)!;
    expect(r.kind).toBe("doubled");
    expect(r.ms).toBe(Date.UTC(2026, 10, 1, 5, 30));       // EDT
    expect(r.laterMs).toBe(Date.UTC(2026, 10, 1, 6, 30));  // EST
    expect(wallToMs("2026-11-01", "01:30", NY)).toBe(r.ms);
  });
  it("a change day away from the change hour is ordinary", () => {
    expect(resolveWall("2026-03-08", "23:00", NY)!.kind).toBe("ok");
    expect(resolveWall("2026-11-01", "12:00", NY)!.kind).toBe("ok");
  });
  it("Zulu never has a gap or a doubled hour", () => {
    expect(resolveWall("2026-03-29", "01:30", "UTC")!.kind).toBe("ok");
  });
  it("bad input is null", () => {
    expect(resolveWall("2026-02-30", "10:00", NY)).toBeNull();
    expect(resolveWall("2026-02-10", "25:00", NY)).toBeNull();
    expect(resolveWall("2026-02-10", "10:00", "Mars/Olympus")).toBeNull();
  });
});

describe("dstInfo", () => {
  it("New York: standard in January, DST in July", () => {
    const jan = dstInfo(Date.UTC(2026, 0, 15), NY)!, jul = dstInfo(Date.UTC(2026, 6, 15), NY)!;
    expect(jan).toMatchObject({ observes: true, isDst: false, offset: -300, stdOffset: -300, dstOffset: -240 });
    expect(jul.isDst).toBe(true);
    expect(dstWord(jan)).toBe("standard");
    expect(dstWord(jul)).toBe("DST");
  });
  it("south of the equator DST runs over January", () => {
    expect(dstInfo(Date.UTC(2026, 0, 15), "Australia/Sydney")!.isDst).toBe(true);
    expect(dstInfo(Date.UTC(2026, 6, 15), "Australia/Sydney")!.isDst).toBe(false);
  });
  it("a zone without DST says so", () => {
    for (const z of ["Asia/Tehran", "Asia/Kolkata", "UTC", "Etc/GMT-3"]) expect(dstWord(dstInfo(Date.UTC(2026, 6, 1), z))).toBe("no DST");
  });
  it("an unknown zone is null", () => {
    expect(dstInfo(0, "Nowhere/None")).toBeNull();
    expect(offsetAt(0, "Nowhere/None")).toBeNull();
  });
});

describe("zone changes", () => {
  it("New York 2026: 8 Mar 02:00→03:00 and 1 Nov 02:00→01:00", () => {
    const c = zoneChanges(Date.UTC(2026, 0, 1), NY, 366, 4);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ ymd: "2026-03-08", wallFrom: "02:00", wallTo: "03:00", shiftMin: 60, ms: Date.UTC(2026, 2, 8, 7, 0) });
    expect(c[1]).toMatchObject({ ymd: "2026-11-01", wallFrom: "02:00", wallTo: "01:00", shiftMin: -60, ms: Date.UTC(2026, 10, 1, 6, 0) });
    expect(zoneChangeLine(c[0])).toBe("Sun 08 Mar 2026 · 02:00 → 03:00 (+1 h, UTC−5 → UTC−4)");
  });
  it("Europe changes on the last Sunday at 01:00Z", () => {
    const n = nextZoneChange(Date.UTC(2026, 6, 1), "Europe/Berlin")!;
    expect(n.ms).toBe(Date.UTC(2026, 9, 25, 1, 0));
    expect(n).toMatchObject({ wallFrom: "03:00", wallTo: "02:00" });
  });
  it("a zone without DST has no change", () => {
    expect(nextZoneChange(Date.UTC(2026, 0, 1), "Asia/Tehran")).toBeNull();
    expect(nextZoneChange(Date.UTC(2026, 0, 1), "UTC")).toBeNull();
  });
});

describe("zoneAbbrev", () => {
  it("names the season's abbreviation", () => {
    expect(zoneAbbrev(Date.UTC(2026, 0, 15), NY)).toBe("EST");
    expect(zoneAbbrev(Date.UTC(2026, 6, 15), NY)).toBe("EDT");
    expect(zoneAbbrev(0, "UTC")).toBe("UTC");
  });
  it("never returns a bare GMT+n (the offset column says that)", () => {
    const a = zoneAbbrev(Date.UTC(2026, 6, 15), "Asia/Amman");
    expect(a === null || !/^(GMT|UTC)/.test(a)).toBe(true);
  });
});

describe("resolveZoneInput", () => {
  const zones = allZones();
  it("Zulu spellings", () => {
    for (const s of ["Z", "zulu", "UTC"]) expect(resolveZoneInput(s, zones)!.zone).toBe("UTC");
  });
  it("a US abbreviation names the DST-aware zone and says so", () => {
    const r = resolveZoneInput("est", zones)!;
    expect(r.zone).toBe(NY);
    expect(r.note).toMatch(/follows DST/);
    expect(resolveZoneInput("PDT", zones)!.zone).toBe("America/Los_Angeles");
  });
  it("ambiguous abbreviations are refused", () => {
    expect(resolveZoneInput("IST", zones)).toBeNull();
    expect(resolveZoneInput("AST", zones)).toBeNull();
  });
  it("a military letter is a fixed offset with inverted Etc sign, and says so", () => {
    const c = resolveZoneInput("c", zones)!;
    expect(c.zone).toBe("Etc/GMT-3");
    expect(offsetAt(Date.UTC(2026, 6, 1), c.zone)).toBe(180);
    expect(c.note).toMatch(/fixed UTC\+3/);
    expect(resolveZoneInput("R", zones)!.zone).toBe("Etc/GMT+5");
    expect(resolveZoneInput("J", zones)).toBeNull();
  });
  it("IANA ids in any case and cities by name", () => {
    expect(resolveZoneInput("asia/tehran", zones)!.zone).toBe("Asia/Tehran");
    expect(resolveZoneInput("new york", zones)!.zone).toBe(NY);
    expect(resolveZoneInput("Amman", zones)!.zone).toBe("Asia/Amman");
  });
  it("nothing matching is null, never a nearest guess", () => {
    expect(resolveZoneInput("Atlantis", zones)).toBeNull();
    expect(resolveZoneInput("", zones)).toBeNull();
  });
});

describe("cityOf", () => {
  it("labels", () => {
    expect(cityOf("America/New_York")).toBe("New York");
    expect(cityOf("UTC")).toBe("Zulu");
    expect(cityOf("Etc/GMT-3")).toBe("UTC+3");
    expect(cityOf("Etc/GMT+5")).toBe("UTC−5");
  });
});
