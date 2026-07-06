import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { isOwner } from "./allowlist";
// Email scoping for reads/mutations: exact-email rows, plus pre-multi-user
// '' rows which belong to the OWNER (single-user-era legacy).
function scopeClause(email: string): { clause: string; params: string[] } {
  return isOwner(email)
    ? { clause: "user_email IN (?, '')", params: [email] }
    : { clause: "user_email = ?", params: [email] };
}

import { SavedItem } from "./types";

interface SavedRow extends RowDataPacket {
  id: string;
  type: string;
  title: string;
  content: string;
  source: string;
  link: string | null;
  saved_at: Date;
}

function rowToItem(r: SavedRow): SavedItem {
  return {
    id: r.id,
    type: r.type as SavedItem["type"],
    title: r.title,
    content: r.content,
    source: r.source,
    link: r.link ?? undefined,
    savedAt: r.saved_at.toISOString(),
  };
}

export async function getSaved(email: string): Promise<SavedItem[]> {
  const pool = await getDb();
  const sc = scopeClause(email);
  const [rows] = await pool.query<SavedRow[]>(
    `SELECT id, type, title, content, source, link, saved_at FROM saved_items WHERE ${sc.clause} ORDER BY saved_at DESC`,
    sc.params
  );
  return rows.map(rowToItem);
}

export async function addSaved(email: string, item: SavedItem): Promise<void> {
  const pool = await getDb();
  await pool.execute(
    `INSERT IGNORE INTO saved_items (id, user_email, type, title, content, source, link, saved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      email,
      item.type,
      item.title,
      item.content,
      item.source,
      item.link ?? null,
      new Date(item.savedAt),
    ]
  );
}

export async function removeSaved(email: string, id: string): Promise<void> {
  const pool = await getDb();
  const sc = scopeClause(email);
  await pool.execute(`DELETE FROM saved_items WHERE id = ? AND ${sc.clause}`, [id, ...sc.params]);
}
