// Server sweep for force-posture moves — the defense/strategic/overview RSS
// sources the News tab already reads (fetchFeed, 5-min cache) plus ONE GDELT
// query (cached an hour) — read by the PURE detector (lib/postureMoves) and
// cached 15 min. Feeds the Glance "Posture moves" strip (/api/posture-moves)
// and the demand horizon's `move` driver (lib/demandAssemble). No model call.
//
// Bounded like the other assemblies: a request handler calls
// getPostureMoves(maxWaitMs) and gets a `pending` stub on a cold start; the
// demand assembler, which already runs in the background, awaits the whole
// sweep.

import { fetchFeed } from "./rss";
import { BASE_NEWS_SOURCES } from "./newsSources";
import { gdeltSearch } from "./localNews";
import { detectPostureMoves, POSTURE_GDELT_QUERY, type PostureMove } from "./postureMoves";
import type { NewsItem } from "./types";

export interface PostureMovesBody {
  generatedAt: string;
  moves: PostureMove[];
  /** RSS feeds that answered, and whether GDELT did. */
  sources: { rss: number; rssTotal: number; gdelt: boolean };
  pending?: boolean;
  note?: string;
}

const TTL = 15 * 60 * 1000;
let cache: { at: number; body: PostureMovesBody } | null = null;
let inflight: Promise<PostureMovesBody> | null = null;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}

/** The whole sweep, however long it takes (background callers only). */
export async function getPostureMovesFull(): Promise<PostureMovesBody> {
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  if (inflight) return inflight;
  inflight = sweep().then((body) => { cache = { at: Date.now(), body }; return body; }).finally(() => { inflight = null; });
  return inflight;
}

/** Bounded for request handlers: warm cache instantly; a cold sweep is
 *  started and what settles within `maxWaitMs` is returned, else the last
 *  body flagged pending, else a pending stub. */
export async function getPostureMoves(maxWaitMs = 8_000): Promise<PostureMovesBody> {
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  const settled = await withTimeout(getPostureMovesFull(), maxWaitMs);
  if (settled) return settled;
  if (cache) return { ...cache.body, pending: true };
  return { generatedAt: new Date().toISOString(), moves: [], sources: { rss: 0, rssTotal: 0, gdelt: false }, pending: true, note: "sweeping the defense feeds — ask again shortly" };
}

export function resetPostureMovesCache(): void { cache = null; }

async function sweep(): Promise<PostureMovesBody> {
  const feeds = BASE_NEWS_SOURCES.filter((s) => s.category === "defense" || s.category === "strategic" || s.category === "overview");
  const items: NewsItem[] = [];
  let rss = 0;
  const results = await Promise.all(feeds.map((f) => withTimeout(fetchFeed(f.url, f.name, f.category), 8_000)));
  for (const r of results) {
    if (!r || !r.ok) continue;
    rss++;
    items.push(...r.items);
  }
  const g = await withTimeout(gdeltSearch(POSTURE_GDELT_QUERY, { timespan: "3d", maxrecords: 50, keep: 50, cacheKey: "posture-moves" }), 8_000);
  if (g) items.push(...g);
  return {
    generatedAt: new Date().toISOString(),
    moves: detectPostureMoves(items),
    sources: { rss, rssTotal: feeds.length, gdelt: !!g },
  };
}
