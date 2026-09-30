import { describe, it, expect } from "vitest";
import { leadIndicators, stepUpDays, stateRun, sparkCells, LEAD_WINDOW_DAYS, type IndicatorDay, type LevelDay } from "../lib/leadIndicators";
import { transitDaySeries, suppressedDays } from "../lib/chokepointTransit";
import { chokepointState, TRANSIT_LEAD_TRUSTED } from "../lib/warningRules";

const d = (i: number) => `2026-09-${String(i).padStart(2, "0")}`;
const lv = (pairs: [number, LevelDay["level"]][]): LevelDay[] => pairs.map(([i, level]) => ({ day: d(i), level }));
const ind = (pairs: [number, IndicatorDay["state"], boolean?][]): IndicatorDay[] => pairs.map(([i, state, live]) => ({ day: d(i), state, live: live ?? true }));

describe("leadIndicators — which indicator moves first", () => {
  it("stepUpDays reads steps between OBSERVED days, ignoring gaps", () => {
    expect(stepUpDays(lv([[1, "calm"], [4, "watch"], [9, "watch"], [10, "warning"], [12, "calm"]]), (l) => ["calm", "watch", "warning", "alert"].indexOf(l.level))).toEqual([d(4), d(10)]);
  });
  it("needs three level-ups before it reads anything", () => {
    const r = leadIndicators(lv([[1, "calm"], [2, "watch"], [3, "warning"]]), { a: ind([[1, "dormant"], [2, "watching"]]) });
    expect(r.levelUps).toBe(2);
    expect(r.leads).toEqual([]);
    expect(r.label).toMatch(/3 needed/);
  });
  it("credits an indicator that stepped up inside the window, not one that stepped up after", () => {
    // Level-ups on the 3rd, 13th and 23rd. "early" steps up the day before each;
    // "late" steps up the day AFTER each — nine days before the next level-up,
    // outside the five-day window, so it never leads.
    const levels = lv([[1, "calm"], [3, "watch"], [8, "calm"], [13, "watch"], [18, "calm"], [23, "watch"]]);
    const early = ind([[1, "dormant"], [2, "watching"], [3, "watching"], [8, "dormant"], [12, "watching"], [13, "watching"], [18, "dormant"], [22, "active"], [23, "active"]]);
    const late = ind([[1, "dormant"], [3, "dormant"], [4, "watching"], [8, "dormant"], [13, "dormant"], [14, "watching"], [18, "dormant"], [23, "dormant"], [24, "watching"]]);
    const r = leadIndicators(levels, { early, late });
    expect(r.levelUps).toBe(3);
    expect(r.leads[0].indicatorId).toBe("early");
    expect(r.leads[0].result.hits).toBe(3);
    expect(r.leads[0].result.medianLeadDays).toBe(1);
    expect(r.leads.find((l) => l.indicatorId === "late")).toBeUndefined();
    expect(LEAD_WINDOW_DAYS).toBe(5);
  });
  it("a dead-sensor day is not a step", () => {
    const levels = lv([[1, "calm"], [3, "watch"], [6, "calm"], [9, "watch"], [12, "calm"], [15, "watch"]]);
    const flaky = ind([[1, "dormant"], [2, "watching", false], [3, "watching", false], [8, "watching", false], [14, "watching", false]]);
    expect(leadIndicators(levels, { flaky }).leads).toEqual([]);
  });
  it("stateRun and sparkCells", () => {
    const s = ind([[1, "dormant"], [2, "watching"], [3, "watching"], [4, "dormant", false], [5, "watching"]]);
    expect(stateRun(s)).toEqual({ state: "watching", run: 3 });   // the dead day is skipped
    const cells = sparkCells(s, 3);
    expect(cells.map((c) => c.ord)).toEqual([1, -1, 1]);
    expect(stateRun([])).toEqual({ state: null, run: 0 });
  });
});

describe("chokepoint transit history and lead", () => {
  it("transitDaySeries keeps qualifying days as vessels/h, oldest first; suppressedDays reads against the normal", () => {
    const rows = [
      { day: d(3), distinct: 20, observedMinutes: 600 },  // 2/h
      { day: d(1), distinct: 100, observedMinutes: 600 }, // 10/h
      { day: d(2), distinct: 5, observedMinutes: 30 },    // too thin
    ];
    const s = transitDaySeries(rows);
    expect(s.map((p) => p.day)).toEqual([d(1), d(3)]);
    expect(suppressedDays(s, 10)).toEqual([d(3)]);
    expect(suppressedDays(s, null)).toEqual([]);
  });
  it("a trusted lead rate adds confidence to a suppressed lift, never a state", () => {
    const base = chokepointState({ acts: 0, threats: 1, analysis: 0, events: 0, score: 0, transit: "suppressed" }, 0);
    const trusted = chokepointState({ acts: 0, threats: 1, analysis: 0, events: 0, score: 0, transit: "suppressed", transitLeadRate: TRANSIT_LEAD_TRUSTED }, 0);
    expect(trusted.state).toBe(base.state);
    expect(trusted.confidence).toBeCloseTo(base.confidence + 0.05);
    expect(trusted.why).toMatch(/preceded 60% of acts/);
    const untrusted = chokepointState({ acts: 0, threats: 1, analysis: 0, events: 0, score: 0, transit: "suppressed", transitLeadRate: 0.2 }, 0);
    expect(untrusted.confidence).toBeCloseTo(base.confidence);
  });
});
