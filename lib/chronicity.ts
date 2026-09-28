// Chronic vs acute: how long has this been true?
//
// PURE, client-safe, unit-tested. No fetch, no db — arithmetic over the daily
// history the app ALREADY writes (`force_posture_daily`, `sitrep_status_daily`).
//
// The gap this closes: both tables are read for a ONE-DAY delta only ("worse
// than yesterday", the 7-day strip). So a base that has been amber twelve of
// the last fourteen days and a base that went amber this morning render
// identically — and they are not the same problem. One is a condition you plan
// around; the other is something that just happened to you. The I&W board is
// built on exactly this distinction (anomaly, not level — a permanent condition
// is posture, not warning); this applies the same rule to the app's own posture
// history.
//
// ── The rule that makes it honest ─────────────────────────────────────────
// These tables are written LAZILY, only on days the app was actually opened and
// the feed assembled. So calendar days are NOT the denominator. Two elevated
// days out of two recorded is not "2 of 14" — it is everything we ever saw.
// Every ratio here is against days OBSERVED, and the display string says so.
// Getting this backwards would under-report a chronic problem on a week you
// were away, which is precisely the week you most need to be told.
//
// Below MIN_OBSERVED days we return `unknown` rather than guessing — the same
// learning-mode discipline as the I&W baseline, `amountDelta`'s three-sample
// floor and `silenceWatch`'s three-sighting minimum. With three days of history
// "chronic" and "started Tuesday" are indistinguishable, and a wrong label here
// is worse than no label: it would tell a commander to stop worrying about
// something new.

/** One day's observation. `elevated` is the caller's judgement (amber/red for a
 *  LED, non-green for a posture composite) so this module stays value-agnostic. */
export interface DayObservation {
  /** UTC yyyy-mm-dd. */
  day: string;
  elevated: boolean;
}

export type Chronicity =
  | "unknown"     // not enough observed history to say anything
  | "new"         // elevated now, was not on the previous observed day
  | "recurring"   // comes and goes — several separate onsets in the window
  | "chronic"     // elevated on most observed days
  | "improving"   // not elevated now, but was within the window
  | "quiet";      // not elevated now, nor in the window

export interface ChronicityResult {
  state: Chronicity;
  /** Days in the window on which we observed an elevated value. */
  daysElevated: number;
  /** Days in the window we have ANY record for — the honest denominator. */
  daysObserved: number;
  /** Consecutive elevated days ending at the most recent observation. */
  streak: number;
  /** Distinct transitions into elevated — how many times this has flared. */
  onsets: number;
  /** Short display string, or null when there is nothing worth saying. */
  label: string | null;
}

/** Days of history to consider. Two weeks: long enough for a weekly pattern to
 *  show, short enough that a resolved problem falls out of the window. */
export const WINDOW_DAYS = 14;

/** Minimum observed days before we will label anything chronic/recurring. */
export const MIN_OBSERVED = 5;

/** Share of observed days that must be elevated to count as chronic. */
export const CHRONIC_SHARE = 0.6;

const EMPTY: ChronicityResult = {
  state: "unknown", daysElevated: 0, daysObserved: 0, streak: 0, onsets: 0, label: null,
};

/**
 * Classify a history. `series` may arrive in any order and may contain gaps or
 * duplicate days (a same-day re-record); it is normalized here so callers can
 * hand over raw rows.
 *
 * `todayElevated` is the CURRENT reading, which the caller knows and which may
 * not be in `series` yet (the recorder is fire-and-forget). Passing it
 * explicitly avoids depending on whether today's write has landed.
 */
export function classifyChronicity(
  series: DayObservation[],
  todayElevated: boolean,
  today: string,
  opts: { windowDays?: number; minObserved?: number; chronicShare?: number } = {},
): ChronicityResult {
  const windowDays = opts.windowDays ?? WINDOW_DAYS;
  const minObserved = opts.minObserved ?? MIN_OBSERVED;
  const chronicShare = opts.chronicShare ?? CHRONIC_SHARE;

  const cutoff = shiftDay(today, -(windowDays - 1));
  if (!cutoff) return EMPTY;

  // Latest record wins for a duplicated day; today's live reading always wins
  // over a stored row for today.
  const byDay = new Map<string, boolean>();
  for (const o of series) {
    if (!o || typeof o.day !== "string") continue;
    if (o.day < cutoff || o.day > today) continue;
    byDay.set(o.day, !!o.elevated);
  }
  byDay.set(today, todayElevated);

  const days = [...byDay.keys()].sort();
  const flags = days.map((d) => byDay.get(d)!);

  const daysObserved = days.length;
  const daysElevated = flags.filter(Boolean).length;

  let streak = 0;
  for (let i = flags.length - 1; i >= 0 && flags[i]; i--) streak++;

  let onsets = 0;
  for (let i = 0; i < flags.length; i++) if (flags[i] && !flags[i - 1]) onsets++;

  const base = { daysElevated, daysObserved, streak, onsets };

  // Not elevated right now. Worth a word only if it WAS, recently.
  if (!todayElevated) {
    if (daysElevated === 0) return { ...base, state: "quiet", label: null };
    return { ...base, state: "improving", label: `clear today · elevated ${daysElevated} of last ${daysObserved} observed` };
  }

  // Elevated now, but we have too little history to characterise it. Say so
  // rather than implying either novelty or permanence.
  if (daysObserved < minObserved) {
    return { ...base, state: "unknown", label: `elevated · only ${daysObserved} day${daysObserved === 1 ? "" : "s"} of history` };
  }

  // The previous OBSERVED day, not "yesterday" — a gap must not read as a
  // recovery that never happened.
  const prevElevated = flags.length >= 2 ? flags[flags.length - 2] : false;
  if (!prevElevated) {
    return { ...base, state: "new", label: onsets > 1 ? `new today · ${onsets} flare-ups in ${daysObserved} observed days` : "new today" };
  }

  if (daysElevated / daysObserved >= chronicShare) {
    return { ...base, state: "chronic", label: `chronic · ${daysElevated} of last ${daysObserved} observed days` };
  }

  // Elevated for a couple of days but not most of them, and it has cleared and
  // returned — intermittent, which is its own planning problem.
  if (onsets >= 2) {
    return { ...base, state: "recurring", label: `recurring · ${onsets} flare-ups in ${daysObserved} observed days` };
  }

  return { ...base, state: "new", label: `elevated ${streak} day${streak === 1 ? "" : "s"} running` };
}

/** Short badge text for dense rows — the label without its evidence clause. */
export function chronicityBadge(state: Chronicity): string | null {
  switch (state) {
    case "chronic": return "CHRONIC";
    case "recurring": return "RECURRING";
    case "new": return "NEW";
    case "improving": return "IMPROVING";
    default: return null;
  }
}

/** Shift a yyyy-mm-dd by whole days. Returns null on an unparseable input
 *  rather than a wrong date — a bad day string must not silently produce a
 *  window that includes everything. */
export function shiftDay(day: string, delta: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t + delta * 86_400_000).toISOString().slice(0, 10);
}
