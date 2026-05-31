import type { NewsItem } from "./types";
import type { CachedOverview } from "./overviewCache";

// How many of the day's top-ranked articles to hand Claude, and how many it may
// flag as "critical". The client sends its already-ranked shortlist, so this
// caps prompt size; everything below the critical cut becomes "more to discover".
export const CANDIDATE_LIMIT = 45;
export const CRITICAL_COUNT = 10;
// Don't freeze a day's Overview built from a suspiciously small candidate set —
// a cold start / partial feed shouldn't poison the whole day's cache.
export const MIN_CANDIDATES_TO_FREEZE = 8;

// djb2 over the user-context string (role/topics/watchlist). Folded into the
// daily cache key so editing those re-curates once, while routine reading
// activity (which doesn't change this string) still costs one call/day.
export function hashCtx(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Validate client-supplied candidate articles into clean NewsItems. Bounds
// field lengths (untrusted RSS content) and caps the count.
export function sanitiseCandidates(raw: unknown): NewsItem[] {
  if (!Array.isArray(raw)) return [];
  const out: NewsItem[] = [];
  for (const c of raw as Partial<NewsItem>[]) {
    if (!c || typeof c.id !== "string" || !c.id) continue;
    if (typeof c.title !== "string" || typeof c.source !== "string") continue;
    out.push({
      id: c.id,
      title: c.title.slice(0, 300),
      source: c.source.slice(0, 80),
      category: typeof c.category === "string" ? c.category : "",
      summary: typeof c.summary === "string" ? c.summary.slice(0, 600) : "",
      pubDate: typeof c.pubDate === "string" ? c.pubDate : "",
      link: typeof c.link === "string" ? c.link.slice(0, 2000) : "",
      ...(typeof c.imageUrl === "string" ? { imageUrl: c.imageUrl.slice(0, 2000) } : {}),
    });
    if (out.length >= CANDIDATE_LIMIT) break;
  }
  return out;
}

export function deterministicSplit(sorted: NewsItem[]): CachedOverview {
  return {
    critical: sorted.slice(0, CRITICAL_COUNT),
    discover: sorted.slice(CRITICAL_COUNT),
    mode: "deterministic",
  };
}

// Map Claude's `{ critical: [ids] }` back onto the sorted candidates: keep only
// known, de-duplicated ids in the model's priority order; everything else stays
// in deterministic order as "discover". Returns null when the model produced no
// usable ids, so the caller can fall back to the deterministic split.
export function pickCritical(parsed: { critical?: unknown }, sorted: NewsItem[]): CachedOverview | null {
  const byId = new Map(sorted.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const critical: NewsItem[] = [];
  if (Array.isArray(parsed.critical)) {
    for (const id of parsed.critical) {
      const item = typeof id === "string" ? byId.get(id) : undefined;
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        critical.push(item);
        if (critical.length >= CRITICAL_COUNT) break;
      }
    }
  }
  if (critical.length === 0) return null;
  const discover = sorted.filter((i) => !seen.has(i.id));
  return { critical, discover, mode: "ai" };
}

// Format the strongest learned-affinity signals for the prompt. Sorts by
// ABSOLUTE score so strong dislikes (large negatives) survive the slice and
// Claude can deprioritise them — sorting descending would keep only likes.
export function topAffinity(record: Record<string, number>, limit: number): string {
  return Object.entries(record)
    .filter(([, s]) => s !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, limit)
    .map(([k, s]) => `${k}: ${s > 0 ? "+" : ""}${s}`)
    .join(", ");
}
