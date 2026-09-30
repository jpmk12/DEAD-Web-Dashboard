import { describe, it, expect } from "vitest";
import {
  slope, direction, runLength, highWater, flatBaseline, weekdayBaseline, bestBaseline,
  shareOfObserved, precedes, verdict, weekdayOf, dayDiff,
  SLOPE_MIN_POINTS, WEEKDAY_MIN_SAMPLES, LEAD_MIN_EVENTS, HIGH_WATER_MIN_PRIOR,
} from "../lib/series";
import { effectiveMobilityBaseline, mobilityObservedHigh, mobilityBaselineNote } from "../lib/warningRules";
import { sensorKey, sensorKeyDef, isRegisteredSensorKey, slug } from "../lib/sensorKeys";

const d = (i: number) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10); // 2026-09-01 + i
const pts = (vals: (number | null)[]) => vals.flatMap((v, i) => (v == null ? [] : [{ day: d(i), value: v }]));

describe("series — slope and direction", () => {
  it("needs SLOPE_MIN_POINTS observed points", () => {
    expect(slope(pts([1, 2, 3]))).toBeNull();
    expect(SLOPE_MIN_POINTS).toBe(4);
    expect(slope(pts([1, 2, 3, 4]))).toBeCloseTo(1);
  });
  it("is per OBSERVED step — a gap does not read as a plateau", () => {
    const gappy = pts([1, 2, null, null, null, null, 3, 4]);
    expect(slope(gappy)).toBeCloseTo(1);
  });
  it("direction is relative to the mean", () => {
    expect(direction(pts([100, 100, 100, 101]))).toBe("flat");
    expect(direction(pts([10, 14, 18, 22]))).toBe("rising");
    expect(direction(pts([22, 18, 14, 10]))).toBe("falling");
    expect(direction(pts([5, 5, 5, 5]))).toBe("flat");
    expect(direction(pts([5, 5, 5]))).toBeNull();
  });
});

describe("series — run length, high water, share", () => {
  it("runLength counts from the newest observation back", () => {
    expect(runLength(pts([0, 1, 1, 0, 1, 1, 1]), (v) => v >= 1)).toBe(3);
    expect(runLength(pts([1, 1, 0]), (v) => v >= 1)).toBe(0);
    expect(runLength([], (v) => v >= 1)).toBe(0);
  });
  it("highWater needs HIGH_WATER_MIN_PRIOR prior points before it calls a high", () => {
    const short = pts([1, 2, 3, 9]);
    expect(highWater(short, d(3)).isHigh).toBeNull();
    expect(HIGH_WATER_MIN_PRIOR).toBe(7);
    const long = pts([1, 2, 3, 4, 5, 6, 7, 9]);
    const h = highWater(long, d(7));
    expect(h.isHigh).toBe(true);
    expect(h.priorHigh).toBe(7);
    expect(h.priorHighDay).toBe(d(6));
    expect(highWater(pts([1, 2, 3, 4, 5, 6, 7, 7]), d(7)).isHigh).toBe(false); // equal is not above
  });
  it("shareOfObserved is of OBSERVED days and says so", () => {
    const s = shareOfObserved(pts([2, null, 2, 0, null, 2, 0]), (v) => v >= 2, d(6), 30);
    expect(s.hits).toBe(3);
    expect(s.observed).toBe(5);
    expect(s.label).toBe("3 of 5 observed days");
  });
});

describe("series — baselines", () => {
  it("flat baseline excludes today", () => {
    const b = flatBaseline(pts([10, 10, 10, 40]), d(3), 30);
    expect(b.mean).toBe(10);
    expect(b.samples).toBe(3);
    expect(b.kind).toBe("flat");
  });
  it("weekday baseline needs WEEKDAY_MIN_SAMPLES of that weekday", () => {
    expect(WEEKDAY_MIN_SAMPLES).toBe(4);
    // 2026-09-01 is a Tuesday. Four prior Tuesdays: Sep 1, 8, 15, 22 → today Sep 29.
    const series = [0, 7, 14, 21].map((i) => ({ day: d(i), value: 20 })).concat([{ day: d(3), value: 5 }, { day: d(10), value: 5 }]);
    expect(weekdayOf(d(0))).toBe(2);
    const w = weekdayBaseline(series, d(28));
    expect(w.kind).toBe("weekday");
    expect(w.mean).toBe(20);
    expect(w.samples).toBe(4);
    expect(weekdayBaseline(series.slice(1), d(28)).kind).toBe("none");
  });
  it("bestBaseline prefers the weekday mean once earned, else flat", () => {
    const series = [0, 7, 14, 21].map((i) => ({ day: d(i), value: 20 })).concat([{ day: d(3), value: 5 }]);
    expect(bestBaseline(series, d(28)).kind).toBe("weekday");
    expect(bestBaseline(series, d(27)).kind).toBe("flat");   // Monday: no Monday samples
  });
});

describe("series — precedes and verdict", () => {
  it("needs LEAD_MIN_EVENTS events", () => {
    expect(LEAD_MIN_EVENTS).toBe(3);
    expect(precedes([d(1)], [d(2), d(9)], 3)).toBeNull();
  });
  it("counts a lead inside the lag window, same day is lag 0, and reports the median", () => {
    const r = precedes([d(1), d(9), d(20)], [d(2), d(10), d(20), d(28)], 3)!;
    expect(r.hits).toBe(3);
    expect(r.events).toBe(4);
    expect(r.medianLeadDays).toBe(1);
    expect(r.label).toBe("preceded 3 of 4, median lead 1 d");
  });
  it("a lead AFTER the event never counts", () => {
    const r = precedes([d(5)], [d(2), d(3), d(4)], 3)!;
    expect(r.hits).toBe(0);
  });
  it("verdict is a tally below the floor and a rate above it", () => {
    expect(verdict(0, 0, 5).label).toBe("nothing scored yet");
    expect(verdict(2, 3, 5)).toEqual({ rate: null, label: "2 of 3 so far (2 more before a rate)" });
    expect(verdict(4, 5, 5).rate).toBeCloseTo(0.8);
    expect(verdict(4, 5, 5).label).toBe("80% (4 of 5)");
  });
  it("dayDiff is whole days", () => { expect(dayDiff(d(0), d(9))).toBe(9); });
});

describe("mobility surge — weekday-aware baseline", () => {
  it("a Monday that is ×1.5 the flat mean but ×1.1 the Monday mean is NOT a surge", () => {
    const b = { mean: 10, samples: 30, weekdayMean: 14, weekdaySamples: 4 };
    expect(effectiveMobilityBaseline(b).kind).toBe("weekday");
    expect(mobilityObservedHigh(15, b)).toBe(false);
    expect(mobilityObservedHigh(15, { mean: 10, samples: 30 })).toBe(true);
  });
  it("falls back to flat below four weekday samples, and names what it used", () => {
    const b = { mean: 10, samples: 30, weekdayMean: 14, weekdaySamples: 3 };
    expect(effectiveMobilityBaseline(b).kind).toBe("flat");
    expect(mobilityBaselineNote(b)).toContain("baseline ~10/day over 30d");
    expect(mobilityBaselineNote({ mean: 10, samples: 30, weekdayMean: 14, weekdaySamples: 4 }, "2026-09-28")).toContain("vs Mon normal ~14 over 4 wk");
    expect(mobilityBaselineNote({ mean: null, samples: 0 })).toBe(", baseline forming");
  });
});

describe("sensor key registry", () => {
  it("builds registered keys and refuses unknown prefixes", () => {
    expect(sensorKey("mob", "KWRI")).toBe("mob:kwri");
    expect(sensorKey("px", "BZ=F")).toBe("px:bz=f");
    expect(sensorKey("limfac", "KWRI", "fuel")).toBe("limfac:kwri:fuel");
    expect(isRegisteredSensorKey("pnt:mp-iran")).toBe(true);
    expect(isRegisteredSensorKey("made-up:x")).toBe(false);
    expect(sensorKeyDef("px:bz=f")?.policy).toBe("last");
    expect(sensorKeyDef("mob:kwri")?.policy).toBe("peak");
    expect(slug("Strait of Hormuz")).toBe("strait-of-hormuz");
  });
});
