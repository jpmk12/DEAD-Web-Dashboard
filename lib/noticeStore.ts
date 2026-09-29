// Captured-notice persistence — server-only. Pure parsing lives in
// lib/noticeCapture; this owns captured_notices: idempotent upsert by id, a
// rolling prune (180 days / newest 500 — a notice is a standing record, not a
// feed item, so it keeps longer than events), and a short read cache.

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import type { StoredNoticeDraft } from "./noticeCapture";

export interface StoredNotice extends StoredNoticeDraft {}

const READ_TTL = 60_000;
let cache: { at: number; items: StoredNotice[] } | null = null;

export async function upsertNotices(notices: StoredNoticeDraft[], userEmail: string): Promise<{ imported: number }> {
  if (!notices.length) return { imported: 0 };
  const pool = await getDb();
  for (const n of notices) {
    await pool.execute(
      `INSERT INTO captured_notices (id, url, title, body, published_on, host, source, user_email, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), body = COALESCE(VALUES(body), body),
         published_on = COALESCE(VALUES(published_on), published_on), source = VALUES(source), captured_at = VALUES(captured_at)`,
      [n.id, n.url, n.title, n.body, n.publishedOn, n.host, n.source, userEmail, new Date(n.capturedAt)],
    );
  }
  await pool.execute("DELETE FROM captured_notices WHERE captured_at < (NOW(3) - INTERVAL 180 DAY)").catch(() => {});
  await pool.execute(
    `DELETE FROM captured_notices WHERE id NOT IN (SELECT id FROM (SELECT id FROM captured_notices ORDER BY captured_at DESC LIMIT 500) t)`,
  ).catch(() => {});
  cache = null;
  return { imported: notices.length };
}

interface Row extends RowDataPacket {
  id: string; url: string; title: string; body: string | null;
  published_on: string | null; host: string; source: string; captured_at: Date;
}

export async function getCapturedNotices(limit = 300): Promise<StoredNotice[]> {
  if (cache && Date.now() - cache.at < READ_TTL) return cache.items;
  const pool = await getDb();
  const [rows] = await pool.query<Row[]>(
    "SELECT id, url, title, body, published_on, host, source, captured_at FROM captured_notices ORDER BY COALESCE(published_on, '') DESC, captured_at DESC LIMIT ?",
    [limit],
  );
  const items: StoredNotice[] = rows.map((r) => ({
    id: r.id, url: r.url, title: r.title, body: r.body, publishedOn: r.published_on,
    host: r.host, source: r.source, capturedAt: r.captured_at.toISOString(),
  }));
  cache = { at: Date.now(), items };
  return items;
}

export async function getNoticeStatus(): Promise<{ count: number; newest: string | null; sources: { label: string; count: number }[] }> {
  const items = await getCapturedNotices(500).catch(() => [] as StoredNotice[]);
  const bySource = new Map<string, number>();
  for (const n of items) bySource.set(n.source, (bySource.get(n.source) ?? 0) + 1);
  return {
    count: items.length,
    newest: items.reduce<string | null>((m, n) => (!m || n.capturedAt > m ? n.capturedAt : m), null),
    sources: [...bySource].map(([label, count]) => ({ label, count })),
  };
}

export async function clearNotices(): Promise<void> {
  const pool = await getDb();
  await pool.execute("DELETE FROM captured_notices");
  cache = null;
}
