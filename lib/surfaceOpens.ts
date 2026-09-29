// Server-only persistence for open-tracking (`surface_opens`). All judgement
// lives in the PURE lib/openSignal.ts; this file only counts and lists.
//
// Personal: keyed by user_email, and — unlike the tables that predate the
// multi-user split — there are no legacy '' rows to honour, so reads are an
// exact-email match. Writes are fire-and-forget from the client; a failed
// write is a lost count, never an error the user sees.

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { isOpenSurface, type OpenRow, type OpenSurface } from "./openSignal";

interface Row extends RowDataPacket {
  surface: string;
  item_id: string;
  opens: number;
  last_open_at: string | number;
}

export async function noteOpen(email: string, surface: OpenSurface, id: string, when = Date.now()): Promise<void> {
  if (!email || !isOpenSurface(surface) || !id) return;
  try {
    const pool = await getDb();
    await pool.execute(
      `INSERT INTO surface_opens (surface, item_id, user_email, opens, last_open_at)
       VALUES (?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE opens = opens + 1, last_open_at = VALUES(last_open_at)`,
      [surface, id.slice(0, 128), email, when],
    );
  } catch {
    /* a lost count is not an error */
  }
}

/** This user's open rows, most recent first. */
export async function listOpens(email: string, limit = 200): Promise<OpenRow[]> {
  if (!email) return [];
  try {
    const pool = await getDb();
    const [rows] = await pool.query<Row[]>(
      `SELECT surface, item_id, opens, last_open_at FROM surface_opens
        WHERE user_email = ? ORDER BY last_open_at DESC LIMIT ?`,
      [email, Math.min(500, Math.max(1, limit))],
    );
    return rows
      .filter((r) => isOpenSurface(r.surface))
      .map((r) => ({ surface: r.surface as OpenSurface, id: r.item_id, opens: Number(r.opens) || 0, lastOpenAt: Number(r.last_open_at) || 0 }));
  } catch {
    return [];
  }
}
