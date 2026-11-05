import { describe, it, expect } from "vitest";
import { straitTone, straitLabel, boardAreas, lineRoutes, inWindow, windowTally, windowHours } from "@/lib/mapLayers";

describe("straits", () => {
  it("act › threat › reporting › quiet — quiet is never calm", () => {
    expect(straitTone({ acts: 1, threats: 3, analysis: 0, events: [] })).toBe("act");
    expect(straitTone({ acts: 0, threats: 1, analysis: 0, events: [] })).toBe("threat");
    expect(straitTone({ acts: 0, threats: 0, analysis: 2, events: [] })).toBe("reporting");
    expect(straitTone({ acts: 0, threats: 0, analysis: 1, events: [1, 2] })).toBe("quiet");
    expect(straitLabel({ acts: 0, threats: 0, analysis: 0, events: [] })).toMatch(/absence of signal, not calm/);
    expect(straitLabel({ acts: 2, threats: 0, analysis: 0, events: [], transit: { state: "suppressed" } })).toBe("2 reported acts · AIS traffic SUPPRESSED");
  });
});

describe("board areas", () => {
  it("outlines a board by level; learning is dashed; a bad box is skipped", () => {
    const a = boardAreas([
      { problemId: "mp-iran", label: "Iran", level: "warning", learning: false, bbox: { latMin: 12, latMax: 40, lonMin: 34, lonMax: 64 } },
      { problemId: "mp-x", label: "X", level: "calm", learning: true, bbox: { latMin: 10, latMax: 20, lonMin: 0, lonMax: 10 } },
      { problemId: "mp-bad", label: "bad", level: "alert", learning: false, bbox: { latMin: 20, latMax: 10, lonMin: 0, lonMax: 10 } },
      { problemId: "mp-none", label: "none", level: "alert", learning: false },
      { problemId: "mp-iran", label: "Iran", level: "warning", learning: false, bbox: { latMin: 12, latMax: 40, lonMin: 34, lonMax: 64 } },
    ]);
    expect(a.map((x) => x.problemId)).toEqual(["mp-iran", "mp-x"]);
    expect(a[0].bounds).toEqual([[12, 34], [40, 64]]);
    expect(a[0].color).toBe("#f59e0b");
    expect(a[1].dash).toBeTruthy();
  });
});

describe("line routes", () => {
  it("legs between placed fields, the worse end colours the leg, unplaced named", () => {
    const [r] = lineRoutes([{
      id: "l1", label: "C-17 · KDOV → OJAQ → OTBH", dayLabel: "Thu 05 Nov", status: "planned", worst: "r",
      perField: [
        { icao: "KDOV", aor: "NORTHCOM", at: { lat: 39.1, lon: -75.5 }, worst: "g", leds: null, drivers: [], sitrepSlot: false },
        { icao: "ZZZZ", aor: null, at: null, worst: "u", leds: null, drivers: [], sitrepSlot: false },
        { icao: "OJAQ", aor: "CENTCOM", at: { lat: 29.6, lon: 35.0 }, worst: "r", leds: null, drivers: [], sitrepSlot: true },
        { icao: "OTBH", aor: "CENTCOM", at: { lat: 25.1, lon: 51.3 }, worst: "a", leds: null, drivers: [], sitrepSlot: true },
      ],
    }]);
    expect(r.legs.map((l) => `${l.from}-${l.to}:${l.led}`)).toEqual(["KDOV-OJAQ:r", "OJAQ-OTBH:r"]);
    expect(r.unplaced).toEqual(["ZZZZ"]);
    expect(r.points).toHaveLength(3);
  });
});

describe("time window", () => {
  const now = Date.parse("2026-11-05T12:00:00Z");
  it("events inside the window pass; undated always pass; all = everything", () => {
    expect(inWindow("2026-11-05T01:00:00Z", now, 24)).toBe(true);
    expect(inWindow("2026-11-03T11:00:00Z", now, 24)).toBe(false);
    expect(inWindow(null, now, 24)).toBe(true);
    expect(inWindow("2026-01-01", now, null)).toBe(true);
    expect(inWindow("2026-11-04", now, 24)).toBe(true); // a date-only stamp counts for its whole day
    expect(windowHours("7d")).toBe(168);
  });
  it("tallies kept / hidden / undated", () => {
    expect(windowTally(["2026-11-05T10:00:00Z", "2026-10-01T00:00:00Z", null, "junk"], now, 72)).toEqual({ kept: 3, hidden: 1, undated: 2 });
  });
});
