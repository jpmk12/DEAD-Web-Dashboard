// Watchlist recommendations, derived from the signal history the app ALREADY
// collects. PURE, client-safe, unit-tested — no model call, no new fetch: this
// is arithmetic over `signal_daily_counts`, which six sources populate (OSINT
// feed, News, Threads labels, conflict events, ACLED, severe weather).
//
// Two directions, and the second is the one nobody asks for:
//
//  ADD  — a term surging in YOUR OWN feeds that you are not watching. The
//         evidence is the mention counts, so the suggestion can always say why.
//  DROP — a term you ARE watching that has gone quiet. A watchlist that only
//         ever grows becomes the Christmas tree the I&W board exists to avoid;
//         every dead term costs attention on every screen that renders it.
//
// Discipline inherited from the warning board: a suggestion must be earned.
// The trend layer's own noise floor (cur + prev >= 4) does the first cut, and
// the thresholds here are deliberately conservative — a wrong suggestion is
// worse than a missing one, because it trains the user to dismiss the panel.

import type { TrendMover, SignalKind } from "./trends";

export interface WatchAddSuggestion {
  term: string;
  kind: SignalKind;
  mentions: number;      // last 7 days
  prevMentions: number;  // the 7 before
  state: "new" | "rising";
  reason: string;
}

export interface WatchDropSuggestion {
  term: string;
  mentions: number;      // last 7 days
  prevMentions: number;
  reason: string;
}

export interface WatchlistSuggestions {
  add: WatchAddSuggestion[];
  drop: WatchDropSuggestion[];
}

const norm = (s: string): string => s.trim().toLowerCase();

// Kinds worth proposing. "label" is excluded deliberately: thread labels are
// editorial groupings the model coined ("IRAN WAR"), not search terms — adding
// one to a watchlist that does substring matching would match almost nothing.
const ADDABLE: SignalKind[] = ["topic", "region", "aor"];

// A candidate is already covered when the watchlist contains it, or contains a
// term inside it — watching "Hormuz" already catches "Strait of Hormuz", and
// proposing the longer form would be noise.
export function isCovered(term: string, watchlist: string[]): boolean {
  const t = norm(term);
  if (!t) return true;
  return watchlist.some((w) => {
    const n = norm(w);
    if (!n) return false;
    return t === n || t.includes(n) || n.includes(t);
  });
}

export function suggestWatchlist(
  movers: TrendMover[],
  watchlist: string[],
  dismissed: string[],
  opts: { minMentions?: number; maxAdd?: number; maxDrop?: number } = {},
): WatchlistSuggestions {
  const minMentions = opts.minMentions ?? 5;
  const dismissedSet = new Set(dismissed.map(norm));

  const add: WatchAddSuggestion[] = [];
  for (const m of movers) {
    if (m.state !== "new" && m.state !== "rising") continue;
    if (!ADDABLE.includes(m.kind)) continue;
    if (m.cur < minMentions) continue;
    // Single-word noise ("said", "new") slips through topic extraction; a term
    // short enough to match half the feed is not a watch term.
    if (m.term.trim().length < 4) continue;
    if (dismissedSet.has(norm(m.term))) continue;
    if (isCovered(m.term, watchlist)) continue;

    add.push({
      term: m.term,
      kind: m.kind,
      mentions: m.cur,
      prevMentions: m.prev,
      state: m.state,
      reason: m.state === "new"
        ? `${m.cur} mentions this week, none the week before`
        : `${m.cur} mentions this week, up from ${m.prev}`,
    });
  }

  // DROP: only from terms actually on the watchlist. `watch`-kind movers are
  // recorded by watchTermsIn(), so their counts are specifically "times YOUR
  // watchlist matched something" — exactly the right measure of whether a term
  // is still earning its place.
  const watchMovers = new Map<string, TrendMover>();
  for (const m of movers) {
    if (m.kind === "watch") watchMovers.set(norm(m.term), m);
  }

  const drop: WatchDropSuggestion[] = [];
  for (const w of watchlist) {
    const key = norm(w);
    if (!key || dismissedSet.has(`drop:${key}`)) continue;
    const m = watchMovers.get(key);
    // No mover row at all means the term never cleared the noise floor in two
    // weeks — but absence is also what a brand-new watchlist entry looks like,
    // and the trend table only knows what it has seen. Stay silent rather than
    // recommend deleting something added yesterday.
    if (!m) continue;
    if (m.state !== "fading") continue;
    drop.push({
      term: w,
      mentions: m.cur,
      prevMentions: m.prev,
      reason: m.cur === 0
        ? `no matches this week, ${m.prev} the week before`
        : `${m.cur} matches this week, down from ${m.prev}`,
    });
  }

  return {
    add: add.sort((a, b) => b.mentions - a.mentions).slice(0, opts.maxAdd ?? 6),
    drop: drop.sort((a, b) => a.mentions - b.mentions).slice(0, opts.maxDrop ?? 4),
  };
}

// Dismissals are stored as plain strings so one column serves both directions:
// a bare term means "never suggest adding this", `drop:term` means "stop
// telling me to remove it".
export const dropKey = (term: string): string => `drop:${norm(term)}`;
export const addKey = (term: string): string => norm(term);
