import { describe, it, expect } from "vitest";
import {
  isRecentLevel4,
  recentConflictCount,
  bandConflictIntensity,
  conflictImpliesDemand,
  mobilityObservedHigh,
  MOBILITY_FALLBACK_SURGE,
} from "../lib/warningRules";

const NOW = Date.UTC(2026, 6, 13, 12, 0);
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("isRecentLevel4 — a standing L4 is posture, not warning", () => {
  it("Iran's permanent Level-4 (old pubDate) does NOT trigger", () => {
    expect(isRecentLevel4({ level: 4, pubDate: daysAgo(300) }, NOW)).toBe(false);
  });
  it("a NEW Level-4 within 14 days DOES trigger", () => {
    expect(isRecentLevel4({ level: 4, pubDate: daysAgo(3) }, NOW)).toBe(true);
  });
  it("edge: exactly outside the window, missing pubDate, non-L4 → false", () => {
    expect(isRecentLevel4({ level: 4, pubDate: daysAgo(15) }, NOW)).toBe(false);
    expect(isRecentLevel4({ level: 4 }, NOW)).toBe(false);
    expect(isRecentLevel4({ level: 3, pubDate: daysAgo(1) }, NOW)).toBe(false);
  });
});

describe("recentConflictCount — 90-day slice, undated counts as current", () => {
  it("filters dated points to the window and keeps undated (ReliefWeb) points", () => {
    const pts = [
      { count: 5, date: daysAgo(10).slice(0, 10) },   // in window
      { count: 7, date: daysAgo(200).slice(0, 10) },  // out — old
      { count: 3 },                                    // undated → current situation
    ];
    expect(recentConflictCount(pts, NOW)).toBe(8);
  });
  it("a year of old events no longer saturates the indicator", () => {
    const yearOld = Array.from({ length: 50 }, (_, i) => ({ count: 10, date: daysAgo(120 + i).slice(0, 10) }));
    expect(recentConflictCount(yearOld, NOW)).toBe(0);
    expect(bandConflictIntensity(recentConflictCount(yearOld, NOW))).toBe("dormant");
  });
});

describe("bandConflictIntensity / conflictImpliesDemand", () => {
  it("bands 0 / ≤10 / ≤40 / >40", () => {
    expect(bandConflictIntensity(0)).toBe("dormant");
    expect(bandConflictIntensity(10)).toBe("watching");
    expect(bandConflictIntensity(40)).toBe("active");
    expect(bandConflictIntensity(41)).toBe("confirmed");
  });
  it("only confirmed-band intensity implies airlift demand", () => {
    expect(conflictImpliesDemand(40)).toBe(false);
    expect(conflictImpliesDemand(41)).toBe(true);
  });
});

describe("mobilityObservedHigh — surge is relative to the AOR's own normal", () => {
  it("with a learned baseline, an ordinary Gulf day (count ≈ mean) is NOT a surge", () => {
    expect(mobilityObservedHigh(12, { mean: 11, samples: 20 })).toBe(false);
  });
  it("count clearing mean×1.4 (and mean+2) IS a surge", () => {
    expect(mobilityObservedHigh(16, { mean: 11, samples: 20 })).toBe(true);
  });
  it("tiny baseline: +1 aircraft is not a surge (mean+2 floor)", () => {
    expect(mobilityObservedHigh(2, { mean: 1, samples: 20 })).toBe(false);
    expect(mobilityObservedHigh(4, { mean: 1, samples: 20 })).toBe(true);
  });
  it("while the baseline is forming, falls back to a deliberately HIGH static bar", () => {
    expect(mobilityObservedHigh(10, { mean: null, samples: 0 })).toBe(false);
    expect(mobilityObservedHigh(10, { mean: 8, samples: 2 })).toBe(false);   // too few samples
    expect(mobilityObservedHigh(MOBILITY_FALLBACK_SURGE, { mean: null, samples: 0 })).toBe(true);
  });
});
