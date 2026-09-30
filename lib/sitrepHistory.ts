// Daily SITREP status history (worst LED per axis per UTC day). Server-only.
// Fire-and-forget writes from the assembler; the pane reads the last 7 days
// for the trend strip and changed-since-yesterday markers. The infra and
// spectrum LEDs joined the row in PLAN §6 D1 (nullable — an older row is
// unobserved on those axes, never green).

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
  infra?: Led | null;
  spectrum?: Led | null;
}

interface Row extends RowDataPacket { day: string; icao: string; wx: string; ops: string; threat: string; infra: string | null; spectrum: string | null }

const asLed = (v: string | null | undefined): Led => (v === "g" || v === "a" || v === "r" ? v : "u");
const asLedOrNull = (v: string | null | undefined): Led | null => (v == null ? null : asLed(v));

// Upsert today's row, keeping the WORST value seen per axis (a base that went
// amber at 0900Z stays amber for the day even if the 1500Z refresh is green).
export async function recordSitrepDay(icao: string, status: { wx: Led; ops: Led; threat: Led; infra?: Led; spectrum?: Led }): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const pool = await getDb();
  const [rows] = await pool.query<Row[]>(
    "SELECT day, icao, wx, ops, threat, infra, spectrum FROM sitrep_status_daily WHERE day = ? AND icao = ?",
    [day, icao]
  );
  const prev = rows[0];
  const infra = status.infra ?? null;
  const spectrum = status.spectrum ?? null;
  const next = prev
    ? {
        wx: worse(asLed(prev.wx), status.wx), ops: worse(asLed(prev.ops), status.ops), threat: worse(asLed(prev.threat), status.threat),
        infra: infra == null ? asLedOrNull(prev.infra) : worse(asLed(prev.infra), infra),
        spectrum: spectrum == null ? asLedOrNull(prev.spectrum) : worse(asLed(prev.spectrum), spectrum),
      }
    : { wx: status.wx, ops: status.ops, threat: status.threat, infra, spectrum };
  await pool.execute(
    `INSERT INTO sitrep_status_daily (day, icao, wx, ops, threat, infra, spectrum) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE wx = VALUES(wx), ops = VALUES(ops), threat = VALUES(threat), infra = VALUES(infra), spectrum = VALUES(spectrum)`,
    [day, icao, next.wx, next.ops, next.threat, next.infra, next.spectrum]
  );
}

export async function getSitrepHistory(icao: string, days = 7): Promise<SitrepDay[]> {
  const pool = await getDb();
  const [rows] = await pool.query<Row[]>(
    "SELECT day, icao, wx, ops, threat, infra, spectrum FROM sitrep_status_daily WHERE icao = ? ORDER BY day DESC LIMIT ?",
    [icao, days]
  );
  return rows.map((r) => ({ day: r.day, wx: asLed(r.wx), ops: asLed(r.ops), threat: asLed(r.threat), infra: asLedOrNull(r.infra), spectrum: asLedOrNull(r.spectrum) })).reverse();
}

// Every base's daily LEDs in one query, for the OE delta. Raw rows rather than
// SitrepDay so this reader owes nothing to the strip's presentation shape.
export async function getAllSitrepHistory(days = 14): Promise<Record<string, { day: string; wx: string; ops: string; threat: string; infra: string | null; spectrum: string | null }[]>> {
  try {
    const pool = await getDb();
    const cutoff = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT day, icao, wx, ops, threat, infra, spectrum FROM sitrep_status_daily WHERE day >= ? ORDER BY day ASC`,
      [cutoff],
    );
    const out: Record<string, { day: string; wx: string; ops: string; threat: string; infra: string | null; spectrum: string | null }[]> = {};
    for (const r of rows) {
      (out[String(r.icao)] ||= []).push({
        day: String(r.day), wx: String(r.wx), ops: String(r.ops), threat: String(r.threat),
        infra: r.infra == null ? null : String(r.infra), spectrum: r.spectrum == null ? null : String(r.spectrum),
      });
    }
    return out;
  } catch {
    return {};   // best-effort: no history is "no delta", never an error
  }
}
