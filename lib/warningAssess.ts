// I&W assembler — server-only. Gathers live observations, folds them through the
// pure engine against the stored baseline, persists today's daily rollup, and
// returns the scored assessment + sensor health + divergence. Lazy-on-request
// with a 10-min in-process cache (the codebase-native pattern — no cron).

import { deriveWarning, scoreIndicators, type WarningAssessment, type ObservedState, type WarningLevel } from "./warning";
import { resolveWarningProblem } from "./warningProblems";
import { gatherObservations, type SensorHealth, type DivergenceState } from "./warningSensors";
import { gatherSpectrumObservations } from "./spectrumSensors";
import { recordWarningDay, getWarningBaseline, getWarningAnomalyHistory, getMobilityBaseline, recordIndicatorDay, getIndicatorHistory, getLevelSeries } from "./warningStore";
import { getSensorBaseline, recordSensorDay } from "./sensorStore";
import { sensorKey } from "./sensorKeys";
import { leadIndicators, sparkCells, stateRun, STATE_ORDER, LEVEL_ORDER, type IndicatorDay, type LevelDay, type LeadRead, type SparkCell } from "./leadIndicators";

export interface IndicatorHistory { cells: SparkCell[]; run: number; observedDays: number }

export interface WarningAssessmentPlus extends WarningAssessment {
  sensorHealth: SensorHealth[];
  divergence: DivergenceState;
  /** Per-indicator 14-day sparkline + run length (PLAN §5 C1); absent on an old cache entry. */
  history?: Record<string, IndicatorHistory>;
  /** Which indicators stepped up before the board's level-ups. */
  lead?: LeadRead;
}

const TTL = 10 * 60 * 1000;
const cache = new Map<string, { at: number; data: WarningAssessmentPlus }>();

export function resetWarningCache(): void { cache.clear(); }

export async function assessWarning(problemId: string): Promise<WarningAssessmentPlus | null> {
  const resolved = await resolveWarningProblem(problemId);
  if (!resolved) return null;
  const { def, geo } = resolved;

  const hit = cache.get(problemId);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const observedAt = new Date().toISOString();
  const day = observedAt.slice(0, 10); // UTC YYYY-MM-DD

  // The observed-mobility baseline feeds the divergence sensor (surge is
  // relative to this AOR's own normal, not a static bar).
  const none = { mean: null as number | null, samples: 0, kind: "none" as const };
  const [mobilityBaseline, pntBase, ransomBase] = await Promise.all([
    getMobilityBaseline(problemId, day, 30).catch(() => none),
    getSensorBaseline(`pnt:${problemId}`, day, 30).catch(() => none),
    getSensorBaseline(`ransom:${problemId}`, day, 30).catch(() => none),
  ]);
  const classic = await gatherObservations(mobilityBaseline, geo);
  // The spectrum indicators (PNT / cyber / space) ride the same request,
  // corroborated by the own-source slice the classic sensors just gathered.
  const spectrum = await gatherSpectrumObservations(geo, problemId, { pnt: pntBase, ransom: ransomBase }, classic.userNews)
    .catch(() => ({ observations: [], health: [{ indicatorId: "pnt_denial", live: false, note: "spectrum sensors failed" }], magnitudes: { pntCells: null, victims: null } }));
  const observations = [...classic.observations, ...spectrum.observations];
  const health: SensorHealth[] = [...classic.health, ...spectrum.health];
  const { divergence } = classic;
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

  // Persist today's rollup incl. the day-peak mobility count (fire-and-forget —
  // a DB hiccup must not fail the read). Only record a count the ADS-B sensor
  // actually produced — a dead feed must not write a fake 0 into the baseline.
  const mobilityLive = health.find((h) => h.indicatorId === "mobility_divergence")?.live ?? false;
  recordWarningDay(problemId, day, assessment.rawScore, assessment.anomaly, assessment.level, mobilityLive ? divergence.observedCount : null).catch(() => {});
  // Spectrum sensor counts → their own baselines (null when the feed was dead — nothing written).
  recordSensorDay(`pnt:${problemId}`, day, spectrum.magnitudes.pntCells).catch(() => {});
  recordSensorDay(`ransom:${problemId}`, day, spectrum.magnitudes.victims).catch(() => {});

  // Per-indicator state of record (PLAN §5 C1) — what the composite row
  // cannot say. `live` from the sensor health so a dead day is hollow.
  const liveOf = new Map(health.map((h) => [h.indicatorId, h.live]));
  recordIndicatorDay(problemId, day, assessment.indicators.map((i) => ({
    indicatorId: i.id, state: i.state, score: i.contribution, confidence: i.confidence, live: liveOf.get(i.id) ?? true,
  }))).catch(() => {});
  // Per-hub lift (PLAN §5 C2): only when the ADS-B feed answered.
  if (mobilityLive) {
    for (const h of divergence.byHub ?? []) {
      recordSensorDay(sensorKey("mob", h.icao), day, h.mobility).catch(() => {});
      recordSensorDay(sensorKey("tanker", h.icao), day, h.tanker).catch(() => {});
    }
  }

  // History reads for the board: per-indicator sparklines + run lengths and
  // the lead-indicator read (three level-ups before any claim). Read AFTER
  // today's write so today's cell is included; both fail-safe.
  const [indHist, levels] = await Promise.all([
    getIndicatorHistory(problemId, 60).catch(() => ({} as Record<string, { day: string; state: string; live: boolean }[]>)),
    getLevelSeries(problemId, 60).catch(() => [] as { day: string; level: string }[]),
  ]);
  const todayInd = new Map(assessment.indicators.map((i) => [i.id, { day, state: i.state, live: liveOf.get(i.id) ?? true }]));
  const indicatorDays: Record<string, IndicatorDay[]> = {};
  for (const [id, rows] of Object.entries(indHist)) {
    const clean = rows.filter((r) => STATE_ORDER.includes(r.state as ObservedState)).map((r) => ({ day: r.day, state: r.state as ObservedState, live: r.live }));
    if (!clean.some((r) => r.day === day) && todayInd.has(id)) clean.push(todayInd.get(id)!);
    indicatorDays[id] = clean;
  }
  for (const [id, t] of todayInd) if (!indicatorDays[id]) indicatorDays[id] = [t];
  const levelDays: LevelDay[] = levels.filter((l) => LEVEL_ORDER.includes(l.level as WarningLevel)).map((l) => ({ day: l.day, level: l.level as WarningLevel }));
  if (!levelDays.some((l) => l.day === day)) levelDays.push({ day, level: assessment.level });
  const history: Record<string, IndicatorHistory> = {};
  for (const [id, rows] of Object.entries(indicatorDays)) {
    const run = stateRun(rows);
    history[id] = { cells: sparkCells(rows, 14), run: run.run, observedDays: rows.filter((r) => r.live).length };
  }
  const lead = leadIndicators(levelDays, indicatorDays);

  const data: WarningAssessmentPlus = { ...assessment, sensorHealth: health, divergence, history, lead };
  cache.set(problemId, { at: Date.now(), data });
  return data;
}
