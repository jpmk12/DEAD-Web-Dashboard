import { describe, it, expect } from "vitest";
import { categorizeNotam, parseRunwayClosure, parseRaimWindows, parseNotamEnd, parseNotamStart, notamTimeState, startsInLabel, buildNotam, parseDaipNotams } from "@/lib/notams";

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

describe("NOTAM time-awareness", () => {
  const NOW = Date.UTC(2026, 5, 17, 0, 39); // 2026-06-17 00:39Z (matches the live KADW capture)
  it("parses the B) start field", () => {
    expect(parseNotamStart("A) KADW B) 2606171100 C) 2606172000 E) ...")).toBe("2026-06-17T11:00:00.000Z");
  });
  it("classifies active / upcoming / expired", () => {
    const up = buildNotam("KADW", "A) KADW B) 2606171100 C) 2606172000 E) RWY 1R/19L CLOSED");
    expect(notamTimeState(up, NOW)).toBe("upcoming"); // starts 11:00Z, now 00:39Z
    const active = buildNotam("KADW", "A) KADW B) 2606130000 C) 2609102359 E) RWY 19L WINDCONE OTS");
    expect(notamTimeState(active, NOW)).toBe("active");
    const gone = buildNotam("KADW", "A) KADW B) 2606010000 C) 2606160000 E) RWY 01 CLOSED");
    expect(notamTimeState(gone, NOW)).toBe("expired");
  });
  it("labels the lead time for upcoming NOTAMs", () => {
    const up = buildNotam("KADW", "A) KADW B) 2606171100 C) 2606172000 E) RWY 1R/19L CLOSED");
    expect(startsInLabel(up, NOW)).toBe("10h"); // ~10h 21m → 10h
    const active = buildNotam("KADW", "A) KADW B) 2606130000 C) 2609102359 E) RWY 19L WINDCONE OTS");
    expect(startsInLabel(active, NOW)).toBeNull(); // already started
  });
});

describe("parseDaipNotams", () => {
  // Trimmed from a real DAIP response for KADW (group[].notams[].list[]).
  const sample = JSON.stringify({
    count: 2, type: "LOCATION",
    group: [{ name: "KADW", notams: [{ code: "KADW", name: "KADW JOINT BASE ANDREWS", list: [
      { idshow: "M1235/26", text: "AERODROME AERODROME RWY 1R/19L CLOSED. 17 JUN 11:00 2026 UNTIL 17 JUN 20:00 2026.",
        rawtext: "M1235/26 NOTAMN \r\nQ) ZDC/QXXXX/IV/NBO/A/000/999 \r\nA) KADW \r\nB) 2606171100 \r\nC) 2606172000 \r\nE) AERODROME AERODROME RWY 1R/19L CLOSED.", alertType: "Warning" },
      { idshow: "M1216/26", text: "AERODROME WINDCONE LOCATED 465FT FROM RWY 19L APPROACH OTS.",
        rawtext: "M1216/26 NOTAMN \r\nA) KADW \r\nC) 2609102359 \r\nE) AERODROME WINDCONE LOCATED 465FT FROM RWY 19L APPROACH OTS", alertType: "Caution" },
    ] }] }],
  });

  it("descends group[].notams[].list[] and structures each NOTAM", () => {
    const out = parseDaipNotams("kadw", sample)!;
    expect(out).toHaveLength(2);
    const closure = out.find((n) => n.runwaysClosed?.length);
    expect(closure).toBeTruthy();
    expect(closure!.icao).toBe("KADW");
    expect(closure!.category).toBe("runway");
    expect(closure!.runwaysClosed).toEqual(["1R/19L"]);
    expect(closure!.end).toBe("2026-06-17T20:00:00.000Z"); // from the C) field
    expect(closure!.text).toContain("M1235/26"); // NOTAM number prefixed
  });

  it("does NOT extract the airfield name as a NOTAM (the old bug)", () => {
    const out = parseDaipNotams("KADW", sample)!;
    expect(out.some((n) => n.text.includes("JOINT BASE ANDREWS"))).toBe(false);
  });

  it("returns null for a non-DAIP shape", () => {
    expect(parseDaipNotams("KADW", JSON.stringify({ foo: 1 }))).toBeNull();
    expect(parseDaipNotams("KADW", "not json")).toBeNull();
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
