// Persistence for imported X (Twitter) posts — server-only. The pure parsing
// lives in lib/xImport.ts; this module owns the x_items table: idempotent
// upserts keyed by post id, the rolling prune (14 days, fair by handle —
// lib/xRetention), and a short in-process cache so the 90-second OSINT feed
// poll doesn't hit MySQL on every request.
//
// Two reads from one cached query: `getXItems(limit)` = the newest posts
// (default 400 — the OSINT feed, the country room, the I&W escalation
// corroboration, whose scorers have no time window of their own), and
// `getXItemsWindow()` = every stored post in the 14-day window, for the
// readers that window by date themselves (lift chatter, posture moves,
// themes).

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getDb } from "./db";
import type { XCapture, XPostMetrics, XQuoted } from "./xImport";
import { fairKeep, X_STORE_MAX_DAYS, X_STORE_TOTAL, X_PER_HANDLE_FLOOR } from "./xRetention";

const MAX_AGE_DAYS = X_STORE_MAX_DAYS;
const CACHE_TTL_MS = 60_000;
/** Read bound: the store's cap plus the floors' overhang. */
const READ_MAX = X_STORE_TOTAL + 2000;

export interface StoredXItem {
  id: string;
  url: string;
  author: string;
  handle: string;
  postedAt: string | null;   // ISO
  text: string;
  metrics: XPostMetrics | null;
  quoted: XQuoted | null;
  sourceKind: string;
  sourceLabel: string;
  importedAt: string;        // ISO
}

export interface XImportResult {
  imported: number;   // new rows
  updated: number;    // existing rows refreshed
}

export interface XStatus {
  count: number;
  newest: string | null;                          // ISO of freshest post
  sources: { label: string; count: number }[];    // top labels by row count
}

interface XRow extends RowDataPacket {
  id: string; url: string; author: string; handle: string;
  posted_at: Date | null; text: string;
  metrics: unknown; quoted: unknown;
  source_kind: string; source_label: string; imported_at: Date;
}

let cache: { items: StoredXItem[]; expires: number } | null = null;

export function resetXCache(): void {
  cache = null;
}

// mysql2 returns JSON columns already parsed on most configs but as strings on
// others — normalize both.
function asJson<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === "object") return v as T;
  if (typeof v === "string") {
    try { return JSON.parse(v) as T; } catch { return null; }
  }
  return null;
}

export async function importXCapture(capture: XCapture): Promise<XImportResult> {
  const pool = await getDb();
  let imported = 0;
  let updated = 0;
  for (const p of capture.items) {
    const [res] = await pool.execute<ResultSetHeader>(
      `INSERT INTO x_items (id, url, author, handle, posted_at, text, metrics, quoted, source_kind, source_label, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE
         url = VALUES(url), author = VALUES(author), handle = VALUES(handle),
         posted_at = COALESCE(VALUES(posted_at), posted_at),
         text = VALUES(text), metrics = VALUES(metrics), quoted = VALUES(quoted),
         source_kind = VALUES(source_kind), source_label = VALUES(source_label)`,
      [
        p.id, p.url, p.author, p.handle,
        p.time ? new Date(p.time) : null,
        p.text,
        p.metrics ? JSON.stringify(p.metrics) : null,
        p.quoted ? JSON.stringify(p.quoted) : null,
        capture.source.kind, capture.source.label,
      ]
    );
    // mysql2 affectedRows: 1 = inserted, 2 = duplicate-key updated,
    // 0 = duplicate with identical values (count that as updated too).
    if (res.affectedRows === 1) imported++;
    else updated++;
  }

  // Rolling prune — age first, then FAIR BY HANDLE (lib/xRetention): each
  // handle keeps its newest posts inside the window, the cap fills
  // newest-first. A newest-N-overall cap let two busy news lists push a
  // quiet spotter's posts out within a day.
  await pool.execute(`DELETE FROM x_items WHERE imported_at < DATE_SUB(NOW(3), INTERVAL ${MAX_AGE_DAYS} DAY)`);
  interface IdRow extends RowDataPacket { id: string; handle: string; ts: Date }
  const [idRows] = await pool.query<IdRow[]>(`SELECT id, handle, COALESCE(posted_at, imported_at) AS ts FROM x_items`);
  const keep = fairKeep(idRows.map((r) => ({ id: r.id, handle: r.handle, ts: new Date(r.ts).getTime() })), Date.now(),
    { total: X_STORE_TOTAL, perHandleFloor: X_PER_HANDLE_FLOOR, maxDays: MAX_AGE_DAYS });
  const drop = idRows.map((r) => r.id).filter((id) => !keep.has(id));
  for (let i = 0; i < drop.length; i += 500) {
    await pool.query(`DELETE FROM x_items WHERE id IN (?)`, [drop.slice(i, i + 500)]);
  }

  resetXCache();
  return { imported, updated };
}

async function readAll(): Promise<StoredXItem[]> {
  if (cache && cache.expires > Date.now()) return cache.items;
  const pool = await getDb();
  const [rows] = await pool.query<XRow[]>(
    `SELECT id, url, author, handle, posted_at, text, metrics, quoted, source_kind, source_label, imported_at
     FROM x_items ORDER BY COALESCE(posted_at, imported_at) DESC LIMIT ${READ_MAX}`
  );
  const items = rows.map((r) => ({
    id: r.id,
    url: r.url,
    author: r.author,
    handle: r.handle,
    postedAt: r.posted_at ? new Date(r.posted_at).toISOString() : null,
    text: r.text,
    metrics: asJson<XPostMetrics>(r.metrics),
    quoted: asJson<XQuoted>(r.quoted),
    sourceKind: r.source_kind,
    sourceLabel: r.source_label,
    importedAt: new Date(r.imported_at).toISOString(),
  }));
  cache = { items, expires: Date.now() + CACHE_TTL_MS };
  return items;
}

/** The newest `limit` posts (default 400) — for readers with no time window
 *  of their own (the OSINT feed, the country room, I&W escalation). */
export async function getXItems(limit = 400): Promise<StoredXItem[]> {
  return (await readAll()).slice(0, limit);
}

/** Every stored post in the 14-day window (fair by handle) — for readers
 *  that window by date themselves: lift chatter, posture moves, themes. */
export async function getXItemsWindow(): Promise<StoredXItem[]> {
  return readAll();
}

interface CountRow extends RowDataPacket { cnt: number; newest: Date | null }
interface SourceRow extends RowDataPacket { source_label: string; cnt: number }

export async function getXStatus(): Promise<XStatus> {
  const pool = await getDb();
  const [[agg]] = await pool.query<CountRow[]>(
    "SELECT COUNT(*) AS cnt, MAX(COALESCE(posted_at, imported_at)) AS newest FROM x_items"
  );
  const [srcRows] = await pool.query<SourceRow[]>(
    "SELECT source_label, COUNT(*) AS cnt FROM x_items GROUP BY source_label ORDER BY cnt DESC LIMIT 6"
  );
  return {
    count: Number(agg?.cnt ?? 0),
    newest: agg?.newest ? new Date(agg.newest).toISOString() : null,
    sources: srcRows.map((r) => ({ label: r.source_label, count: Number(r.cnt) })),
  };
}

export async function clearXItems(): Promise<void> {
  const pool = await getDb();
  await pool.execute("DELETE FROM x_items");
  resetXCache();
}
