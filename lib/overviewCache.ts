import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { NewsItem } from "./types";

// One row per local-date key (YYYY-MM-DD in the user's timezone). The Overview
// is curated once per day and frozen here, so it costs one Claude call/day and
// the day's must-reads don't churn as RSS feeds roll. Single-user dashboard, so
// a global key per date is fine. The full NewsItem objects are stored (not just
// ids) so the list still renders after the source feeds drop older articles.

export interface CachedOverview {
  critical: NewsItem[];
  discover: NewsItem[];
  mode: "ai" | "deterministic";
}

interface CacheRow extends RowDataPacket {
  payload: CachedOverview;
  generated_at: string | number;
  tz: string;
  ctx_hash: string;
}

// Returns the cached Overview for `date` only when its stored tz AND ctx_hash
// match the caller's current prefs. tz mismatch means the calendar day shifted;
// ctx_hash mismatch means the user edited role/topics/watchlist — both should
// regenerate rather than serve a snapshot built for different inputs.
export async function getCachedOverview(
  date: string,
  tz: string,
  ctxHash: string
): Promise<{ payload: CachedOverview; generatedAt: number } | null> {
  const pool = await getDb();
  const [rows] = await pool.query<CacheRow[]>(
    "SELECT payload, generated_at, tz, ctx_hash FROM news_overview_cache WHERE date = ?",
    [date]
  );
  if (rows.length === 0) return null;
  if (rows[0].tz && rows[0].tz !== tz) return null;
  if ((rows[0].ctx_hash ?? "") !== ctxHash) return null;
  return {
    payload: rows[0].payload,
    generatedAt: Number(rows[0].generated_at) || 0,
  };
}

export async function saveCachedOverview(
  date: string,
  tz: string,
  ctxHash: string,
  payload: CachedOverview
): Promise<void> {
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO news_overview_cache (date, tz, ctx_hash, payload, generated_at)
     VALUES (?, ?, ?, CAST(? AS JSON), ?)
     ON DUPLICATE KEY UPDATE
       payload      = VALUES(payload),
       generated_at = VALUES(generated_at),
       tz           = VALUES(tz),
       ctx_hash     = VALUES(ctx_hash)`,
    [date, tz, ctxHash, JSON.stringify(payload), Date.now()]
  );
  // Best-effort: prune anything older than 7 days so the table stays bounded.
  pool
    .execute("DELETE FROM news_overview_cache WHERE generated_at < ?", [
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ])
    .catch((err) => console.error("Overview cache prune failed:", err));
}
