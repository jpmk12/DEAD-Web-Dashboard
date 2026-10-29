// Server sweep for force-posture moves — the defense/strategic/overview RSS
// sources the News tab already reads (fetchFeed, 5-min cache) plus ONE GDELT
// query (cached an hour), PLUS the user's own captured sources (X posts and
// reader-captured articles, 2026-10-27) — read by the PURE detector
// (lib/postureMoves) and cached 15 min. Feeds the Glance "Posture moves"
// strip (/api/posture-moves) and the demand horizon's `move` driver
// (lib/demandAssemble). No model call.
//
// The same pass reads the own sources for LIFT CHATTER (lib/mobilityChatter —
// tanker / airlift movement the plane-spotting community reports, named by
// destination): the clusters ride the body as `chatter`, the ones placed in
// a command and not returning home join `moves` as kind `lift`, and the
// distinct-handle count toward each command is recorded as the `chatter:`
// series so the app can later learn whether chatter precedes the ADS-B
// surge (lib/series.precedes). Newsletters are deliberately NOT read here —
// the Glance client already reads them, and the merge would double-count.
//
// Bounded like the other assemblies: a request handler calls
// getPostureMoves(maxWaitMs) and gets a `pending` stub on a cold start; the
// demand assembler, which already runs in the background, awaits the whole
// sweep.

import { fetchFeed } from "./rss";
import { BASE_NEWS_SOURCES } from "./newsSources";
import { gdeltSearch } from "./localNews";
import { detectPostureMoves, mergePostureMoves, POSTURE_GDELT_QUERY, type PostureMove } from "./postureMoves";
import { readChatter, clusterChatter, FOREIGN_SIDES, chatterToMoves, chatterSurge, chatterForIcao, explainChatter, type ChatterCluster, type ChatterExplain, type FieldChatter } from "./mobilityChatter";
import { getOwnPlaces } from "./ownPlaces";
import { getXItems } from "./xStore";
import { getCapturedArticles, articleToNewsItem } from "./articleStore";
import { recordSensorDay } from "./sensorStore";
import { sensorKey } from "./sensorKeys";
import { AOR_LABELS, type Aor } from "./aor";
import type { NewsItem } from "./types";

export interface PostureMovesBody {
  generatedAt: string;
  moves: PostureMove[];
  /** Lift chatter clusters from the user's own sources (newest-first inside
   *  each; corroborated first). Empty when nothing was read. */
  chatter: ChatterCluster[];
  /** Watched countries' and allies' own mobility moves, read from the same
   *  pool — a category apart from U.S. lift; it feeds no level, no demand
   *  driver and no series. */
  foreignChatter: ChatterCluster[];
  /** Chatter naming each of the operator's OWN fields (destination or
   *  origin) in the sensor window, keyed by ICAO — the SITREP Ops row reads
   *  its own entry. Absent ICAO = no post named it. */
  fieldChatter: Record<string, FieldChatter>;
  /** RSS feeds that answered, whether GDELT did, how many own-source items were read, and how many own fields joined the place list. */
  sources: { rss: number; rssTotal: number; gdelt: boolean; own: number; ownFields: number };
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
  return { generatedAt: new Date().toISOString(), moves: [], chatter: [], foreignChatter: [], fieldChatter: {}, sources: { rss: 0, rssTotal: 0, gdelt: false, own: 0, ownFields: 0 }, pending: true, note: "sweeping the defense feeds — ask again shortly" };
}

export function resetPostureMovesCache(): void { cache = null; }

/** The user's own captured sources as items: X posts and reader-captured articles. */
async function ownSourceItems(): Promise<NewsItem[]> {
  const [xs, arts] = await Promise.all([withTimeout(getXItems(), 6_000), withTimeout(getCapturedArticles(200), 6_000)]);
  const items: NewsItem[] = [];
  if (xs) for (const x of xs) items.push({ id: `x-${x.id}`, title: x.text.replace(/\s+/g, " ").trim(), source: `𝕏 @${x.handle}`, category: "social", pubDate: x.postedAt ?? x.importedAt, summary: x.quoted?.text ?? "", link: x.url });
  if (arts) for (const a of arts) items.push({ ...articleToNewsItem(a, 1200), source: `📄 ${a.source}` });
  return items;
}

/** The owner's tuning read: what the chatter grammar made of the own-source
 *  pool right now (matches, near misses, unknown places and designators). Runs
 *  the same two reads the sweep does; never touches the cache or a series. */
export async function diagnoseChatter(): Promise<ChatterExplain & { ownFields: number }> {
  const [own, ownPlaces] = await Promise.all([
    ownSourceItems().catch(() => [] as NewsItem[]),
    withTimeout(getOwnPlaces(), 4_000).then((p) => p ?? []),
  ]);
  return { ...explainChatter(own, Date.now(), { ownPlaces }), ownFields: ownPlaces.length };
}

async function sweep(): Promise<PostureMovesBody> {
  const feeds = BASE_NEWS_SOURCES.filter((s) => s.category === "defense" || s.category === "strategic" || s.category === "overview");
  const items: NewsItem[] = [];
  let rss = 0;
  const [results, g, own, ownPlaces] = await Promise.all([
    Promise.all(feeds.map((f) => withTimeout(fetchFeed(f.url, f.name, f.category), 8_000))),
    withTimeout(gdeltSearch(POSTURE_GDELT_QUERY, { timespan: "3d", maxrecords: 50, keep: 50, cacheKey: "posture-moves" }), 8_000),
    ownSourceItems().catch(() => [] as NewsItem[]),
    // The operator's tracked fields join the place list, so a post naming
    // their spoke places and is marked `mine` (lib/ownPlaces).
    withTimeout(getOwnPlaces(), 4_000).then((p) => p ?? []),
  ]);
  for (const r of results) {
    if (!r || !r.ok) continue;
    rss++;
    items.push(...r.items);
  }
  if (g) items.push(...g);

  const now = Date.now();
  // The posture grammar reads the own sources too (a defense reporter's
  // post is a report like any other; distinct handles are distinct
  // sources). The chatter grammar reads ONLY the own sources — the wires
  // do not write "6x KC-135 out of Mildenhall heading east".
  const moves = detectPostureMoves([...items, ...own], now);
  const posts = readChatter(own, now, { ownPlaces });
  const chatter = clusterChatter(posts);
  const foreignChatter = clusterChatter(readChatter(own, now, { ownPlaces, sides: FOREIGN_SIDES }));
  const liftMoves = chatterToMoves(chatter);
  // Per own field: the chatter naming it, for the SITREP Ops row beside ADS-B.
  const fieldChatter: Record<string, FieldChatter> = {};
  for (const p of ownPlaces) {
    const f = chatterForIcao(posts, p.icao, now);
    if (f) fieldChatter[p.icao] = f;
  }

  // The series: distinct handles reporting lift TOWARD each command in the
  // trailing 72 h (peak). Nothing written for a command with no chatter —
  // absence of a post is not an observation. Fire-and-forget.
  const today = new Date(now).toISOString().slice(0, 10);
  for (const aor of Object.keys(AOR_LABELS) as Aor[]) {
    if (aor === "UNKNOWN") continue;
    const s = chatterSurge(posts, aor, now);
    if (s) recordSensorDay(sensorKey("chatter", aor), today, s.sources).catch(() => {});
  }

  return {
    generatedAt: new Date(now).toISOString(),
    moves: mergePostureMoves(moves, liftMoves),
    chatter,
    foreignChatter,
    fieldChatter,
    sources: { rss, rssTotal: feeds.length, gdelt: !!g, own: own.length, ownFields: ownPlaces.length },
  };
}
