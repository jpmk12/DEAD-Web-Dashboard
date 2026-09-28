// Reactivation: "you cared about this before — it just moved."
//
// PURE, client-safe, unit-tested. No model call, no new fetch — a join over
// things the app already holds on both sides.
//
// The gap this closes: `saved_items` was consumed by exactly one file, its own
// CRUD route. A save is the strongest signal the user produces — they
// deliberately kept that thing — and it informed no ranking, no watchlist, no
// brief. Meanwhile `article_prefs` records clicks and feeds news sort, the
// digest and trends. The app learned from clicks but not from keeps.
//
// The connection no existing pane can show: every surface only knows TODAY.
// The feed knows Bab-el-Mandeb is rising; the I&W board knows it is at WATCH.
// Neither knows you saved a report about it in June. A dormant interest
// reactivating is invisible precisely because the interest is old.
//
// ── Discipline ────────────────────────────────────────────────────────────
// DORMANCY IS THE POINT. An item saved yesterday matching today's news is not
// a discovery, it is a memory of reading it — so an interest must be at least
// `dormantDays` old to qualify. Without that floor this degenerates into "here
// is your saved list again", which is the nag failure the watchlist card's
// design rule exists to prevent.
//
// MATCHING IS CONSERVATIVE. Word-bounded, case-insensitive, minimum term
// length, and a stoplist of terms too generic to mean anything (every document
// in a mobility dashboard says "aircraft"). Same rule as `findUnlinkedMentions`.
// A false reactivation is worse than a missing one: it trains the user to stop
// reading the panel.
//
// EVERY ROW STATES ITS EVIDENCE and dismissal is permanent — the design rule
// from the watchlist recommendations, which this surface inherits wholesale.

/** Something the user previously chose to keep: a saved item or a doc they wrote. */
export interface Interest {
  kind: "saved" | "doc";
  /** Stable id, used for dismissal keys and for opening the thing. */
  id: string;
  title: string;
  /** Extra searchable text (saved content, doc aliases). Bounded by the caller. */
  body?: string;
  /** Where it came from — "Saved · Reuters", "Doc · theorist". Display only. */
  origin: string;
  /** How long ago it was saved/updated, in whole days. */
  ageDays: number;
  link?: string;
}

/** Something that is active RIGHT NOW, from a surface that only knows today. */
export interface ActiveSignal {
  term: string;
  kind: "mover" | "iw" | "disaster";
  /** One clause of evidence: "rising — 11 mentions this week". */
  detail: string;
  /** Higher wins when one interest matches several signals. */
  weight: number;
}

export interface Reactivation {
  interest: Interest;
  /** The strongest signal that woke this interest. */
  signal: ActiveSignal;
  /** Other terms that also matched, for the "+2 more" clause. */
  alsoTerms: string[];
  /** The whole row in one sentence, evidence included. */
  reason: string;
}

/** An interest younger than this is not dormant — you just read it. */
export const DORMANT_DAYS = 14;

/** Terms shorter than this match too much to mean anything. */
export const MIN_TERM_LEN = 4;

/** Vocabulary so common in this app's own corpus that a match carries no
 *  information. Deliberately small and specific — a long stoplist would start
 *  suppressing real signals. */
const STOPLIST = new Set([
  "aircraft", "airfield", "airport", "mobility", "airlift", "weather", "news",
  "conflict", "crisis", "military", "security", "report", "update", "country",
  "united states", "government", "region", "unknown", "other",
]);

const norm = (s: string): string => s.toLowerCase().trim();

/** Escape a term for use inside a RegExp — an upstream term can contain regex
 *  metacharacters (e.g. "Bab-el-Mandeb (Yemen)") and must not become a pattern. */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Word-bounded, case-insensitive containment. `\b` is wrong for terms whose
 * edges are not word characters, so the boundary is asserted with lookarounds
 * against letters/digits — "Hormuz" matches "the Strait of Hormuz." but not
 * "Hormuzian", and "GPS" would match "GPS-denied".
 */
export function mentions(text: string, term: string): boolean {
  const t = term.trim();
  if (t.length < MIN_TERM_LEN) return false;
  try {
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}(?![\\p{L}\\p{N}])`, "iu").test(text);
  } catch {
    // A pathological term must degrade to "no match", never throw into a render.
    return false;
  }
}

/** True when a signal term is specific enough to be worth matching on. */
export function isUsefulTerm(term: string): boolean {
  const t = norm(term);
  return t.length >= MIN_TERM_LEN && !STOPLIST.has(t);
}

export function dismissKey(i: Pick<Interest, "kind" | "id">, term: string): string {
  return `react:${i.kind}:${i.id}:${norm(term)}`;
}

export function findReactivations(
  interests: Interest[],
  signals: ActiveSignal[],
  dismissed: string[] = [],
  opts: { dormantDays?: number; max?: number } = {},
): Reactivation[] {
  const dormantDays = opts.dormantDays ?? DORMANT_DAYS;
  const dismissedSet = new Set(dismissed.map(norm));
  const useful = signals.filter((s) => isUsefulTerm(s.term));
  if (useful.length === 0) return [];

  const out: Reactivation[] = [];
  for (const interest of interests) {
    // Dormancy gate, first and cheapest.
    if (!Number.isFinite(interest.ageDays) || interest.ageDays < dormantDays) continue;

    const haystack = `${interest.title}\n${interest.body ?? ""}`;
    const hits = useful.filter((s) => mentions(haystack, s.term));
    if (hits.length === 0) continue;

    // Strongest signal leads; remaining matched terms become the "+N more".
    hits.sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term));
    // A dismissal is per interest+term, so a different term can still surface
    // the same item later — dismissing "Hormuz" on a doc does not mute that doc
    // forever, only that pairing.
    const live = hits.filter((s) => !dismissedSet.has(norm(dismissKey(interest, s.term))));
    if (live.length === 0) continue;

    const signal = live[0];
    const alsoTerms = live.slice(1).map((s) => s.term);
    out.push({
      interest,
      signal,
      alsoTerms,
      reason: `${interest.origin} · saved ${ageText(interest.ageDays)} — ${signal.term} is ${signal.detail}${
        alsoTerms.length > 0 ? ` (also ${alsoTerms.slice(0, 2).join(", ")}${alsoTerms.length > 2 ? ` +${alsoTerms.length - 2}` : ""})` : ""
      }`,
    });
  }

  // Strongest signal first; among equals, the longest-dormant interest — the
  // older the memory, the less likely the user still holds it.
  out.sort((a, b) => b.signal.weight - a.signal.weight || b.interest.ageDays - a.interest.ageDays);
  return out.slice(0, opts.max ?? 6);
}

/** Human age for the evidence clause. Deliberately coarse — "in June" is what
 *  the user remembers, not "137 days ago". */
export function ageText(days: number): string {
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/** Weights for the three signal sources, in one place so ranking is auditable.
 *  An I&W level is a considered judgement and outranks a raw mention count. */
export const SIGNAL_WEIGHT = {
  iwAlert: 100,
  iwWarning: 80,
  iwWatch: 60,
  disasterRed: 55,
  moverNew: 40,
  moverRising: 30,
  disasterOther: 20,
} as const;
