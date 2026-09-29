import { describe, it, expect } from "vitest";
import { calibrateIndicators, calibrationProposals, DOWNWEIGHT_BELOW, EARNING_AT } from "../lib/indicatorCalibration";
import { MIN_SCORED_FOR_RATE, type DecisionEntry, type DecisionOutcome } from "../lib/decisionLog";

let n = 0;
const entry = (indicatorId: string | null, outcome: DecisionOutcome | null): DecisionEntry => ({
  id: `e${++n}`, problemId: "p", indicatorId, call: "escalating", expectation: "something falsifiable",
  horizonDays: 7, createdAt: "2026-09-01T00:00:00Z", dueAt: "2026-09-08T00:00:00Z",
  outcome, scoredAt: outcome ? "2026-09-09T00:00:00Z" : null, scoreNote: null, by: "a@b",
});
const many = (id: string, right: number, wrong: number, amb = 0) => [
  ...Array.from({ length: right }, () => entry(id, "right")),
  ...Array.from({ length: wrong }, () => entry(id, "wrong")),
  ...Array.from({ length: amb }, () => entry(id, "ambiguous")),
];

describe("calibrateIndicators", () => {
  it("proposes down-weighting an indicator that keeps being wrong, with evidence", () => {
    const rows = calibrateIndicators(many("neo", 1, 5));
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe("downweight");
    expect(rows[0].evidence).toMatch(/Right 1 of 6/);
    expect(rows[0].evidence).toMatch(/down-weighting/);
    expect(calibrationProposals(rows).map((r) => r.indicatorId)).toEqual(["neo"]);
  });

  it("names an indicator that is earning its weight, and never proposes it", () => {
    const rows = calibrateIndicators(many("conflict", 6, 1));
    expect(rows[0].verdict).toBe("earning");
    expect(calibrationProposals(rows)).toEqual([]);
  });

  it("says nothing below the per-indicator floor — a tally, not a verdict", () => {
    const rows = calibrateIndicators(many("gps", 0, MIN_SCORED_FOR_RATE - 1));
    expect(rows[0].verdict).toBe("forming");
    expect(rows[0].hit.rate).toBeNull();
    expect(rows[0].evidence).toMatch(/1 more decided call before/);
    expect(calibrationProposals(rows)).toEqual([]);
  });

  it("ignores whole-board calls and unscored entries; omits indicators with no scored call", () => {
    const rows = calibrateIndicators([
      ...many(null as unknown as string, 0, 8),   // whole-board calls: say nothing about an indicator
      entry("mob", null), entry("mob", null),     // open — not evidence
    ]);
    expect(rows).toEqual([]);
  });

  it("reports ambiguous but counts it neither way", () => {
    const rows = calibrateIndicators(many("hormuz", 1, 4, 6));
    expect(rows[0].verdict).toBe("downweight");
    expect(rows[0].hit.decided).toBe(5);
    expect(rows[0].evidence).toMatch(/6 ambiguous/);
  });

  it("orders proposals first, then earning, then forming", () => {
    const rows = calibrateIndicators([...many("a", 5, 1), ...many("b", 1, 1), ...many("c", 0, 6)]);
    expect(rows.map((r) => r.indicatorId)).toEqual(["c", "a", "b"]);
  });

  it("pins the thresholds — moving them re-tunes every board", () => {
    expect(DOWNWEIGHT_BELOW).toBe(0.4);
    expect(EARNING_AT).toBe(0.7);
  });
});
