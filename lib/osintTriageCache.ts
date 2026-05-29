import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";

export type OsintPriority = "High" | "Medium" | "Low";
export interface CachedOsintTriage {
  id: string;
  priority: OsintPriority;
  reason: string;
  promptHash: string;
}

// Shorter TTL than email — OSINT context is more time-sensitive, and a stale
// "Medium" tag on a 2-week-old item is misleading. Items rarely persist that
// long anyway; this just keeps the table small.
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

interface CacheRow extends RowDataPacket {
  id: string;
  priority: OsintPriority;
  reason: string;
}

// Look up triage decisions for a set of OSINT item ids. Only returns rows
// where the prompt hash matches AND the row is within TTL. Items whose
// context (role / topics / watchlist / AOR) changed since the last triage
// get a different hash and silently miss the cache, forcing a re-classify.
export async function getCachedOsintTriage(
  ids: string[],
  promptHash: string,
): Promise<Map<string, { priority: OsintPriority; reason: string }>> {
  const result = new Map<string, { priority: OsintPriority; reason: string }>();
  if (ids.length === 0) return result;
  const pool = await getDb();
  const cutoff = Date.now() - CACHE_TTL_MS;

  const [rows] = await pool.query<CacheRow[]>(
    `SELECT id, priority, reason FROM osint_triage_cache
     WHERE id IN (?) AND prompt_hash = ? AND cached_at >= ?`,
    [ids, promptHash, cutoff],
  );
  for (const r of rows) result.set(r.id, { priority: r.priority, reason: r.reason });
  return result;
}

// Bulk upsert. Fire-and-forget at the call site.
export async function cacheOsintTriage(rows: CachedOsintTriage[]): Promise<void> {
  if (rows.length === 0) return;
  const pool = await getDb();
  const now = Date.now();

  const placeholders = rows.map(() => "(?, ?, ?, ?, ?)").join(",");
  const values: (string | number)[] = [];
  for (const r of rows) {
    // Cap reason to 120 chars to match column size; Claude is asked for <60
    // but defensive truncation here makes the column constraint impossible
    // to violate.
    values.push(r.id, r.priority, (r.reason || "").slice(0, 120), r.promptHash, now);
  }
  await pool.query(
    `INSERT INTO osint_triage_cache (id, priority, reason, prompt_hash, cached_at)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       priority    = VALUES(priority),
       reason      = VALUES(reason),
       prompt_hash = VALUES(prompt_hash),
       cached_at   = VALUES(cached_at)`,
    values,
  );

  // Best-effort prune
  pool
    .execute("DELETE FROM osint_triage_cache WHERE cached_at < ?", [now - CACHE_TTL_MS])
    .catch((err) => console.error("OSINT triage cache prune failed:", err));
}
