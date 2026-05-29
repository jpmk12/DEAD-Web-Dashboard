import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";

// One row per local-date key (YYYY-MM-DD in the user's timezone). The dashboard
// is single-user so global keys are fine. Bump by deleting the row or passing
// refresh=1 to /api/briefing.

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
}

export async function getCachedBriefing(date: string): Promise<{ briefing: CachedBriefing; generatedAt: number } | null> {
  const pool = await getDb();
  const [rows] = await pool.query<CacheRow[]>(
    "SELECT briefing, generated_at FROM briefing_cache WHERE date = ?",
    [date]
  );
  if (rows.length === 0) return null;
  return {
    briefing: rows[0].briefing,
    generatedAt: Number(rows[0].generated_at) || 0,
  };
}

export async function saveCachedBriefing(date: string, briefing: CachedBriefing): Promise<void> {
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO briefing_cache (date, briefing, generated_at)
     VALUES (?, CAST(? AS JSON), ?)
     ON DUPLICATE KEY UPDATE
       briefing     = VALUES(briefing),
       generated_at = VALUES(generated_at)`,
    [date, JSON.stringify(briefing), Date.now()]
  );
  // Best-effort: prune anything older than 7 days so the table stays bounded.
  pool
    .execute(
      "DELETE FROM briefing_cache WHERE generated_at < ?",
      [Date.now() - 7 * 24 * 60 * 60 * 1000]
    )
    .catch((err) => console.error("Briefing cache prune failed:", err));
}
