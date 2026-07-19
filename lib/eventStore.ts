// Captured-event persistence — server-only. Pure parsing lives in
// lib/eventCapture; this owns captured_events: idempotent upsert by id, a rolling
// prune (14 days / newest 1000, like x_items — these are ephemeral), a short read
// cache, and the OsintItem/NewsItem projection for the feed.

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import type { StoredEventDraft } from "./eventCapture";

export interface StoredEvent extends StoredEventDraft {}

const READ_TTL = 60_000;
let cache: { at: number; items: StoredEvent[] } | null = null;

export async function upsertEvents(events: StoredEventDraft[], userEmail: string): Promise<{ imported: number }> {
  if (!events.length) return { imported: 0 };
  const pool = await getDb();
  for (const e of events) {
    await pool.execute(
      `INSERT INTO captured_events (id, url, title, source_url, published_at, source, user_email, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), source_url = VALUES(source_url),
         published_at = VALUES(published_at), source = VALUES(source), captured_at = VALUES(captured_at)`,
      [e.id, e.url, e.title, e.sourceUrl, e.publishedAt, e.source, userEmail, new Date(e.capturedAt)],
    );
  }
  await pool.execute("DELETE FROM captured_events WHERE captured_at < (NOW(3) - INTERVAL 14 DAY)").catch(() => {});
  await pool.execute(
    `DELETE FROM captured_events WHERE id NOT IN (SELECT id FROM (SELECT id FROM captured_events ORDER BY captured_at DESC LIMIT 1000) t)`,
  ).catch(() => {});
  cache = null;
  return { imported: events.length };
}

interface Row extends RowDataPacket {
  id: string; url: string; title: string; source_url: string | null;
  published_at: string | null; source: string; captured_at: Date;
}

export async function getCapturedEvents(limit = 300): Promise<StoredEvent[]> {
  if (cache && Date.now() - cache.at < READ_TTL) return cache.items;
  const pool = await getDb();
  const [rows] = await pool.query<Row[]>(
    "SELECT id, url, title, source_url, published_at, source, captured_at FROM captured_events ORDER BY captured_at DESC LIMIT ?",
    [limit],
  );
  const items: StoredEvent[] = rows.map((r) => ({
    id: r.id, url: r.url, title: r.title, sourceUrl: r.source_url,
    publishedAt: r.published_at, source: r.source, capturedAt: r.captured_at.toISOString(),
  }));
  cache = { at: Date.now(), items };
  return items;
}

export async function getEventStatus(): Promise<{ count: number; newest: string | null; sources: { label: string; count: number }[] }> {
  const items = await getCapturedEvents(1000).catch(() => [] as StoredEvent[]);
  const bySource = new Map<string, number>();
  for (const e of items) bySource.set(e.source, (bySource.get(e.source) ?? 0) + 1);
  return {
    count: items.length,
    newest: items[0]?.capturedAt ?? null,
    sources: [...bySource.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
  };
}

export async function clearEvents(): Promise<void> {
  const pool = await getDb();
  await pool.execute("DELETE FROM captured_events");
  cache = null;
}
