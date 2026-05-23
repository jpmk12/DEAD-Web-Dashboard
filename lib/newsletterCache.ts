import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { NewsletterSummary } from "./types";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheRow extends RowDataPacket {
  id: string;
  summary: NewsletterSummary;
  cached_at: string | number; // mysql2 returns BIGINT as string by default
}

function rowSummary(r: CacheRow): NewsletterSummary {
  return r.summary;
}

// Return cached summaries for a given set of email IDs (only non-expired ones)
export async function getCachedSummaries(ids: string[]): Promise<Map<string, NewsletterSummary>> {
  const result = new Map<string, NewsletterSummary>();
  if (ids.length === 0) return result;
  const pool = await getDb();
  const cutoff = Date.now() - CACHE_TTL_MS;
  const [rows] = await pool.query<CacheRow[]>(
    `SELECT id, summary, cached_at FROM newsletter_cache
     WHERE id IN (?) AND cached_at >= ?`,
    [ids, cutoff]
  );
  for (const r of rows) result.set(r.id, rowSummary(r));
  return result;
}

// Return all non-expired cached summaries (for showing persisted results on reload)
export async function getAllCachedSummaries(): Promise<NewsletterSummary[]> {
  const pool = await getDb();
  const cutoff = Date.now() - CACHE_TTL_MS;
  const [rows] = await pool.query<CacheRow[]>(
    "SELECT id, summary, cached_at FROM newsletter_cache WHERE cached_at >= ? ORDER BY cached_at DESC",
    [cutoff]
  );
  return rows.map(rowSummary);
}

// Persist new summaries (only those with actual bullets). Fire-and-forget at the call site.
export async function cacheSummaries(summaries: NewsletterSummary[]): Promise<void> {
  const toCache = summaries.filter((s) => s.bullets.length > 0);
  if (toCache.length === 0) return;

  const pool = await getDb();
  const now = Date.now();

  // Bulk upsert
  const placeholders = toCache.map(() => "(?, CAST(? AS JSON), ?)").join(",");
  const values: (string | number)[] = [];
  for (const s of toCache) {
    values.push(s.id, JSON.stringify(s), now);
  }
  await pool.query(
    `INSERT INTO newsletter_cache (id, summary, cached_at)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       summary   = VALUES(summary),
       cached_at = VALUES(cached_at)`,
    values
  );

  // Prune expired entries (best-effort)
  pool
    .execute("DELETE FROM newsletter_cache WHERE cached_at < ?", [now - CACHE_TTL_MS])
    .catch((err) => console.error("Newsletter cache prune failed:", err));
}
