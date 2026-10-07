import { fetchWithTimeout } from "./fetchTimeout";
import type { NewsItem } from "./types";

// "Local news where you are" via GDELT's DOC 2.0 API (keyless, confirmed alive)
// for TDY locations that don't snap to a curated base set. Keyword search on the
// place name, English, last day — coarse "what's being reported about here", not
// true local outlets, but useful when you're somewhere the app has no feed for.
//
// GDELT enforces 1 request / 5 s, so results are cached 60 min per place.

interface CacheEntry { items: NewsItem[]; expires: number }
const cache = new Map<string, CacheEntry>();
const TTL = 60 * 60 * 1000;
// A refused / failed query is remembered briefly so the next caller does not
// re-fire into the same 429 (code review 2026-10-07).
const NEG_TTL = 5 * 60 * 1000;
const negCache = new Map<string, number>();

// GDELT allows ONE request per 5 s per address and this module is called
// from eight places, several of them `Promise.all` fan-outs (chokepoints ×8,
// conflict news ×16, SITREP bases ×6). Every fetch goes through one serial
// gate with the gap enforced process-wide. A caller that would wait longer
// than MAX_QUEUE_WAIT_MS is answered immediately from stale/empty with
// `live:false` — the bounded callers degrade instead of piling up, and the
// queue keeps draining into the cache for the next pass.
const GAP_MS = 5_200;
const MAX_QUEUE_WAIT_MS = 20_000;
let gate: Promise<void> = Promise.resolve();
let lastStart = 0;
let queued = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function paced<T>(fn: () => Promise<T>): Promise<T | null> {
  const expected = Math.max(0, lastStart + GAP_MS * (queued + 1) - Date.now());
  if (expected > MAX_QUEUE_WAIT_MS) return null;
  queued += 1;
  const turn = gate.then(async () => {
    const wait = Math.max(0, lastStart + GAP_MS - Date.now());
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
  });
  gate = turn.catch(() => {});
  try { await turn; return await fn(); } finally { queued -= 1; }
}

interface GdeltArticle { url?: string; title?: string; domain?: string; seendate?: string }

// Parse GDELT's seendate (YYYYMMDDTHHMMSSZ) into an ISO string.
function parseSeendate(s: string): string {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return new Date().toISOString();
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

export async function gdeltLocalNews(place: string): Promise<NewsItem[]> {
  return (await gdeltLocalNewsLive(place)).items;
}

export async function gdeltLocalNewsLive(place: string): Promise<{ items: NewsItem[]; live: boolean }> {
  const key = place.trim().toLowerCase();
  if (!key) return { items: [], live: true };
  return gdeltSearchLive(`"${place}" sourcelang:english`, { cacheKey: `place:${key}`, timespan: "2d", maxrecords: 10, keep: 8, source: "local", category: "local" });
}

export interface GdeltSearchOpts {
  /** Cache key; defaults to the query. */
  cacheKey?: string;
  /** GDELT timespan token, e.g. "2d", "7d". */
  timespan?: string;
  maxrecords?: number;
  /** Items kept after de-duplication. */
  keep?: number;
  /** Suffix on the source label ("local" → "bbc.com · local"). */
  source?: string;
  category?: string;
}

// A general GDELT DOC query — the same fetch, cache and rate discipline as the
// place search, for callers that need a topical query rather than a place
// name (the Economy tab's per-actor economic-warfare read). GDELT's query
// grammar: quoted phrases, OR inside parentheses, `sourcelang:english`.
export async function gdeltSearch(query: string, opts: GdeltSearchOpts = {}): Promise<NewsItem[]> {
  return (await gdeltSearchLive(query, opts)).items;
}

/** Same search, with LIVENESS: `live` is false when GDELT did not answer
 *  this call (a stale or empty list then says nothing about the world — a
 *  caller recording "no act today" must not write on it). */
export async function gdeltSearchLive(query: string, opts: GdeltSearchOpts = {}): Promise<{ items: NewsItem[]; live: boolean }> {
  const key = (opts.cacheKey ?? query).trim().toLowerCase();
  if (!key || !query.trim()) return { items: [], live: true };
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return { items: hit.items, live: true };
  const neg = negCache.get(key);
  if (neg && neg > Date.now()) return { items: hit?.items ?? [], live: false };

  const timespan = opts.timespan ?? "2d";
  const maxrecords = Math.min(75, Math.max(1, opts.maxrecords ?? 10));
  const keep = opts.keep ?? 8;
  const url =
    "https://api.gdeltproject.org/api/v2/doc/doc?query=" + encodeURIComponent(query) +
    `&mode=artlist&format=json&timespan=${encodeURIComponent(timespan)}&maxrecords=${maxrecords}&sort=datedesc`;
  try {
    const res = await paced(() => fetchWithTimeout(url, { headers: { "User-Agent": "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)" } }, 12_000));
    if (!res) return { items: hit?.items ?? [], live: false }; // queue too deep this pass
    if (!res.ok) { negCache.set(key, Date.now() + NEG_TTL); return { items: hit?.items ?? [], live: false }; } // serve stale on a blip / 429
    const data = await res.json();
    const arts: GdeltArticle[] = Array.isArray(data?.articles) ? data.articles : [];
    const seen = new Set<string>();
    const items: NewsItem[] = [];
    for (const a of arts) {
      const link = String(a.url ?? "");
      const title = String(a.title ?? "").trim();
      if (!link || !title || seen.has(link)) continue;
      seen.add(link);
      items.push({
        id: `gdelt-${opts.source ?? "search"}-${link}`,
        title: title.slice(0, 240),
        source: `${a.domain || "GDELT"}${opts.source ? ` · ${opts.source}` : ""}`,
        category: opts.category ?? "search",
        pubDate: parseSeendate(String(a.seendate ?? "")),
        summary: "",
        link,
      });
      if (items.length >= keep) break;
    }
    // A non-empty result is cached for the hour; an answered empty for five
    // minutes (it is a fact, but a short one — and it must not re-fire).
    cache.set(key, { items, expires: Date.now() + (items.length > 0 ? TTL : NEG_TTL) });
    return { items, live: true };
  } catch {
    negCache.set(key, Date.now() + NEG_TTL);
    return { items: hit?.items ?? [], live: false };
  }
}
