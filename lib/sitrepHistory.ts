// Daily SITREP status history (worst LED per axis per UTC day). Server-only.
// Fire-and-forget writes from the assembler; the pane reads the last 7 days
// for the trend strip and changed-since-yesterday markers.

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import type { Led } from "./sitrepSignals";

const RANK: Record<Led, number> = { u: 0, g: 1, a: 2, r: 3 };
const worse = (a: Led, b: Led): Led => (RANK[a] >= RANK[b] ? a : b);

export interface SitrepDay {
  day: string;   // YYYY-MM-DD (UTC)
  wx: Led;
  ops: Led;
  threat: Led;
}

interface Row extends RowDataPacket { day: string; icao: string; wx: string; ops: string; threat: string }

const asLed = (v: string): Led => (v === "g" || v === "a" || v === "r" ? v : "u");

// Upsert today's row, keeping the WORST value seen per axis (a base that went
// amber at 0900Z stays amber for the day even if the 1500Z refresh is green).
export async function recordSitrepDay(icao: string, status: { wx: Led; ops: Led; threat: Led }): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const pool = await getDb();
  const [rows] = await pool.query<Row[]>(
    "SELECT day, icao, wx, ops, threat FROM sitrep_status_daily WHERE day = ? AND icao = ?",
    [day, icao]
  );
  const prev = rows[0];
  const next = prev
    ? { wx: worse(asLed(prev.wx), status.wx), ops: worse(asLed(prev.ops), status.ops), threat: worse(asLed(prev.threat), status.threat) }
    : status;
  await pool.execute(
    `INSERT INTO sitrep_status_daily (day, icao, wx, ops, threat) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE wx = VALUES(wx), ops = VALUES(ops), threat = VALUES(threat)`,
    [day, icao, next.wx, next.ops, next.threat]
  );
}

export async function getSitrepHistory(icao: string, days = 7): Promise<SitrepDay[]> {
  const pool = await getDb();
  const [rows] = await pool.query<Row[]>(
    "SELECT day, icao, wx, ops, threat FROM sitrep_status_daily WHERE icao = ? ORDER BY day DESC LIMIT ?",
    [icao, days]
  );
  return rows.map((r) => ({ day: r.day, wx: asLed(r.wx), ops: asLed(r.ops), threat: asLed(r.threat) })).reverse();
}
