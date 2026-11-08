// Declared-theme rows — server-only persistence. All judgement lives in the
// PURE lib/themes.ts and lib/themeTuning.ts. Shared and crew-maintained (any
// allowlisted member), attributed by email — the crew_state / mission_lines
// model.

import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import type { Theme, ThemeDraft } from "./themes";
import type { ThemeFeedback, ThemeVerdict } from "./themeTuning";

interface Row extends RowDataPacket {
  id: string; name: string; phrases: unknown; boards?: unknown; exclude?: unknown; dismissed?: unknown; by_email: string | null; updated_at: Date;
}

const jsonList = (v: unknown): string[] => {
  try {
    const raw = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(raw) ? raw.map(String) : [];
  } catch { return []; }
};

const toTheme = (r: Row): Theme => ({
  id: r.id, name: r.name,
  phrases: jsonList(r.phrases), boards: jsonList(r.boards),
  exclude: jsonList(r.exclude), dismissed: jsonList(r.dismissed),
  by: r.by_email ?? "", updatedAt: r.updated_at ? r.updated_at.toISOString() : "",
});

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

/** One theme, NULL when absent or the store did not answer (the caller says which via listThemes when it matters). */
export async function getTheme(id: string): Promise<Theme | null> {
  try {
    const pool = await getDb();
    const [rows] = await pool.query<Row[]>(`SELECT * FROM osint_themes WHERE id = ? LIMIT 1`, [id]);
    return rows[0] ? toTheme(rows[0]) : null;
  } catch {
    return null;
  }
}

export async function upsertTheme(draft: ThemeDraft, by: string, id?: string): Promise<Theme | null> {
  try {
    const pool = await getDb();
    const themeId = id && /^[0-9a-f-]{36}$/i.test(id) ? id : randomUUID();
    const now = new Date();
    const exclude = draft.exclude ?? [];
    await pool.execute(
      `INSERT INTO osint_themes (id, name, phrases, boards, exclude, by_email, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), phrases = VALUES(phrases), boards = VALUES(boards), exclude = VALUES(exclude), by_email = VALUES(by_email), updated_at = VALUES(updated_at)`,
      [themeId, draft.name, JSON.stringify(draft.phrases), JSON.stringify(draft.boards ?? []), JSON.stringify(exclude), by.slice(0, 255), now],
    );
    return await getTheme(themeId) ?? { id: themeId, name: draft.name, phrases: draft.phrases, boards: draft.boards ?? [], exclude, dismissed: [], by, updatedAt: now.toISOString() };
  } catch {
    return null;
  }
}

/** Record a declined suggestion ("never suggest") — permanent, deduped, capped. */
export async function addDismissed(themeId: string, term: string): Promise<boolean> {
  const t = term.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!t) return false;
  try {
    const theme = await getTheme(themeId);
    if (!theme) return false;
    const list = theme.dismissed ?? [];
    if (list.some((d) => d.toLowerCase() === t.toLowerCase())) return true;
    const next = [...list, t].slice(-200);
    const pool = await getDb();
    await pool.execute(`UPDATE osint_themes SET dismissed = ? WHERE id = ?`, [JSON.stringify(next), themeId]);
    return true;
  } catch {
    return false;
  }
}

interface FbRow extends RowDataPacket { theme_id: string; item_id: string; verdict: string; phrase: string; by_email: string | null; created_at: Date }

const toFeedback = (r: FbRow): ThemeFeedback => ({
  themeId: r.theme_id, itemId: r.item_id, verdict: r.verdict === "no" ? "no" : "yes",
  phrase: r.phrase ?? "", by: r.by_email ?? "", at: r.created_at ? r.created_at.toISOString() : "",
});

/** The crew's marks on one theme (or every theme when no id). NULL when the store did not answer. */
export async function listFeedback(themeId?: string): Promise<ThemeFeedback[] | null> {
  try {
    const pool = await getDb();
    const [rows] = themeId
      ? await pool.query<FbRow[]>(`SELECT * FROM theme_feedback WHERE theme_id = ? ORDER BY created_at DESC LIMIT 2000`, [themeId])
      : await pool.query<FbRow[]>(`SELECT * FROM theme_feedback ORDER BY created_at DESC LIMIT 5000`);
    return rows.map(toFeedback);
  } catch {
    return null;
  }
}

/** Mark an item ✓ / ✕ for a theme, or clear the mark (verdict null). */
export async function setFeedback(themeId: string, itemId: string, verdict: ThemeVerdict | null, phrase: string, by: string): Promise<boolean> {
  try {
    const pool = await getDb();
    if (verdict === null) {
      await pool.execute(`DELETE FROM theme_feedback WHERE theme_id = ? AND item_id = ?`, [themeId, itemId.slice(0, 255)]);
      return true;
    }
    await pool.execute(
      `INSERT INTO theme_feedback (theme_id, item_id, verdict, phrase, by_email, created_at) VALUES (?, ?, ?, ?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE verdict = VALUES(verdict), phrase = VALUES(phrase), by_email = VALUES(by_email), created_at = VALUES(created_at)`,
      [themeId, itemId.slice(0, 255), verdict, phrase.slice(0, 60), by.slice(0, 255)],
    );
    return true;
  } catch {
    return false;
  }
}

export async function deleteTheme(id: string): Promise<boolean> {
  try {
    const pool = await getDb();
    const [res] = await pool.execute(`DELETE FROM osint_themes WHERE id = ?`, [id]);
    const ok = (res as { affectedRows?: number }).affectedRows === 1;
    if (ok) await pool.execute(`DELETE FROM theme_feedback WHERE theme_id = ?`, [id]).catch(() => {});
    return ok;
  } catch {
    return false;
  }
}
