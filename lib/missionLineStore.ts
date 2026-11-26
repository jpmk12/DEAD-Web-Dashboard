// Mission line rows — server-only persistence. All judgement lives in the
// PURE lib/missionLines.ts (the validator) and lib/lineRead.ts (the join).
// Shared and crew-maintained, attributed by email — the crew_state model.

import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import type { LineDraft, MissionLine, LineAirframe, LineStatus, LineOutcome } from "./missionLines";
import { isLineOutcome } from "./missionLines";
import type { LineReadDay } from "./lineVerify";
import type { LineDriverKind, LineLed } from "./lineRead";

interface Row extends RowDataPacket {
  id: string; day: string; airframe: string; fields: unknown; status: string; updated_by: string | null; updated_at: Date;
  outcome?: string | null; outcome_by?: string | null; outcome_at?: Date | null;
}

const toLine = (r: Row): MissionLine => {
  let fields: string[] = [];
  try {
    const raw = typeof r.fields === "string" ? JSON.parse(r.fields) : r.fields;
    if (Array.isArray(raw)) fields = raw.map(String);
  } catch { fields = []; }
  return {
    id: r.id, day: String(r.day).slice(0, 10), airframe: r.airframe as LineAirframe, fields,
    status: r.status as LineStatus, updatedBy: r.updated_by ?? "", updatedAt: r.updated_at ? r.updated_at.toISOString() : "",
    outcome: isLineOutcome(r.outcome) ? r.outcome : null,
    outcomeBy: r.outcome_by ?? null,
    outcomeAt: r.outcome_at ? r.outcome_at.toISOString() : null,
  };
};

/** Lines whose day is inside [fromDay, toDay]. NULL when the store did not
 *  answer — a dead database is UNAVAILABLE, never "no lines". */
export async function listLines(fromDay: string, toDay: string): Promise<MissionLine[] | null> {
  try {
    const pool = await getDb();
    const [rows] = await pool.query<Row[]>(
      `SELECT * FROM mission_lines WHERE day >= ? AND day <= ? ORDER BY day ASC, airframe ASC, updated_at ASC LIMIT 200`,
      [fromDay, toDay],
    );
    return rows.map(toLine);
  } catch {
    return null;
  }
}

export async function upsertLine(draft: LineDraft, by: string, id?: string): Promise<MissionLine | null> {
  try {
    const pool = await getDb();
    const lineId = id && /^[0-9a-f-]{36}$/i.test(id) ? id : randomUUID();
    const now = new Date();
    await pool.execute(
      `INSERT INTO mission_lines (id, day, airframe, fields, status, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE day = VALUES(day), airframe = VALUES(airframe), fields = VALUES(fields), status = VALUES(status), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
      [lineId, draft.day, draft.airframe, JSON.stringify(draft.fields), draft.status, by.slice(0, 255), now],
    );
    return { id: lineId, day: draft.day, airframe: draft.airframe, fields: draft.fields, status: draft.status, updatedBy: by, updatedAt: now.toISOString() };
  } catch {
    return null;
  }
}

export async function deleteLine(id: string): Promise<boolean> {
  try {
    const pool = await getDb();
    const [res] = await pool.execute(`DELETE FROM mission_lines WHERE id = ?`, [id]);
    return (res as { affectedRows?: number }).affectedRows === 1;
  } catch {
    return false;
  }
}

export async function getLine(id: string): Promise<MissionLine | null | undefined> {
  try {
    const pool = await getDb();
    const [rows] = await pool.query<Row[]>(`SELECT * FROM mission_lines WHERE id = ? LIMIT 1`, [id]);
    return rows[0] ? toLine(rows[0]) : undefined;
  } catch {
    return null;
  }
}

/** Set (or clear, with null) how a line went. The route checks the day first. */
export async function setLineOutcome(id: string, outcome: LineOutcome | null, by: string): Promise<boolean> {
  try {
    const pool = await getDb();
    const [res] = await pool.execute(
      `UPDATE mission_lines SET outcome = ?, outcome_by = ?, outcome_at = ? WHERE id = ?`,
      [outcome, outcome ? by.slice(0, 255) : null, outcome ? new Date() : null, id],
    );
    return (res as { affectedRows?: number }).affectedRows === 1;
  } catch {
    return false;
  }
}

const LED_RANK: Record<LineLed, number> = { g: 0, u: 1, a: 2, r: 3 };

/** Record the day's read of each line — the worst read of the day wins
 *  (day-peak; a same-level later read refreshes the kinds and the lead).
 *  Best-effort: a failed write never fails the read. */
export async function recordLineReads(rows: LineReadDay[], lineDays: Record<string, string>): Promise<void> {
  if (!rows.length) return;
  try {
    const pool = await getDb();
    for (const r of rows) {
      // worst_rank is assigned LAST: MySQL evaluates the SET left to right,
      // so the conditions above it still see the stored rank.
      await pool.execute(
        `INSERT INTO line_read_daily (line_id, observed_day, line_day, lead_days, worst, worst_rank, kinds, lead_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           line_day  = VALUES(line_day),
           lead_days = VALUES(lead_days),
           worst     = IF(VALUES(worst_rank) >= worst_rank, VALUES(worst), worst),
           kinds     = IF(VALUES(worst_rank) >= worst_rank, VALUES(kinds), kinds),
           lead_text = IF(VALUES(worst_rank) >= worst_rank, VALUES(lead_text), lead_text),
           worst_rank = GREATEST(worst_rank, VALUES(worst_rank))`,
        [r.lineId, r.observedDay, lineDays[r.lineId] ?? r.observedDay, r.leadDays, r.worst, LED_RANK[r.worst], JSON.stringify(r.kinds), r.lead],
      );
    }
  } catch { /* best-effort */ }
}

interface ReadRow extends RowDataPacket { line_id: string; observed_day: string; lead_days: number; worst: string; kinds: unknown; lead_text: string | null }

/** Stored reads for these lines; NULL when the store did not answer. */
export async function lineReadHistory(lineIds: string[]): Promise<LineReadDay[] | null> {
  if (!lineIds.length) return [];
  try {
    const pool = await getDb();
    const [rows] = await pool.query<ReadRow[]>(
      `SELECT line_id, observed_day, lead_days, worst, kinds, lead_text FROM line_read_daily WHERE line_id IN (${lineIds.map(() => "?").join(",")})`,
      lineIds,
    );
    return rows.map((r) => {
      let kinds: LineDriverKind[] = [];
      try { const k = typeof r.kinds === "string" ? JSON.parse(r.kinds) : r.kinds; if (Array.isArray(k)) kinds = k.map(String) as LineDriverKind[]; } catch { kinds = []; }
      const worst = (["g", "u", "a", "r"].includes(r.worst) ? r.worst : "u") as LineLed;
      return { lineId: r.line_id, observedDay: String(r.observed_day).slice(0, 10), leadDays: Number(r.lead_days), worst, kinds, lead: r.lead_text };
    });
  } catch {
    return null;
  }
}

/** Lines with an outcome, newest first (the verifier's input); NULL when the store did not answer. */
export async function listScoredLines(sinceDay: string): Promise<MissionLine[] | null> {
  try {
    const pool = await getDb();
    const [rows] = await pool.query<Row[]>(
      `SELECT * FROM mission_lines WHERE outcome IS NOT NULL AND day >= ? ORDER BY day DESC LIMIT 1000`, [sinceDay],
    );
    return rows.map(toLine);
  } catch {
    return null;
  }
}

/** Retention: a read and a scored line are history for a year; reads of lines
 *  never scored go after 120 days. */
export async function pruneLineReads(): Promise<void> {
  try {
    const pool = await getDb();
    const yearAgo = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
    const old = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
    await pool.execute(`DELETE FROM line_read_daily WHERE line_day < ?`, [yearAgo]);
    await pool.execute(
      `DELETE d FROM line_read_daily d LEFT JOIN mission_lines l ON l.id = d.line_id WHERE d.line_day < ? AND (l.id IS NULL OR l.outcome IS NULL)`, [old],
    );
  } catch { /* best-effort */ }
}
