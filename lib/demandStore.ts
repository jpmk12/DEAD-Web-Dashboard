// Demand-horizon history — server-only. One row per (day, aor): the day's
// LAST outlook is the forecast of record (a forecast revised at 1500Z
// supersedes the 0900Z one). Read back by lib/demandVerifyAssemble to score
// outlooks whose 7-day window has closed.

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import type { DemandDriver, DemandOutlook } from "./demandHorizon";

export interface StoredOutlook {
  day: string;
  aor: string;
  direction: DemandOutlook["direction"];
  score: number;
  confidence: DemandOutlook["confidence"];
  drivers: DemandDriver[];
}

export async function recordDemandOutlooks(day: string, outlooks: DemandOutlook[]): Promise<void> {
  if (!outlooks.length) return;
  const pool = await getDb();
  const placeholders: string[] = [];
  const values: (string | number)[] = [];
  for (const o of outlooks) {
    placeholders.push("(?, ?, ?, ?, ?, ?, NOW(3))");
    const drivers = o.drivers.slice(0, 12).map((d) => ({ source: d.source, delta: d.delta, text: d.text.slice(0, 160) }));
    values.push(day, o.aor, o.direction, o.score, o.confidence, JSON.stringify(drivers));
  }
  await pool.execute(
    `INSERT INTO demand_horizon_daily (day, aor, direction, score, confidence, drivers, updated_at)
     VALUES ${placeholders.join(", ")}
     ON DUPLICATE KEY UPDATE direction = VALUES(direction), score = VALUES(score), confidence = VALUES(confidence),
       drivers = VALUES(drivers), updated_at = NOW(3)`,
    values,
  );
}

interface Row extends RowDataPacket { day: string; aor: string; direction: string; score: number; confidence: string; drivers: unknown }

export async function getDemandOutlookHistory(days = 45): Promise<StoredOutlook[]> {
  const pool = await getDb();
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const [rows] = await pool.query<Row[]>(
    `SELECT day, aor, direction, score, confidence, drivers FROM demand_horizon_daily WHERE day >= ? ORDER BY day ASC`,
    [cutoff],
  );
  return rows.map((r) => {
    let drivers: DemandDriver[] = [];
    try {
      const raw = typeof r.drivers === "string" ? JSON.parse(r.drivers) : r.drivers;
      if (Array.isArray(raw)) drivers = raw.filter((d) => d && typeof d.source === "string" && typeof d.delta === "number").map((d) => ({ source: d.source, delta: d.delta, text: String(d.text ?? "") }));
    } catch { /* malformed → no drivers */ }
    return {
      day: String(r.day), aor: String(r.aor),
      direction: (["rise", "hold", "fall"].includes(r.direction) ? r.direction : "hold") as DemandOutlook["direction"],
      score: Number(r.score) || 0,
      confidence: (["low", "medium", "high"].includes(r.confidence) ? r.confidence : "low") as DemandOutlook["confidence"],
      drivers,
    };
  });
}

interface MobRow extends RowDataPacket { problem_id: string; day: string; mobility_count: number }

/** Day-peak mobility per problem for the last `days`, for the verifier's proxy. */
export async function getMobilityHistory(days = 60): Promise<{ problemId: string; day: string; count: number }[]> {
  const pool = await getDb();
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const [rows] = await pool.query<MobRow[]>(
    `SELECT problem_id, day, mobility_count FROM warning_daily WHERE day >= ? AND mobility_count IS NOT NULL ORDER BY day ASC`,
    [cutoff],
  );
  return rows.map((r) => ({ problemId: String(r.problem_id), day: String(r.day), count: Number(r.mobility_count) }));
}
