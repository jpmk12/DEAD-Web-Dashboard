// I&W daily rollup store — server-only. One row per warning problem per UTC day
// (latest score wins). The baseline is the trailing-mean raw_score over prior
// days, which is what makes the board score ANOMALY (delta) instead of level
// (§2.3). Same lazy day-rollup pattern as sitrep_status_daily.

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import type { WarningLevel } from "./warning";

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

interface MobilityRow extends RowDataPacket { mobility_count: number | null }

// Trailing mobility baseline: mean of prior days' peak mobility counts. What
// "normal lift near the AOR hubs" looks like — the observed half of the
// divergence is scored against THIS, not a static threshold.
export async function getMobilityBaseline(
  problemId: string,
  today: string,
  days = 30,
): Promise<{ mean: number | null; samples: number }> {
  const pool = await getDb();
  const [rows] = await pool.query<MobilityRow[]>(
    `SELECT mobility_count FROM warning_daily
     WHERE problem_id = ? AND day < ? AND mobility_count IS NOT NULL
     ORDER BY day DESC LIMIT ?`,
    [problemId, today, days],
  );
  if (!rows.length) return { mean: null, samples: 0 };
  const mean = rows.reduce((s, r) => s + Number(r.mobility_count), 0) / rows.length;
  return { mean, samples: rows.length };
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
