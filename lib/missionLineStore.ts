// Mission line rows — server-only persistence. All judgement lives in the
// PURE lib/missionLines.ts (the validator) and lib/lineRead.ts (the join).
// Shared and crew-maintained, attributed by email — the crew_state model.

import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import type { LineDraft, MissionLine, LineAirframe, LineStatus } from "./missionLines";

interface Row extends RowDataPacket {
  id: string; day: string; airframe: string; fields: unknown; status: string; updated_by: string | null; updated_at: Date;
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
