import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { CachedEmailClassification, EmailPriority } from "./types";

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface CacheRow extends RowDataPacket {
  id: string;
  account_email: string;
  priority: EmailPriority;
  summary: string;
  dates: unknown;
  why: string | null;
}

export type CachedHit = { priority: EmailPriority; summary: string; dates?: CachedEmailClassification["dates"]; why?: string };

// Look up classifications for a set of (id, accountEmail) pairs. Only returns
// rows where prompt_hash matches AND cached_at is within TTL. The returned
// map is keyed by id alone — Gmail message ids are globally unique in
// practice, so this is unambiguous in normal use.
export async function getCachedClassifications(
  items: { id: string; accountEmail: string }[],
  promptHash: string,
): Promise<Map<string, CachedHit>> {
  const result = new Map<string, CachedHit>();
  if (items.length === 0) return result;
  const pool = await getDb();
  const cutoff = Date.now() - CACHE_TTL_MS;

  // Build (id, account_email) tuple list for IN clause.
  const tuples = items.map(() => "(?, ?)").join(",");
  const params: (string | number)[] = [];
  for (const it of items) params.push(it.id, it.accountEmail);
  params.push(promptHash, cutoff);

  const [rows] = await pool.query<CacheRow[]>(
    `SELECT id, account_email, priority, summary, dates, why FROM email_classification_cache
     WHERE (id, account_email) IN (${tuples})
       AND prompt_hash = ? AND cached_at >= ?`,
    params,
  );
  for (const r of rows) {
    result.set(r.id, { priority: r.priority, summary: r.summary, dates: Array.isArray(r.dates) ? (r.dates as CachedEmailClassification["dates"]) : undefined, why: r.why ?? undefined });
  }
  return result;
}

// Bulk upsert. Fire-and-forget at the call site.
export async function cacheClassifications(rows: CachedEmailClassification[]): Promise<void> {
  if (rows.length === 0) return;

  const pool = await getDb();
  const now = Date.now();

  const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)").join(",");
  const values: (string | number | null)[] = [];
  for (const r of rows) {
    values.push(r.id, r.accountEmail, r.priority, r.summary, r.promptHash, now, r.dates && r.dates.length ? JSON.stringify(r.dates) : null, r.why ? r.why.slice(0, 255) : null);
  }
  await pool.query(
    `INSERT INTO email_classification_cache
       (id, account_email, priority, summary, prompt_hash, cached_at, dates, why)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       priority    = VALUES(priority),
       summary     = VALUES(summary),
       prompt_hash = VALUES(prompt_hash),
       cached_at   = VALUES(cached_at),
       dates       = VALUES(dates),
       why         = VALUES(why)`,
    values,
  );

  // Prune expired entries (best-effort)
  pool
    .execute("DELETE FROM email_classification_cache WHERE cached_at < ?", [now - CACHE_TTL_MS])
    .catch((err) => console.error("Email cache prune failed:", err));
}
