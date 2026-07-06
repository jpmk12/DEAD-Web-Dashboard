import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { isOwner } from "./currentUser";

// "Surfaces" are top-level views the user scans for new content. The dashboard
// records when they last visited each so the next visit can dim items older
// than that timestamp ("what changed since I last looked").
export type Surface = "email" | "news" | "newsletters" | "osint";

const VALID_SURFACES = new Set<Surface>(["email", "news", "newsletters", "osint"]);

interface SurfaceRow extends RowDataPacket {
  surface: string;
  user_email: string;
  last_seen_at: string | number; // BIGINT
}

export function isValidSurface(s: string): s is Surface {
  return VALID_SURFACES.has(s as Surface);
}

export async function getAllLastSeen(email: string): Promise<Record<Surface, number>> {
  const pool = await getDb();
  const [rows] = await pool.query<SurfaceRow[]>(
    "SELECT surface, user_email, last_seen_at FROM surface_state WHERE user_email IN (?, '')",
    [email]
  );
  const result: Record<Surface, number> = { email: 0, news: 0, newsletters: 0, osint: 0 };
  // Exact-email rows win; '' legacy rows count only for the owner.
  const legacyOk = isOwner(email);
  for (const pass of ["", email]) {
    for (const r of rows) {
      if (r.user_email !== pass) continue;
      if (pass === "" && !legacyOk) continue;
      if (isValidSurface(r.surface)) result[r.surface] = Number(r.last_seen_at) || 0;
    }
  }
  return result;
}

export async function bumpLastSeen(email: string, surface: Surface, when: number = Date.now()): Promise<void> {
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO surface_state (surface, user_email, last_seen_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE last_seen_at = VALUES(last_seen_at)`,
    [surface, email, when]
  );
}
