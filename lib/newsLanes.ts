// The Read view's two lanes — PURE, client-safe, unit-tested.
//
// The operator reads for two things (REVIEW-2026-10 §2): strategic depth
// (long-form analysis) and current events that touch an AMC operational
// leader. Everything else is nice to have. The lanes are decided
// deterministically: depth by SOURCE (the analysis outlets) or by a long
// body; "now" is today's AI-curated "Critical for you" set; the rest folds.

import type { NewsItem, NewsThread } from "./types";
import type { TrendMover } from "./trends";

export type Lane = "depth" | "now" | "rest";

/** Outlets whose pieces are analysis, not wire. Case-insensitive substring. */
export const DEPTH_SOURCES = [
  "war on the rocks", "foreign affairs", "foreign policy", "csis", "rand", "lawfare", "brookings", "cnas",
  "hudson", "carnegie", "chatham house", "iiss", "rusi", "texas national security review", "modern war institute",
  "small wars journal", "strategy bridge", "the atlantic", "the economist", "defense priorities", "atlantic council",
  "the diplomat", "engelsberg", "parameters", "joint force quarterly", "air & space forces magazine", "air and space forces magazine",
];

/** A wire summary this long is a feature, not a brief. */
export const DEPTH_MIN_CHARS = 900;

export function isDepthSource(source: string): boolean {
  const s = source.toLowerCase();
  return DEPTH_SOURCES.some((d) => s.includes(d));
}

export function laneFor(item: Pick<NewsItem, "id" | "source" | "summary">, criticalIds: Set<string>): Lane {
  if (isDepthSource(item.source) || (item.summary ?? "").length >= DEPTH_MIN_CHARS) return "depth";
  if (criticalIds.has(item.id)) return "now";
  return "rest";
}

/** Thread label for an article, from the threads' article ids. */
export function threadForArticle(id: string, threads: Pick<NewsThread, "label" | "articleIds">[]): string | null {
  for (const t of threads) if (t.articleIds.includes(id)) return t.label;
  return null;
}

export interface MoverGroups { rising: TrendMover[]; fresh: TrendMover[]; fading: TrendMover[] }

/** Trending, sorted the way the operator asked: rising by velocity, then new, then fading. */
export function groupMovers(movers: TrendMover[]): MoverGroups {
  const vel = (m: TrendMover) => (m.cur + 1) / (m.prev + 1);
  return {
    rising: movers.filter((m) => m.state === "rising").sort((a, b) => vel(b) - vel(a)),
    fresh: movers.filter((m) => m.state === "new").sort((a, b) => b.cur - a.cur),
    fading: movers.filter((m) => m.state === "fading").sort((a, b) => a.cur / Math.max(1, a.prev) - b.cur / Math.max(1, b.prev)),
  };
}

/** Does an article mention a trending term? Word-ish, case-insensitive. */
export function mentionsTerm(item: Pick<NewsItem, "title" | "summary">, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (t.length < 2) return false;
  return `${item.title} ${item.summary ?? ""}`.toLowerCase().includes(t);
}
