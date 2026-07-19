// Captured-article persistence — server-only. Pure parsing lives in
// lib/articleCapture; this owns the captured_articles table: idempotent upsert
// by id, a rolling prune (60 days / newest 500), a short read cache, and the
// NewsItem projection used by the OSINT feed + the I&W corroboration layer.

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import type { StoredArticleDraft } from "./articleCapture";
import type { NewsItem } from "./types";

export interface StoredArticle extends StoredArticleDraft {}

const READ_TTL = 60_000;
let cache: { at: number; items: StoredArticle[] } | null = null;

export async function upsertArticle(a: StoredArticleDraft, userEmail: string): Promise<void> {
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO captured_articles (id, url, title, byline, published_at, source, text, user_email, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE title = VALUES(title), byline = VALUES(byline), published_at = VALUES(published_at),
       source = VALUES(source), text = VALUES(text), captured_at = VALUES(captured_at)`,
    [a.id, a.url, a.title, a.byline, a.publishedAt, a.source, a.text, userEmail, new Date(a.capturedAt)],
  );
  // Rolling prune: drop anything older than 60 days, then trim to the newest 500.
  await pool.execute("DELETE FROM captured_articles WHERE captured_at < (NOW(3) - INTERVAL 60 DAY)").catch(() => {});
  await pool.execute(
    `DELETE FROM captured_articles WHERE id NOT IN (SELECT id FROM (SELECT id FROM captured_articles ORDER BY captured_at DESC LIMIT 500) t)`,
  ).catch(() => {});
  cache = null;
}

interface Row extends RowDataPacket {
  id: string; url: string; title: string; byline: string | null;
  published_at: string | null; source: string; text: string; captured_at: Date;
}

export async function getCapturedArticles(limit = 200): Promise<StoredArticle[]> {
  if (cache && Date.now() - cache.at < READ_TTL) return cache.items;
  const pool = await getDb();
  const [rows] = await pool.query<Row[]>(
    "SELECT id, url, title, byline, published_at, source, text, captured_at FROM captured_articles ORDER BY captured_at DESC LIMIT ?",
    [limit],
  );
  const items: StoredArticle[] = rows.map((r) => ({
    id: r.id, url: r.url, title: r.title, byline: r.byline,
    publishedAt: r.published_at, source: r.source, text: r.text,
    capturedAt: r.captured_at.toISOString(),
  }));
  cache = { at: Date.now(), items };
  return items;
}

export async function getArticleStatus(): Promise<{ count: number; newest: string | null; sources: { label: string; count: number }[] }> {
  const items = await getCapturedArticles(500).catch(() => [] as StoredArticle[]);
  const bySource = new Map<string, number>();
  for (const a of items) bySource.set(a.source, (bySource.get(a.source) ?? 0) + 1);
  return {
    count: items.length,
    newest: items[0]?.capturedAt ?? null,
    sources: [...bySource.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
  };
}

export async function clearArticles(): Promise<void> {
  const pool = await getDb();
  await pool.execute("DELETE FROM captured_articles");
  cache = null;
}

// Projection for the OSINT feed / I&W corroboration. `bodyChars` controls how
// much of the article the escalation scanner sees (I&W wants more than a feed row).
export function articleToNewsItem(a: StoredArticle, bodyChars = 600): NewsItem {
  return {
    id: `cap-${a.id}`,
    title: a.title,
    source: a.source,
    category: "analysis",
    pubDate: a.publishedAt ?? a.capturedAt,
    summary: a.text.slice(0, bodyChars),
    link: a.url,
  };
}
