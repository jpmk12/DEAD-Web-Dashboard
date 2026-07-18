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
): Promise<void> {
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO warning_daily (problem_id, day, raw_score, anomaly, level, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW(3))
     ON DUPLICATE KEY UPDATE raw_score = VALUES(raw_score), anomaly = VALUES(anomaly), level = VALUES(level), updated_at = NOW(3)`,
    [problemId, day, rawScore, anomaly, level],
  );
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
