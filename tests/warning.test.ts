import { describe, it, expect } from "vitest";
import {
  deriveWarning,
  scoreIndicators,
  levelFor,
  trajectoryFor,
  STATE_VALUE,
  type IndicatorObservation,
} from "../lib/warning";
import { CENTCOM_IRAN, warningProblemById } from "../lib/warningTaxonomy";

const TS = "2026-07-13T12:00:00.000Z";
const obs = (indicatorId: string, state: IndicatorObservation["observedState"], confidence = 1, ts = TS): IndicatorObservation => ({
  sensorId: "test",
  indicatorId,
  observedState: state,
  confidence,
  ts,
  provenance: "test://fixture",
});

describe("warning scoring — weight-of-evidence", () => {
  it("all dormant → rawScore 0, calm, no drivers", () => {
    const a = deriveWarning(CENTCOM_IRAN, [], { observedAt: TS, baseline: 0, baselineSamples: 30 });
    expect(a.rawScore).toBe(0);
    expect(a.anomaly).toBe(0);
    expect(a.level).toBe("calm");
    expect(a.drivers).toHaveLength(0);
    // Every indicator is present, defaulted dormant.
    expect(a.indicators).toHaveLength(CENTCOM_IRAN.indicators.length);
  });

  it("contribution = weight × stateValue × confidence", () => {
    const scores = scoreIndicators(CENTCOM_IRAN.indicators, [obs("neo_departure_posture", "confirmed", 1)]);
    const neo = scores.find((s) => s.id === "neo_departure_posture")!;
    expect(neo.contribution).toBeCloseTo(0.9 * STATE_VALUE.confirmed * 1, 6);
    const conf = scoreIndicators(CENTCOM_IRAN.indicators, [obs("escalatory_strike_signal", "active", 0.5)]).find((s) => s.id === "escalatory_strike_signal")!;
    expect(conf.contribution).toBeCloseTo(0.6 * STATE_VALUE.active * 0.5, 6);
  });

  it("latest observation per indicator wins", () => {
    const scores = scoreIndicators(CENTCOM_IRAN.indicators, [
      obs("conflict_intensity_gulf", "watching", 1, "2026-07-10T00:00:00Z"),
      obs("conflict_intensity_gulf", "confirmed", 1, "2026-07-13T00:00:00Z"),
    ]);
    expect(scores.find((s) => s.id === "conflict_intensity_gulf")!.state).toBe("confirmed");
  });
});

describe("warning is ANOMALY, not level (anti-Christmas-tree)", () => {
  it("a high standing rawScore AT baseline stays calm", () => {
    // Two confirmed indicators — a genuinely 'busy' theater...
    const observations = [obs("conflict_intensity_gulf", "confirmed"), obs("neo_departure_posture", "active")];
    const raw = deriveWarning(CENTCOM_IRAN, observations, { observedAt: TS, baseline: 0, baselineSamples: 30 }).rawScore;
    // ...but if that IS the baseline, today is not unusual → calm.
    const a = deriveWarning(CENTCOM_IRAN, observations, { observedAt: TS, baseline: raw, baselineSamples: 30 });
    expect(a.anomaly).toBeCloseTo(0, 6);
    expect(a.level).toBe("calm");
  });

  it("the same movement ABOVE baseline earns color", () => {
    const observations = [obs("conflict_intensity_gulf", "confirmed"), obs("mobility_divergence", "active"), obs("neo_departure_posture", "confirmed")];
    const a = deriveWarning(CENTCOM_IRAN, observations, { observedAt: TS, baseline: 0.2, baselineSamples: 30 });
    expect(a.anomaly).toBeGreaterThan(CENTCOM_IRAN.thresholds.warning);
    expect(["warning", "alert"]).toContain(a.level);
    // Drivers name the 2-3 indicators moving it, strongest first.
    expect(a.drivers.length).toBeGreaterThan(0);
    expect(a.drivers.length).toBeLessThanOrEqual(3);
    expect(a.drivers[0].contribution).toBeGreaterThanOrEqual(a.drivers[a.drivers.length - 1].contribution);
  });

  it("levelFor maps anomaly to thresholds", () => {
    const t = { watch: 0.15, warning: 0.35, alert: 0.6 };
    expect(levelFor(0.05, t, false)).toBe("calm");
    expect(levelFor(0.2, t, false)).toBe("watch");
    expect(levelFor(0.4, t, false)).toBe("warning");
    expect(levelFor(0.7, t, false)).toBe("alert");
  });
});

describe("cold-start learning mode (§9.4)", () => {
  it("without a trustworthy baseline, never cries warning/alert — caps at watch", () => {
    const observations = [obs("conflict_intensity_gulf", "confirmed"), obs("neo_departure_posture", "confirmed"), obs("mobility_divergence", "confirmed")];
    const a = deriveWarning(CENTCOM_IRAN, observations, { observedAt: TS, baseline: 0, baselineSamples: 3 }); // < 14 samples
    expect(a.learning).toBe(true);
    expect(a.anomaly).toBeGreaterThan(CENTCOM_IRAN.thresholds.alert);
    expect(a.level).toBe("watch"); // capped
  });

  it("no baseline supplied at all → learning", () => {
    const a = deriveWarning(CENTCOM_IRAN, [], { observedAt: TS });
    expect(a.learning).toBe(true);
  });
});

describe("trajectory", () => {
  it("reads deterioration, improvement, and stability from the anomaly series", () => {
    expect(trajectoryFor([0.1, 0.2, 0.35])).toBe("deteriorating");
    expect(trajectoryFor([0.4, 0.25, 0.1])).toBe("improving");
    expect(trajectoryFor([0.2, 0.205, 0.2])).toBe("stable");
    expect(trajectoryFor([0.3])).toBe("stable");
  });
});

describe("taxonomy integrity — every indicator is a warning indicator, not a vibe", () => {
  it("CENTCOM/Iran problem is registered and complete", () => {
    expect(warningProblemById("centcom_iran")).toBe(CENTCOM_IRAN);
    expect(CENTCOM_IRAN.decisionLinkage.length).toBeGreaterThan(0);
    for (const ind of CENTCOM_IRAN.indicators) {
      expect(ind.falsifier.length, `${ind.id} needs a falsifier`).toBeGreaterThan(0);
      expect(ind.provenance.length, `${ind.id} needs open provenance`).toBeGreaterThan(0);
      expect(ind.weight).toBeGreaterThan(0);
    }
  });
});
