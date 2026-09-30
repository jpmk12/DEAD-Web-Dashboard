// I&W daily rollup store — server-only. One row per warning problem per UTC day
// (latest score wins). The baseline is the trailing-mean raw_score over prior
// days, which is what makes the board score ANOMALY (delta) instead of level
// (§2.3). Same lazy day-rollup pattern as sitrep_status_daily.

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import type { WarningLevel } from "./warning";
import type { MobilityBaseline } from "./warningRules";
import { flatBaseline, weekdayBaseline, type SeriesPoint } from "./series";

export async function recordWarningDay(
  problemId: string,
  day: string,
  rawScore: number,
  anomaly: number,
  level: WarningLevel,
  mobilityCount: number | null = null,
): Promise<void> {
  const pool = await getDb();
  // mobility_count keeps the DAY'S PEAK (GREATEST) — a surge at 0900 that
  // recedes by 1500 is still that day's mobility fact for baseline purposes.
  await pool.execute(
    `INSERT INTO warning_daily (problem_id, day, raw_score, anomaly, level, mobility_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(3))
     ON DUPLICATE KEY UPDATE raw_score = VALUES(raw_score), anomaly = VALUES(anomaly), level = VALUES(level),
       mobility_count = GREATEST(COALESCE(mobility_count, 0), COALESCE(VALUES(mobility_count), 0)), updated_at = NOW(3)`,
    [problemId, day, rawScore, anomaly, level, mobilityCount],
  );
}

interface MobilityRow extends RowDataPacket { day: string; mobility_count: number | null }

// Trailing mobility baseline: mean of prior days' peak mobility counts. What
// "normal lift near the AOR hubs" looks like — the observed half of the
// divergence is scored against THIS, not a static threshold. Also returns the
// SAME-WEEKDAY mean over ~13 weeks (lib/series.weekdayBaseline), which the
// surge rule prefers once four of that weekday exist.
export async function getMobilityBaseline(
  problemId: string,
  today: string,
  days = 30,
): Promise<MobilityBaseline> {
  const pool = await getDb();
  const [rows] = await pool.query<MobilityRow[]>(
    `SELECT day, mobility_count FROM warning_daily
     WHERE problem_id = ? AND day < ? AND mobility_count IS NOT NULL
     ORDER BY day DESC LIMIT ?`,
    [problemId, today, Math.max(days, 91)],
  );
  if (!rows.length) return { mean: null, samples: 0, weekdayMean: null, weekdaySamples: 0 };
  const series: SeriesPoint[] = rows.map((r) => ({ day: String(r.day), value: Number(r.mobility_count) })).reverse();
  const flat = flatBaseline(series, today, days);
  const wk = weekdayBaseline(series, today);
  return { mean: flat.mean, samples: flat.samples, weekdayMean: wk.mean, weekdaySamples: wk.samples };
}

interface ScoreRow extends RowDataPacket { raw_score: number; anomaly: number }

// Trailing baseline: mean raw_score over the `days` most recent days BEFORE
// today. Returns null baseline when there's no history (cold start → learning).
export async function getWarningBaseline(
  problemId: string,
  today: string,
  days = 30,
): Promise<{ baseline: number | null; samples: number }> {
  const pool = await getDb();
  const [rows] = await pool.query<ScoreRow[]>(
    `SELECT raw_score FROM warning_daily WHERE problem_id = ? AND day < ? ORDER BY day DESC LIMIT ?`,
    [problemId, today, days],
  );
  if (!rows.length) return { baseline: null, samples: 0 };
  const mean = rows.reduce((s, r) => s + Number(r.raw_score), 0) / rows.length;
  return { baseline: mean, samples: rows.length };
}

// Prior days' anomaly, oldest → newest (today is appended by the caller once
// known) — the series trajectoryFor reads.
export async function getWarningAnomalyHistory(
  problemId: string,
  today: string,
  days = 10,
): Promise<number[]> {
  const pool = await getDb();
  const [rows] = await pool.query<ScoreRow[]>(
    `SELECT anomaly FROM warning_daily WHERE problem_id = ? AND day < ? ORDER BY day DESC LIMIT ?`,
    [problemId, today, days],
  );
  return rows.map((r) => Number(r.anomaly)).reverse();
}

// ── Per-indicator daily state ───────────────────────────────────────────────
export interface IndicatorDayRow { indicatorId: string; state: string; score: number; confidence: number; live: boolean }

/** LAST policy: the day's latest assessment is the state of record. */
export async function recordIndicatorDay(problemId: string, day: string, rows: IndicatorDayRow[]): Promise<void> {
  if (!rows.length) return;
  const pool = await getDb();
  const placeholders: string[] = [];
  const values: (string | number)[] = [];
  for (const r of rows) {
    placeholders.push("(?, ?, ?, ?, ?, ?, ?, NOW(3))");
    values.push(problemId, r.indicatorId.slice(0, 64), day, r.state, r.score, r.confidence, r.live ? 1 : 0);
  }
  await pool.execute(
    `INSERT INTO indicator_daily (problem_id, indicator_id, day, state, score, confidence, live, updated_at)
     VALUES ${placeholders.join(", ")}
     ON DUPLICATE KEY UPDATE state = VALUES(state), score = VALUES(score), confidence = VALUES(confidence), live = VALUES(live), updated_at = NOW(3)`,
    values,
  );
}

interface IndRow extends RowDataPacket { indicator_id: string; day: string; state: string; live: number }

/** Per indicator, the last `days` calendar days of recorded state, oldest first. */
export async function getIndicatorHistory(problemId: string, days = 60): Promise<Record<string, { day: string; state: string; live: boolean }[]>> {
  const pool = await getDb();
  const cutoff = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const [rows] = await pool.query<IndRow[]>(
    `SELECT indicator_id, day, state, live FROM indicator_daily WHERE problem_id = ? AND day >= ? ORDER BY day ASC`,
    [problemId, cutoff],
  );
  const out: Record<string, { day: string; state: string; live: boolean }[]> = {};
  for (const r of rows) (out[String(r.indicator_id)] ||= []).push({ day: String(r.day), state: String(r.state), live: Number(r.live) === 1 });
  return out;
}

/** One problem's daily level, oldest first, for the lead-indicator read. */
export async function getLevelSeries(problemId: string, days = 60): Promise<{ day: string; level: string }[]> {
  const pool = await getDb();
  const cutoff = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT day, level FROM warning_daily WHERE problem_id = ? AND day >= ? ORDER BY day ASC`,
    [problemId, cutoff],
  );
  return rows.map((r) => ({ day: String(r.day), level: String(r.level) }));
}

// Every problem's daily level in one query, for the OE delta.
export async function getWarningLevelHistory(days = 14): Promise<Record<string, { day: string; level: string; anomaly: number }[]>> {
  try {
    const pool = await getDb();
    const cutoff = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT problem_id, day, level, anomaly FROM warning_daily WHERE day >= ? ORDER BY day ASC`,
      [cutoff],
    );
    const out: Record<string, { day: string; level: string; anomaly: number }[]> = {};
    for (const r of rows) {
      (out[String(r.problem_id)] ||= []).push({
        day: String(r.day), level: String(r.level), anomaly: Number(r.anomaly) || 0,
      });
    }
    return out;
  } catch {
    return {};
  }
}
