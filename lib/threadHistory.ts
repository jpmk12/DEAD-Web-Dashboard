import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getDb } from "./db";
import type { ThreadsResult } from "./types";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface StoredThread {
  id: number;
  sessionId: number;
  label: string;
  headline: string;
  summary: string;
  trend: "rising" | "stable" | "fading";
  sources: string[];
  newsletterContext?: string;
}

export interface StoredSession {
  id: number;
  date: string;
  generatedAt: string;
  throughLine: string;
  articleCount: number;
  threads: StoredThread[];
}

export interface LabelOccurrence {
  date: string;
  trend: "rising" | "stable" | "fading";
  headline: string;
  sessionId: number;
}

export interface LabelSummary {
  label: string;
  occurrences: number;
  lastSeen: string;
  lastTrend: "rising" | "stable" | "fading";
  trajectoryScore: number;
  trendSparkline: string;
  isSustainedEscalation: boolean;
  isRemerging: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cutoff(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

const TREND_ICON = { rising: "↑", stable: "→", fading: "↓" } as const;

interface ThreadRow extends RowDataPacket {
  id: number;
  session_id: number;
  label: string;
  headline: string;
  summary: string;
  trend: string;
  sources: string[] | null;
  newsletter_context: string | null;
  article_ids: string[] | null;
}

interface SessionRow extends RowDataPacket {
  id: number;
  date: string;
  generated_at: Date;
  through_line: string;
  article_count: number;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

function rowToThread(row: ThreadRow): StoredThread {
  return {
    id: row.id,
    sessionId: row.session_id,
    label: row.label,
    headline: row.headline,
    summary: row.summary,
    trend: row.trend as StoredThread["trend"],
    sources: asStringArray(row.sources),
    newsletterContext: row.newsletter_context ?? undefined,
  };
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function saveSession(result: ThreadsResult, articleCount: number): Promise<void> {
  const pool = await getDb();
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Upsert session for today, then look up its id (LAST_INSERT_ID isn't reliable across upserts)
    await conn.execute(
      `INSERT INTO thread_sessions (date, generated_at, through_line, article_count)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         generated_at  = VALUES(generated_at),
         through_line  = VALUES(through_line),
         article_count = VALUES(article_count)`,
      [today, now, result.throughLine, articleCount]
    );

    const [idRows] = await conn.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM thread_sessions WHERE date = ?",
      [today]
    );
    const sessionId = idRows[0].id;

    // Clear any prior threads for this session, then re-insert
    await conn.execute("DELETE FROM threads WHERE session_id = ?", [sessionId]);

    for (const thread of result.threads) {
      await conn.execute(
        `INSERT INTO threads
           (session_id, label, headline, summary, trend, sources, newsletter_context, article_ids)
         VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?, CAST(? AS JSON))`,
        [
          sessionId,
          thread.label,
          thread.headline,
          thread.summary,
          thread.trend,
          JSON.stringify(thread.sources),
          thread.newsletterContext ?? null,
          JSON.stringify(thread.articleIds),
        ]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function getRecentSessions(days: number): Promise<StoredSession[]> {
  const pool = await getDb();
  const from = cutoff(days);

  const [sessions] = await pool.query<SessionRow[]>(
    "SELECT id, date, generated_at, through_line, article_count FROM thread_sessions WHERE date >= ? ORDER BY date DESC",
    [from]
  );
  if (sessions.length === 0) return [];

  const ids = sessions.map((s) => s.id);
  const [threadRows] = await pool.query<ThreadRow[]>(
    "SELECT id, session_id, label, headline, summary, trend, sources, newsletter_context, article_ids FROM threads WHERE session_id IN (?) ORDER BY session_id, id",
    [ids]
  );

  const threadsBySession = new Map<number, StoredThread[]>();
  for (const r of threadRows) {
    const arr = threadsBySession.get(r.session_id);
    if (arr) arr.push(rowToThread(r));
    else threadsBySession.set(r.session_id, [rowToThread(r)]);
  }

  return sessions.map((s) => ({
    id: s.id,
    date: s.date,
    generatedAt: s.generated_at.toISOString(),
    throughLine: s.through_line,
    articleCount: s.article_count,
    threads: threadsBySession.get(s.id) ?? [],
  }));
}

// Distinct labels seen recently, most-recent-then-most-frequent first. Fed
// back into the Threads prompt so a continuing story keeps the exact same
// label day over day — without this, "IRAN WAR" vs "IRAN CONFLICT" drift
// breaks every day-over-day trajectory the history panel and trend layer
// compute.
export async function getRecentLabels(days: number, limit = 20): Promise<string[]> {
  const pool = await getDb();
  const from = cutoff(days);
  const [rows] = await pool.query<(RowDataPacket & { label: string })[]>(
    `SELECT t.label
       FROM threads t
       JOIN thread_sessions s ON s.id = t.session_id
      WHERE s.date >= ?
      GROUP BY t.label
      ORDER BY MAX(s.date) DESC, COUNT(*) DESC
      LIMIT ${Math.max(1, Math.min(50, limit))}`,
    [from]
  );
  return rows.map((r) => r.label);
}

export async function getLabelHistory(label: string, days: number): Promise<LabelOccurrence[]> {
  const pool = await getDb();
  const [rows] = await pool.query<(RowDataPacket & {
    date: string;
    trend: string;
    headline: string;
    session_id: number;
  })[]>(
    `SELECT s.date, t.trend, t.headline, t.session_id
     FROM threads t
     JOIN thread_sessions s ON t.session_id = s.id
     WHERE t.label = ? AND s.date >= ?
     ORDER BY s.date ASC`,
    [label, cutoff(days)]
  );
  return rows.map((r) => ({
    date: r.date,
    trend: r.trend as LabelOccurrence["trend"],
    headline: r.headline,
    sessionId: r.session_id,
  }));
}

export async function getLabelSummaries(days: number): Promise<LabelSummary[]> {
  const pool = await getDb();
  const [rows] = await pool.query<(RowDataPacket & {
    label: string;
    date: string;
    trend: string;
  })[]>(
    `SELECT t.label, s.date, t.trend
     FROM threads t
     JOIN thread_sessions s ON t.session_id = s.id
     WHERE s.date >= ?
     ORDER BY t.label, s.date ASC`,
    [cutoff(days)]
  );

  const byLabel = new Map<string, Array<{ date: string; trend: string }>>();
  for (const row of rows) {
    const arr = byLabel.get(row.label);
    if (arr) arr.push({ date: row.date, trend: row.trend });
    else byLabel.set(row.label, [{ date: row.date, trend: row.trend }]);
  }

  const summaries: LabelSummary[] = [];

  for (const [label, occs] of byLabel) {
    const last = occs[occs.length - 1];
    const lastTrend = last.trend as LabelSummary["lastTrend"];

    let score = 0;
    occs.forEach((o, i) => {
      const w = (i + 1) / occs.length;
      const v = o.trend === "rising" ? 2 : o.trend === "stable" ? 0 : -1;
      score += v * w;
    });

    let isRemerging = false;
    if (occs.length >= 2 && lastTrend === "rising") {
      const prev = occs[occs.length - 2];
      const gap = (new Date(last.date).getTime() - new Date(prev.date).getTime()) / 86_400_000;
      if (gap >= 2 && (prev.trend === "fading" || prev.trend === "stable")) isRemerging = true;
    }

    const isSustainedEscalation = occs.length >= 3 && occs.slice(-3).every((o) => o.trend === "rising");

    summaries.push({
      label,
      occurrences: occs.length,
      lastSeen: last.date,
      lastTrend,
      trajectoryScore: Math.round(score * 10) / 10,
      trendSparkline: occs.map((o) => TREND_ICON[o.trend as keyof typeof TREND_ICON] ?? "→").join(" "),
      isSustainedEscalation,
      isRemerging,
    });
  }

  return summaries.sort((a, b) => {
    if (a.isSustainedEscalation !== b.isSustainedEscalation)
      return b.isSustainedEscalation ? 1 : -1;
    if (a.isRemerging !== b.isRemerging)
      return b.isRemerging ? 1 : -1;
    return b.trajectoryScore - a.trajectoryScore;
  });
}

export async function searchThreads(
  query: string,
  days?: number,
): Promise<Array<StoredThread & { date: string }>> {
  const pool = await getDb();
  const from = days ? cutoff(days) : "2000-01-01";

  // MySQL boolean-mode fulltext: keep alphanumeric + space + dash, prefix-match each word
  const safe = query
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `+${w}*`)
    .join(" ");

  if (!safe) return [];

  try {
    const [rows] = await pool.query<(ThreadRow & { date: string })[]>(
      `SELECT t.id, t.session_id, t.label, t.headline, t.summary, t.trend,
              t.sources, t.newsletter_context, t.article_ids, s.date
       FROM threads t
       JOIN thread_sessions s ON t.session_id = s.id
       WHERE MATCH(t.label, t.headline, t.summary) AGAINST (? IN BOOLEAN MODE)
         AND s.date >= ?
       ORDER BY s.date DESC`,
      [safe, from]
    );
    return rows.map((r) => ({ ...rowToThread(r), date: r.date }));
  } catch (err) {
    console.error("searchThreads failed:", err);
    return [];
  }
}

export async function getLabelHeatmap(
  days: number,
): Promise<Array<{ label: string; occurrences: Array<{ date: string; trend: "rising" | "stable" | "fading" }> }>> {
  const pool = await getDb();
  const [rows] = await pool.query<(RowDataPacket & {
    label: string;
    date: string;
    trend: string;
  })[]>(
    `SELECT t.label, s.date, t.trend
     FROM threads t
     JOIN thread_sessions s ON t.session_id = s.id
     WHERE s.date >= ?
     ORDER BY s.date ASC`,
    [cutoff(days)]
  );

  const byLabel = new Map<string, Array<{ date: string; trend: "rising" | "stable" | "fading" }>>();
  for (const row of rows) {
    const arr = byLabel.get(row.label);
    const entry = { date: row.date, trend: row.trend as "rising" | "stable" | "fading" };
    if (arr) arr.push(entry);
    else byLabel.set(row.label, [entry]);
  }

  return Array.from(byLabel.entries())
    .map(([label, occs]) => ({ label, occurrences: occs }))
    .sort((a, b) => b.occurrences.length - a.occurrences.length);
}

// Silence unused-import warning on platforms that strip types aggressively
export type _unused_ResultSetHeader = ResultSetHeader;
