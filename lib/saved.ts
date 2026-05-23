import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
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

export async function getSaved(): Promise<SavedItem[]> {
  const pool = await getDb();
  const [rows] = await pool.query<SavedRow[]>(
    "SELECT id, type, title, content, source, link, saved_at FROM saved_items ORDER BY saved_at DESC"
  );
  return rows.map(rowToItem);
}

export async function addSaved(item: SavedItem): Promise<void> {
  const pool = await getDb();
  await pool.execute(
    `INSERT IGNORE INTO saved_items (id, type, title, content, source, link, saved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.type,
      item.title,
      item.content,
      item.source,
      item.link ?? null,
      new Date(item.savedAt),
    ]
  );
}

export async function removeSaved(id: string): Promise<void> {
  const pool = await getDb();
  await pool.execute("DELETE FROM saved_items WHERE id = ?", [id]);
}
