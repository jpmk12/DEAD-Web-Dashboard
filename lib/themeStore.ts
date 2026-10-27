// Declared-theme rows — server-only persistence. All judgement lives in the
// PURE lib/themes.ts. Shared and crew-maintained (any allowlisted member),
// attributed by email — the crew_state / mission_lines model.

import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import type { Theme, ThemeDraft } from "./themes";

interface Row extends RowDataPacket {
  id: string; name: string; phrases: unknown; by_email: string | null; updated_at: Date;
}

const toTheme = (r: Row): Theme => {
  let phrases: string[] = [];
  try {
    const raw = typeof r.phrases === "string" ? JSON.parse(r.phrases) : r.phrases;
    if (Array.isArray(raw)) phrases = raw.map(String);
  } catch { phrases = []; }
  return { id: r.id, name: r.name, phrases, by: r.by_email ?? "", updatedAt: r.updated_at ? r.updated_at.toISOString() : "" };
};

/** Every declared theme, oldest first. NULL when the store did not answer —
 *  a dead database is UNAVAILABLE, never "no themes". */
export async function listThemes(): Promise<Theme[] | null> {
  try {
    const pool = await getDb();
    const [rows] = await pool.query<Row[]>(`SELECT * FROM osint_themes ORDER BY updated_at ASC LIMIT 100`);
    return rows.map(toTheme);
  } catch {
    return null;
  }
}

export async function upsertTheme(draft: ThemeDraft, by: string, id?: string): Promise<Theme | null> {
  try {
    const pool = await getDb();
    const themeId = id && /^[0-9a-f-]{36}$/i.test(id) ? id : randomUUID();
    const now = new Date();
    await pool.execute(
      `INSERT INTO osint_themes (id, name, phrases, by_email, updated_at) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), phrases = VALUES(phrases), by_email = VALUES(by_email), updated_at = VALUES(updated_at)`,
      [themeId, draft.name, JSON.stringify(draft.phrases), by.slice(0, 255), now],
    );
    return { id: themeId, name: draft.name, phrases: draft.phrases, by, updatedAt: now.toISOString() };
  } catch {
    return null;
  }
}

export async function deleteTheme(id: string): Promise<boolean> {
  try {
    const pool = await getDb();
    const [res] = await pool.execute(`DELETE FROM osint_themes WHERE id = ?`, [id]);
    return (res as { affectedRows?: number }).affectedRows === 1;
  } catch {
    return false;
  }
}
