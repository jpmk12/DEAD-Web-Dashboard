// I&W assembler — server-only. Gathers live observations, folds them through the
// pure engine against the stored baseline, persists today's daily rollup, and
// returns the scored assessment + sensor health + divergence. Lazy-on-request
// with a 10-min in-process cache (the codebase-native pattern — no cron).

import { deriveWarning, scoreIndicators, type WarningAssessment } from "./warning";
import { warningProblemById } from "./warningTaxonomy";
import { gatherObservations, type SensorHealth, type DivergenceState } from "./warningSensors";
import { recordWarningDay, getWarningBaseline, getWarningAnomalyHistory } from "./warningStore";

export interface WarningAssessmentPlus extends WarningAssessment {
  sensorHealth: SensorHealth[];
  divergence: DivergenceState;
}

const TTL = 10 * 60 * 1000;
const cache = new Map<string, { at: number; data: WarningAssessmentPlus }>();

export function resetWarningCache(): void { cache.clear(); }

export async function assessWarning(problemId: string): Promise<WarningAssessmentPlus | null> {
  const def = warningProblemById(problemId);
  if (!def) return null;

  const hit = cache.get(problemId);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const observedAt = new Date().toISOString();
  const day = observedAt.slice(0, 10); // UTC YYYY-MM-DD

  const { observations, health, divergence } = await gatherObservations();
  const { baseline, samples } = await getWarningBaseline(problemId, day, 30).catch(() => ({ baseline: null as number | null, samples: 0 }));
  const priorAnomalies = await getWarningAnomalyHistory(problemId, day, 10).catch(() => [] as number[]);

  // rawScore depends only on observations → compute today's anomaly, then hand
  // the full trajectory series (prior days + today) to the pure engine.
  const rawScore = scoreIndicators(def.indicators, observations).reduce((s, i) => s + i.contribution, 0);
  const todayAnomaly = rawScore - (baseline ?? 0);

  const assessment = deriveWarning(def, observations, {
    baseline: baseline ?? undefined,
    baselineSamples: samples,
    anomalyHistory: [...priorAnomalies, todayAnomaly],
    observedAt,
  });

  // Persist today's rollup (fire-and-forget — a DB hiccup must not fail the read).
  recordWarningDay(problemId, day, assessment.rawScore, assessment.anomaly, assessment.level).catch(() => {});

  const data: WarningAssessmentPlus = { ...assessment, sensorHealth: health, divergence };
  cache.set(problemId, { at: Date.now(), data });
  return data;
}
