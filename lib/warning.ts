// Indications & Warning (I&W) scoring spine — PURE, client-safe, unit-tested.
//
// The discipline (Grabo, Anticipating Surprise; open doctrine): warning is about
// ANOMALY and TRAJECTORY, not level. Color is EARNED by crossing a pre-registered
// threshold on the anomaly (delta from baseline) — never by a high standing level.
// Every level decomposes into the 2-3 indicators driving it (drivers[]): the
// board PROPOSES, the analyst DISPOSES. No black-box scores.
//
// This module is sensor-agnostic: sensors normalize into IndicatorObservation
// BEFORE scoring sees them, so adding a sensor never touches this file. No node:*,
// no fetch, no new dep — safe to import from client components (esbuild stays 0).

export type ObservedState = "dormant" | "watching" | "active" | "confirmed";

// Weight-of-evidence state values (§2.4).
export const STATE_VALUE: Record<ObservedState, number> = {
  dormant: 0,
  watching: 0.33,
  active: 0.66,
  confirmed: 1,
};

export const STATE_RANK: Record<ObservedState, number> = { dormant: 0, watching: 1, active: 2, confirmed: 3 };

// The common observation format every sensor emits (§1.3).
export interface IndicatorObservation {
  sensorId: string;              // 'conflictEvents' | 'conflictNews' | 'aircraftMil' | ...
  indicatorId: string;           // maps to a registered IndicatorDef.id
  observedState: ObservedState;
  confidence: number;            // 0..1
  magnitude?: number;            // sensor-native, informational
  ts: string;                    // ISO
  provenance: string;            // source URL / feed id — REQUIRED (§7)
}

// A registered indicator. `falsifier` and open `provenance` are the fields that
// separate this from a vibe (§2.3, §6.1) — both are REQUIRED.
export interface IndicatorDef {
  id: string;
  warningProblem: string;
  description: string;
  sourceFeed: string;            // which sensor supplies it
  weight: number;                // relative weight within the problem
  falsifier: string;             // pre-registered: what would prove this wrong
  provenance: string;            // open-doctrine origin (defensible taxonomy)
}

export interface WarningThresholds {
  // Anomaly (delta-from-baseline) deltas at which color is earned.
  watch: number;
  warning: number;
  alert: number;
}

export type WarningLevel = "calm" | "watch" | "warning" | "alert";
export type Trajectory = "improving" | "stable" | "deteriorating";

// A warning problem is a first-class object: it owns its indicator set AND its
// thresholds — Taiwan sensitivity ≠ Sahel sensitivity, a single global scale
// hides that (§2.2). decisionLinkage is REQUIRED: warning exists to buy decision
// time, not to be interesting (§2.6).
export interface WarningProblemDef {
  id: string;
  label: string;
  scenario: string;
  decisionLinkage: string;
  thresholds: WarningThresholds;
  indicators: IndicatorDef[];
}

// ── Scored output ────────────────────────────────────────────────────────────

export interface IndicatorScore {
  id: string;
  description: string;
  sourceFeed: string;
  state: ObservedState;
  confidence: number;
  weight: number;
  contribution: number;          // weight × STATE_VALUE(state) × confidence
  magnitude?: number;
  falsifier: string;
  provenance: string;
  observedProvenance: string | null; // the live source of the latest observation
  lastObserved: string | null;
}

export interface WarningAssessment {
  problemId: string;
  label: string;
  scenario: string;
  decisionLinkage: string;
  rawScore: number;              // Σ contribution (shown quietly)
  baseline: number;              // trailing-mean rawScore
  anomaly: number;               // rawScore − baseline — THE hero number
  level: WarningLevel;
  trajectory: Trajectory;
  drivers: IndicatorScore[];     // the 2-3 indicators moving the score
  indicators: IndicatorScore[];  // full set, most-active first
  thresholds: WarningThresholds;
  observedAt: string;
  learning: boolean;             // baseline not yet meaningful (cold start §9.4)
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

// Latest observation per indicator wins (by ts); missing indicator → dormant.
function latestByIndicator(observations: IndicatorObservation[]): Map<string, IndicatorObservation> {
  const map = new Map<string, IndicatorObservation>();
  for (const o of observations) {
    const prev = map.get(o.indicatorId);
    if (!prev || Date.parse(o.ts) >= Date.parse(prev.ts)) map.set(o.indicatorId, o);
  }
  return map;
}

export function scoreIndicators(defs: IndicatorDef[], observations: IndicatorObservation[]): IndicatorScore[] {
  const latest = latestByIndicator(observations);
  return defs.map((d) => {
    const o = latest.get(d.id) ?? null;
    const state: ObservedState = o?.observedState ?? "dormant";
    const confidence = o ? clamp01(o.confidence) : 0;
    const contribution = d.weight * STATE_VALUE[state] * confidence;
    return {
      id: d.id,
      description: d.description,
      sourceFeed: d.sourceFeed,
      state,
      confidence,
      weight: d.weight,
      contribution,
      magnitude: o?.magnitude,
      falsifier: d.falsifier,
      provenance: d.provenance,
      observedProvenance: o?.provenance ?? null,
      lastObserved: o?.ts ?? null,
    };
  });
}

// Level is earned by the ANOMALY crossing a threshold — calm by default (§2.1).
// In learning mode (no trustworthy baseline yet) we never cry warning/alert: the
// board can say "watch — movement, baseline still forming" but not more (§9.4).
export function levelFor(anomaly: number, t: WarningThresholds, learning: boolean): WarningLevel {
  let level: WarningLevel =
    anomaly >= t.alert ? "alert" : anomaly >= t.warning ? "warning" : anomaly >= t.watch ? "watch" : "calm";
  if (learning && (level === "warning" || level === "alert")) level = "watch";
  return level;
}

// Trajectory = sign of change in anomaly over a trailing window (oldest→newest).
// eps guards against jitter reading as movement.
export function trajectoryFor(anomalyHistory: number[], eps = 0.02): Trajectory {
  const h = anomalyHistory.filter((n) => Number.isFinite(n));
  if (h.length < 2) return "stable";
  const first = h[0];
  const last = h[h.length - 1];
  if (last - first > eps) return "deteriorating";
  if (first - last > eps) return "improving";
  return "stable";
}

export interface DeriveOpts {
  baseline?: number;             // trailing-mean rawScore; omit → cold start
  anomalyHistory?: number[];     // trailing anomaly series (oldest→newest) for trajectory
  minBaselineSamples?: number;   // history depth before baseline is trusted (default 14)
  baselineSamples?: number;      // how many daily samples the baseline was built from
  observedAt: string;            // ISO stamp (pass in — no Date.now() in a pure fn)
}

// Fold a problem + its observations + baseline/history into a scored assessment.
export function deriveWarning(
  def: WarningProblemDef,
  observations: IndicatorObservation[],
  opts: DeriveOpts,
): WarningAssessment {
  const indicators = scoreIndicators(def.indicators, observations);
  const rawScore = indicators.reduce((s, i) => s + i.contribution, 0);

  const minSamples = opts.minBaselineSamples ?? 14;
  const learning = opts.baseline == null || (opts.baselineSamples ?? 0) < minSamples;
  const baseline = opts.baseline ?? 0;
  const anomaly = rawScore - baseline;

  const level = levelFor(anomaly, def.thresholds, learning);
  const trajectory = trajectoryFor(opts.anomalyHistory ?? [anomaly]);

  // Drivers: indicators actually moving the score, strongest first, top 3.
  const drivers = indicators
    .filter((i) => i.state !== "dormant" && i.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3);

  const ordered = [...indicators].sort(
    (a, b) => STATE_RANK[b.state] - STATE_RANK[a.state] || b.contribution - a.contribution,
  );

  return {
    problemId: def.id,
    label: def.label,
    scenario: def.scenario,
    decisionLinkage: def.decisionLinkage,
    rawScore,
    baseline,
    anomaly,
    level,
    trajectory,
    drivers,
    indicators: ordered,
    thresholds: def.thresholds,
    observedAt: opts.observedAt,
    learning,
  };
}

export const LEVEL_RANK: Record<WarningLevel, number> = { calm: 0, watch: 1, warning: 2, alert: 3 };
