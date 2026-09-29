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

interface GdeltArticle { url?: string; title?: string; domain?: string; seendate?: string }

// Parse GDELT's seendate (YYYYMMDDTHHMMSSZ) into an ISO string.
function parseSeendate(s: string): string {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return new Date().toISOString();
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

export async function gdeltLocalNews(place: string): Promise<NewsItem[]> {
  const key = place.trim().toLowerCase();
  if (!key) return [];
  return gdeltSearch(`"${place}" sourcelang:english`, { cacheKey: `place:${key}`, timespan: "2d", maxrecords: 10, keep: 8, source: "local", category: "local" });
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
  const key = (opts.cacheKey ?? query).trim().toLowerCase();
  if (!key || !query.trim()) return [];
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.items;

  const timespan = opts.timespan ?? "2d";
  const maxrecords = Math.min(75, Math.max(1, opts.maxrecords ?? 10));
  const keep = opts.keep ?? 8;
  const url =
    "https://api.gdeltproject.org/api/v2/doc/doc?query=" + encodeURIComponent(query) +
    `&mode=artlist&format=json&timespan=${encodeURIComponent(timespan)}&maxrecords=${maxrecords}&sort=datedesc`;
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)" } }, 12_000);
    if (!res.ok) return hit?.items ?? []; // serve stale on a blip / 429
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
    // Only cache a non-empty result so a transient empty doesn't pin a blank
    // section for an hour.
    if (items.length > 0) cache.set(key, { items, expires: Date.now() + TTL });
    return items;
  } catch {
    return hit?.items ?? [];
  }
}
