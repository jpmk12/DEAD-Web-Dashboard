import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { isOwner } from "./currentUser";

// One row per (local-date, user_email). Pre-multi-user rows carry
// user_email = '' and are honoured as the OWNER's legacy rows: reads prefer
// the exact-email row and fall back to '' only for the owner. Bump by
// deleting the row or passing refresh=1 to /api/briefing.

export interface CachedBriefing {
  headline: string;
  schedule: string[];
  keyDevelopments: string[];
  topStories: string[];
  connections: string;
  suggestedFocus: string[];
}

interface CacheRow extends RowDataPacket {
  briefing: CachedBriefing;
  generated_at: string | number;
  tz: string;
}

// Returns the cached briefing for `date` ONLY when its stored tz matches the
// caller's current pref — changing timezone mid-day should regenerate.
export async function getCachedBriefing(date: string, tz: string, email: string): Promise<{ briefing: CachedBriefing; generatedAt: number } | null> {
  const pool = await getDb();
  const [rows] = await pool.query<(CacheRow & { user_email: string })[]>(
    "SELECT briefing, generated_at, tz, user_email FROM briefing_cache WHERE date = ? AND user_email IN (?, '')",
    [date, email]
  );
  const row = rows.find((r) => r.user_email === email)
    ?? (isOwner(email) ? rows.find((r) => r.user_email === "") : undefined);
  if (!row) return null;
  if (row.tz && row.tz !== tz) return null;
  return {
    briefing: row.briefing,
    generatedAt: Number(row.generated_at) || 0,
  };
}

export async function saveCachedBriefing(date: string, tz: string, briefing: CachedBriefing, email: string): Promise<void> {
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO briefing_cache (date, user_email, tz, briefing, generated_at)
     VALUES (?, ?, ?, CAST(? AS JSON), ?)
     ON DUPLICATE KEY UPDATE
       briefing     = VALUES(briefing),
       generated_at = VALUES(generated_at),
       tz           = VALUES(tz)`,
    [date, email, tz, JSON.stringify(briefing), Date.now()]
  );
  // Best-effort: prune anything older than 7 days so the table stays bounded.
  pool
    .execute(
      "DELETE FROM briefing_cache WHERE generated_at < ?",
      [Date.now() - 7 * 24 * 60 * 60 * 1000]
    )
    .catch((err) => console.error("Briefing cache prune failed:", err));
}

// Drop cached briefings so the next /api/briefing regenerates from scratch.
// Called when preferences change — home location, role, priority topics, and
// timezone all feed the brief, and the cache is keyed only by date+tz, so
// without this a settings edit is masked by the already-generated brief until
// the date rolls over (e.g. changing home shows the old location all day).
export async function clearBriefingCache(): Promise<void> {
  const pool = await getDb();
  await pool.execute("DELETE FROM briefing_cache");
}
