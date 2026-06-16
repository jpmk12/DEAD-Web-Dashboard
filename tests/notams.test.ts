import { describe, it, expect } from "vitest";
import { categorizeNotam, parseRunwayClosure, parseRaimWindows, parseNotamEnd, buildNotam } from "@/lib/notams";

describe("categorizeNotam", () => {
  it("runway closure outranks everything (rank 0)", () => {
    expect(categorizeNotam("RWY 09/27 CLSD")).toEqual({ category: "runway", rank: 0 });
    expect(categorizeNotam("RWY 16R CLOSED FOR MAINT")).toEqual({ category: "runway", rank: 0 });
  });
  it("approach U/S → approach", () => {
    expect(categorizeNotam("ILS RWY 25 U/S").category).toBe("approach");
    expect(categorizeNotam("RNAV (GPS) RWY 07 NOT AUTH").category).toBe("approach");
  });
  it("GPS/RAIM", () => {
    expect(categorizeNotam("GPS RAIM OUTAGE PREDICTED 1200-1400").category).toBe("gps_raim");
  });
  it("non-closure runway text still classes as runway, not 0", () => {
    expect(categorizeNotam("RWY 09 LGT U/S").rank).toBeGreaterThan(0);
  });
  it("unrecognized → other", () => {
    expect(categorizeNotam("ROUTINE ADMIN MESSAGE").category).toBe("other");
  });
});

describe("parseRunwayClosure", () => {
  it("extracts designators", () => {
    expect(parseRunwayClosure("RWY 09/27 CLSD")).toEqual(["09/27"]);
    expect(parseRunwayClosure("RWY 16L CLSD. RWY 34R CLOSED")).toEqual(["16L", "34R"]);
  });
  it("none → []", () => {
    expect(parseRunwayClosure("TWY A CLSD")).toEqual([]);
  });
});

describe("parseRaimWindows", () => {
  it("captures HHMM-HHMM windows", () => {
    expect(parseRaimWindows("RAIM OUTAGE 1200-1400 AND 1830-1905Z")).toEqual(["1200-1400Z", "1830-1905Z"]);
  });
  it("rejects impossible times", () => {
    expect(parseRaimWindows("CODE 9999-0000")).toEqual([]);
  });
});

describe("parseNotamEnd", () => {
  it("decodes the C) field to ISO Zulu", () => {
    expect(parseNotamEnd("A) OTBH B) 2606150800 C) 2606201600")).toBe("2026-06-20T16:00:00.000Z");
  });
  it("no C) field → undefined", () => {
    expect(parseNotamEnd("RWY 09 CLSD PERM")).toBeUndefined();
  });
});

describe("buildNotam", () => {
  it("assembles a structured runway-closure NOTAM", () => {
    const n = buildNotam("otbh", "RWY 16R/34L CLSD C) 2606201600");
    expect(n.icao).toBe("OTBH");
    expect(n.category).toBe("runway");
    expect(n.rank).toBe(0);
    expect(n.runwaysClosed).toEqual(["16R/34L"]);
    expect(n.end).toBe("2026-06-20T16:00:00.000Z");
  });
  it("carries RAIM windows on a gps_raim NOTAM", () => {
    const n = buildNotam("KADW", "GPS RAIM OUTAGE 1200-1400Z");
    expect(n.category).toBe("gps_raim");
    expect(n.raimWindows).toEqual(["1200-1400Z"]);
  });
});
