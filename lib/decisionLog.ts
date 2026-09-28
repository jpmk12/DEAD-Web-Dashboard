// The I&W decision log: what you expected, and whether it happened.
//
// PURE, client-safe, unit-tested. The one feature in this app that tries to
// improve the board's JUDGEMENT rather than its presentation.
//
// Why it belongs here: `warningTaxonomy.ts` already requires every indicator to
// carry a pre-registered FALSIFIER and a decision-linkage — the doctrine that
// a warning indicator you cannot be wrong about is not an indicator. But
// nothing ever recorded a call or checked one, so the falsifiers were
// decoration. This closes that loop: you log a read with an expectation and a
// horizon, and at the horizon the board asks you to score it.
//
// ── What this is honest about ─────────────────────────────────────────────
// A prediction you score yourself is weak evidence. There is no oracle here
// and the app does NOT score for you: it only reopens the entry when the
// horizon passes. The value is not a leaderboard, it is that writing the
// expectation down beforehand makes a vague feeling falsifiable, and that
// re-reading it later is the only way to notice an indicator you keep being
// wrong about.
//
// AMBIGUOUS IS FIRST-CLASS. Forcing every entry to right/wrong would corrupt
// the record — most real reads are partly both. But ambiguity must stay
// VISIBLE rather than quietly vanishing from the denominator, because a log
// that is mostly ambiguous means the expectations are not being written
// sharply enough, and that is the finding. So `hitRate` excludes ambiguous
// from its ratio AND reports the count separately.
//
// BELOW A FLOOR, NO PERCENTAGE. Two-for-three is not 67% skill. Same
// learning-mode rule as the I&W baseline, `amountDelta`'s three samples,
// `silenceWatch`'s three sightings and `classifyChronicity`'s MIN_OBSERVED.

export type DecisionCall = "escalating" | "holding" | "deescalating";
export type DecisionOutcome = "right" | "wrong" | "ambiguous";

export interface DecisionEntry {
  id: string;
  problemId: string;
  /** Indicator this call is against, or null for a whole-board call. */
  indicatorId: string | null;
  call: DecisionCall;
  /** What you expect to see — the falsifiable part. */
  expectation: string;
  horizonDays: number;
  createdAt: string;   // ISO
  dueAt: string;       // ISO
  outcome: DecisionOutcome | null;
  scoredAt: string | null;
  scoreNote: string | null;
  /** Who made the call — the crew shares one board. */
  by: string;
}

export const CALLS: DecisionCall[] = ["escalating", "holding", "deescalating"];
export const OUTCOMES: DecisionOutcome[] = ["right", "wrong", "ambiguous"];

/** Offered horizons. Deliberately few — a free-form number invites 90-day
 *  entries that will never be scored. */
export const HORIZONS = [7, 14, 30] as const;

export const CALL_LABEL: Record<DecisionCall, string> = {
  escalating: "Escalating", holding: "Holding", deescalating: "De-escalating",
};
export const CALL_GLYPH: Record<DecisionCall, string> = {
  escalating: "↗", holding: "→", deescalating: "↘",
};

/** Scored entries needed before a hit rate is a number rather than a tally. */
export const MIN_SCORED_FOR_RATE = 5;

export const MAX_EXPECTATION_LEN = 400;

export function isOpen(e: DecisionEntry): boolean {
  return e.outcome === null;
}

/** Open AND past its horizon — the board should ask about these. */
export function isDue(e: DecisionEntry, nowMs = Date.now()): boolean {
  if (!isOpen(e)) return false;
  const t = Date.parse(e.dueAt);
  return Number.isFinite(t) && t <= nowMs;
}

/** Open but not yet due. */
export function isPending(e: DecisionEntry, nowMs = Date.now()): boolean {
  return isOpen(e) && !isDue(e, nowMs);
}

/** Whole days until due; negative once overdue. Null on an unparseable date —
 *  never a guessed 0, which would read as "due today". */
export function daysUntilDue(e: DecisionEntry, nowMs = Date.now()): number | null {
  const t = Date.parse(e.dueAt);
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - nowMs) / 86_400_000);
}

export interface HitRate {
  right: number;
  wrong: number;
  ambiguous: number;
  /** right + wrong — the ratio's denominator. Ambiguous is NOT in it. */
  decided: number;
  /** 0-1, or null below MIN_SCORED_FOR_RATE decided entries. */
  rate: number | null;
  /** Display string, always safe to render. */
  label: string;
}

export function hitRate(entries: DecisionEntry[], opts: { minScored?: number } = {}): HitRate {
  const minScored = opts.minScored ?? MIN_SCORED_FOR_RATE;
  let right = 0, wrong = 0, ambiguous = 0;
  for (const e of entries) {
    if (e.outcome === "right") right++;
    else if (e.outcome === "wrong") wrong++;
    else if (e.outcome === "ambiguous") ambiguous++;
  }
  const decided = right + wrong;
  const ambClause = ambiguous > 0 ? `, ${ambiguous} ambiguous` : "";

  if (decided === 0) {
    return { right, wrong, ambiguous, decided, rate: null, label: ambiguous > 0 ? `${ambiguous} scored, none decisive` : "no scored calls yet" };
  }
  if (decided < minScored) {
    // A tally, not a percentage: two-for-three is not 67% skill.
    return { right, wrong, ambiguous, decided, rate: null, label: `${right} of ${decided} so far${ambClause}` };
  }
  return {
    right, wrong, ambiguous, decided,
    rate: right / decided,
    label: `${Math.round((right / decided) * 100)}% (${right}/${decided})${ambClause}`,
  };
}

/** Validate a proposed entry. Returns an error string, or null when acceptable.
 *  The write route re-runs this — a guard that only exists in the UI is not a
 *  guard, the same rule as /api/family/event's date check. */
export function validateDraft(d: {
  call?: unknown; expectation?: unknown; horizonDays?: unknown; problemId?: unknown;
}): string | null {
  if (typeof d.problemId !== "string" || !d.problemId.trim()) return "A problem is required.";
  if (typeof d.call !== "string" || !CALLS.includes(d.call as DecisionCall)) return "Pick a call.";
  const exp = typeof d.expectation === "string" ? d.expectation.trim() : "";
  // The expectation is the entire point — an entry without one cannot be
  // scored later, and an unscoreable entry is worse than none because it makes
  // the hit rate look better-founded than it is.
  if (exp.length < 8) return "Write what you expect to see — that is the part you score later.";
  if (exp.length > MAX_EXPECTATION_LEN) return `Keep the expectation under ${MAX_EXPECTATION_LEN} characters.`;
  if (typeof d.horizonDays !== "number" || !HORIZONS.includes(d.horizonDays as (typeof HORIZONS)[number])) {
    return "Pick a horizon.";
  }
  return null;
}

/** Due date for a horizon, as ISO. */
export function dueAtFor(horizonDays: number, fromMs = Date.now()): string {
  return new Date(fromMs + horizonDays * 86_400_000).toISOString();
}

/** Sort for display: due first (most overdue leading), then pending by
 *  soonest, then scored by most recent. What needs you comes first. */
export function sortForDisplay(entries: DecisionEntry[], nowMs = Date.now()): DecisionEntry[] {
  const rank = (e: DecisionEntry) => (isDue(e, nowMs) ? 0 : isOpen(e) ? 1 : 2);
  return entries.slice().sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 2) return Date.parse(b.scoredAt ?? b.createdAt) - Date.parse(a.scoredAt ?? a.createdAt);
    return Date.parse(a.dueAt) - Date.parse(b.dueAt);
  });
}
