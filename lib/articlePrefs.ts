import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { pickUserRow } from "./userScope";
import { NewsItem } from "./types";

export interface ArticlePrefs {
  keywords: Record<string, number>;
  sources: Record<string, number>;
  lastUpdated: string;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "is", "it", "be", "as", "so", "we", "he", "she", "they", "by",
  "this", "that", "with", "from", "has", "had", "was", "are", "were",
  "will", "not", "its", "his", "her", "our", "your", "their", "what",
  "who", "how", "why", "when", "where", "which", "can", "could", "would",
  "should", "may", "might", "must", "have", "been", "do", "did", "does",
  "than", "then", "into", "over", "after", "about", "up", "out", "no",
  "if", "says", "said", "new", "more", "also", "now", "just", "first",
  "year", "years", "last", "two", "three", "four", "five",
]);

export function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

interface PrefsRow extends RowDataPacket {
  keywords: Record<string, number> | null;
  sources: Record<string, number> | null;
  last_updated: Date;
}

function asNumRecord(v: unknown): Record<string, number> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v)) {
      if (typeof n === "number") out[k] = n;
    }
    return out;
  }
  return {};
}

// Serialize updates PER USER within a single Node process to keep counter math
// correct — one user's burst of feedback must not block (or be blocked by)
// another user's. Different containers can still race; for a small-crew
// dashboard that's acceptable.
const writeQueues = new Map<string, Promise<unknown>>();
const queueFor = (email: string): Promise<unknown> =>
  writeQueues.get(email) ?? Promise.resolve();

const MAX_DICT_ENTRIES = 500;

function pruneDict(dict: Record<string, number>): Record<string, number> {
  const entries = Object.entries(dict);
  if (entries.length <= MAX_DICT_ENTRIES) return dict;
  return Object.fromEntries(
    entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, MAX_DICT_ENTRIES)
  );
}

async function readPrefsRaw(email: string): Promise<ArticlePrefs> {
  const pool = await getDb();
  const [rows] = await pool.query<(PrefsRow & { user_email: string })[]>(
    "SELECT keywords, sources, last_updated, user_email FROM article_prefs WHERE user_email IN (?, '')",
    [email]
  );
  const row = pickUserRow(rows, email);
  if (!row) {
    return { keywords: {}, sources: {}, lastUpdated: new Date(0).toISOString() };
  }
  return {
    keywords: asNumRecord(row.keywords),
    sources: asNumRecord(row.sources),
    lastUpdated: row.last_updated.toISOString(),
  };
}

export async function readPrefs(email: string): Promise<ArticlePrefs> {
  await queueFor(email);
  return readPrefsRaw(email);
}

async function writePrefs(email: string, prefs: ArticlePrefs): Promise<void> {
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO article_prefs (id, user_email, keywords, sources, last_updated)
     VALUES (1, ?, CAST(? AS JSON), CAST(? AS JSON), ?)
     ON DUPLICATE KEY UPDATE
       keywords     = VALUES(keywords),
       sources      = VALUES(sources),
       last_updated = VALUES(last_updated)`,
    [email, JSON.stringify(prefs.keywords), JSON.stringify(prefs.sources), new Date()]
  );
}

async function updatePrefs(email: string, updater: (prefs: ArticlePrefs) => ArticlePrefs): Promise<void> {
  const next = queueFor(email).then(async () => {
    const current = await readPrefsRaw(email);
    const raw = updater(current);
    const updated: ArticlePrefs = {
      ...raw,
      keywords: pruneDict(raw.keywords),
      sources: pruneDict(raw.sources),
      lastUpdated: new Date().toISOString(),
    };
    await writePrefs(email, updated);
  });
  writeQueues.set(email, next.catch((err) => {
    console.error("Failed to persist article preferences:", err);
  }));
  return next;
}

export async function recordFeedback(
  email: string,
  title: string,
  source: string,
  action: "useful" | "not_useful"
): Promise<void> {
  const delta = action === "useful" ? 1 : -1;
  const keywords = extractKeywords(title);
  await updatePrefs(email, (prefs) => {
    const updatedKeywords = { ...prefs.keywords };
    for (const kw of keywords) {
      updatedKeywords[kw] = (updatedKeywords[kw] ?? 0) + delta;
    }
    const updatedSources = { ...prefs.sources };
    updatedSources[source] = (updatedSources[source] ?? 0) + delta;
    return { ...prefs, keywords: updatedKeywords, sources: updatedSources };
  });
}

// Implicit signal: the user clicked through to read this article. Counts at
// ~1/4 the weight of an explicit "useful" so a thumbs-up still dominates,
// but consistent opens for a source/topic still nudge ranking over time.
export async function recordOpen(email: string, title: string, source: string): Promise<void> {
  const KW_DELTA = 0.25;
  const SRC_DELTA = 0.25;
  const keywords = extractKeywords(title);
  await updatePrefs(email, (prefs) => {
    const updatedKeywords = { ...prefs.keywords };
    for (const kw of keywords) {
      updatedKeywords[kw] = (updatedKeywords[kw] ?? 0) + KW_DELTA;
    }
    const updatedSources = { ...prefs.sources };
    updatedSources[source] = (updatedSources[source] ?? 0) + SRC_DELTA;
    return { ...prefs, keywords: updatedKeywords, sources: updatedSources };
  });
}

export function scoreArticle(item: NewsItem, prefs: ArticlePrefs, watchlist: string[] = []): number {
  const keywords = extractKeywords(item.title + " " + (item.summary ?? ""));
  const kwScore = keywords.reduce((sum, kw) => sum + (prefs.keywords[kw] ?? 0), 0);
  const srcScore = prefs.sources[item.source] ?? 0;
  const titleLower = item.title.toLowerCase();
  const watchlistScore = watchlist.some((t) => titleLower.includes(t.toLowerCase())) ? 10 : 0;
  return kwScore + srcScore * 2 + watchlistScore;
}

export function sortByPreference(items: NewsItem[], prefs: ArticlePrefs, watchlist: string[] = []): NewsItem[] {
  const hasPreferences =
    Object.keys(prefs.keywords).length > 0 ||
    Object.keys(prefs.sources).length > 0 ||
    watchlist.length > 0;
  if (!hasPreferences) return items;

  return [...items].sort((a, b) => {
    const scoreDiff = scoreArticle(b, prefs, watchlist) - scoreArticle(a, prefs, watchlist);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
  });
}
