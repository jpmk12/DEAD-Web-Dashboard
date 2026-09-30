// Series maths — PURE, client-safe, unit-tested. The one toolkit every trend
// read goes through (docs/PLAN-TREND-LEARNING.md §3 A1), so the disciplines
// live in one place:
//
// - OBSERVED days, never calendar days. Every series here is the days the
//   app actually recorded; a gap is a gap, not a zero. Windows are "the last
//   N observed points", ratios are "of observed days", and the labels say so.
// - LEARNING FLOORS. Below the floor a function returns null (or a tally),
//   never a number that looks better-founded than it is. Four points for a
//   slope, four same-weekday samples for a weekday baseline, three events
//   for a lead test, MIN_SCORED for a rate.
// - The caller decides what "elevated" or "hit" means; this module is
//   value-agnostic (the chronicity rule).

export interface SeriesPoint { day: string; value: number }

/** Floors, exported so surfaces and tests pin the same numbers. */
export const SLOPE_MIN_POINTS = 4;
export const WEEKDAY_MIN_SAMPLES = 4;
export const LEAD_MIN_EVENTS = 3;
export const HIGH_WATER_MIN_PRIOR = 7;

const DAY_MS = 86_400_000;

/** yyyy-mm-dd → ms at 00:00Z; NaN for a malformed day. */
export function dayMs(day: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00Z`) : NaN;
}

/** Whole days from a to b (b − a); NaN if either is malformed. */
export function dayDiff(a: string, b: string): number {
  return Math.round((dayMs(b) - dayMs(a)) / DAY_MS);
}

/** UTC weekday 0..6 of a yyyy-mm-dd; -1 if malformed. */
export function weekdayOf(day: string): number {
  const ms = dayMs(day);
  return Number.isFinite(ms) ? new Date(ms).getUTCDay() : -1;
}

function sorted(series: SeriesPoint[]): SeriesPoint[] {
  return series
    .filter((p) => Number.isFinite(p.value) && Number.isFinite(dayMs(p.day)))
    .slice()
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

// ── Slope ───────────────────────────────────────────────────────────────────
// Least-squares slope over the last `window` OBSERVED points, in value units
// per observed step (not per calendar day — a fortnight of gaps would otherwise
// read as a plateau). Null below SLOPE_MIN_POINTS or when every value is equal.
export function slope(series: SeriesPoint[], window = 14): number | null {
  const pts = sorted(series).slice(-window);
  if (pts.length < SLOPE_MIN_POINTS) return null;
  const n = pts.length;
  const xm = (n - 1) / 2;
  const ym = pts.reduce((s, p) => s + p.value, 0) / n;
  let num = 0, den = 0;
  pts.forEach((p, i) => { num += (i - xm) * (p.value - ym); den += (i - xm) ** 2; });
  return den === 0 ? null : num / den;
}

/** Sign of the slope against a relative threshold: ±5% of the mean per step. */
export function direction(series: SeriesPoint[], window = 14): "rising" | "falling" | "flat" | null {
  const s = slope(series, window);
  if (s == null) return null;
  const pts = sorted(series).slice(-window);
  const mean = pts.reduce((a, p) => a + p.value, 0) / pts.length;
  const bar = Math.max(Math.abs(mean) * 0.05, 1e-9);
  return s > bar ? "rising" : s < -bar ? "falling" : "flat";
}

// ── Run length ──────────────────────────────────────────────────────────────
/** Consecutive observed points (newest back) satisfying `pred`. */
export function runLength(series: SeriesPoint[], pred: (v: number) => boolean): number {
  const pts = sorted(series);
  let n = 0;
  for (let i = pts.length - 1; i >= 0 && pred(pts[i].value); i--) n++;
  return n;
}

// ── High water ──────────────────────────────────────────────────────────────
export interface HighWater {
  today: number | null;
  priorHigh: number | null;
  priorHighDay: string | null;
  /** Today strictly above every prior value in the window. Null while the
   *  window holds fewer than HIGH_WATER_MIN_PRIOR prior points. */
  isHigh: boolean | null;
  priorPoints: number;
}

export function highWater(series: SeriesPoint[], today: string, windowDays = 90): HighWater {
  const pts = sorted(series);
  const todayPt = pts.find((p) => p.day === today) ?? null;
  const cutoff = dayMs(today) - windowDays * DAY_MS;
  const prior = pts.filter((p) => p.day < today && dayMs(p.day) >= cutoff);
  let priorHigh: number | null = null, priorHighDay: string | null = null;
  for (const p of prior) if (priorHigh == null || p.value > priorHigh) { priorHigh = p.value; priorHighDay = p.day; }
  const isHigh = todayPt && prior.length >= HIGH_WATER_MIN_PRIOR && priorHigh != null ? todayPt.value > priorHigh : null;
  return { today: todayPt?.value ?? null, priorHigh, priorHighDay, isHigh, priorPoints: prior.length };
}

// ── Baselines ───────────────────────────────────────────────────────────────
export interface Baseline { mean: number | null; samples: number; kind: "weekday" | "flat" | "none" }

/** Flat trailing mean of the last `days` PRIOR points (day < today). */
export function flatBaseline(series: SeriesPoint[], today: string, days = 30): Baseline {
  const prior = sorted(series).filter((p) => p.day < today).slice(-days);
  if (!prior.length) return { mean: null, samples: 0, kind: "none" };
  return { mean: prior.reduce((s, p) => s + p.value, 0) / prior.length, samples: prior.length, kind: "flat" };
}

/** Same-UTC-weekday mean over prior points; null below WEEKDAY_MIN_SAMPLES.
 *  Mobility lift and strait transits both have a weekly cycle — a Monday
 *  count judged against a flat mean that includes Saturdays reads as a surge
 *  on an ordinary Monday. */
export function weekdayBaseline(series: SeriesPoint[], today: string, minSamples = WEEKDAY_MIN_SAMPLES): Baseline {
  const wd = weekdayOf(today);
  if (wd < 0) return { mean: null, samples: 0, kind: "none" };
  const same = sorted(series).filter((p) => p.day < today && weekdayOf(p.day) === wd);
  if (same.length < minSamples) return { mean: null, samples: same.length, kind: "none" };
  return { mean: same.reduce((s, p) => s + p.value, 0) / same.length, samples: same.length, kind: "weekday" };
}

/** Weekday baseline when it has earned itself, else the flat one. */
export function bestBaseline(series: SeriesPoint[], today: string, flatDays = 30): Baseline {
  const w = weekdayBaseline(series, today);
  return w.kind === "weekday" ? w : flatBaseline(series, today, flatDays);
}

// ── Share of observed days ──────────────────────────────────────────────────
export interface Share { hits: number; observed: number; label: string }

/** "6 of 22 observed days" inside the trailing calendar window (today included). */
export function shareOfObserved(series: SeriesPoint[], pred: (v: number) => boolean, today: string, windowDays = 30, noun = "observed days"): Share {
  const cutoff = dayMs(today) - (windowDays - 1) * DAY_MS;
  const pts = sorted(series).filter((p) => p.day <= today && dayMs(p.day) >= cutoff);
  const hits = pts.filter((p) => pred(p.value)).length;
  return { hits, observed: pts.length, label: `${hits} of ${pts.length} ${noun}` };
}

// ── Lead / lag ──────────────────────────────────────────────────────────────
export interface LeadResult {
  hits: number;
  events: number;
  /** Median days the lead preceded the event (0 = same day). */
  medianLeadDays: number | null;
  label: string;
}

/** For each event day, did the lead series have a hit inside the prior
 *  `maxLagDays` (same day counts as lag 0)? Null below LEAD_MIN_EVENTS events
 *  — "preceded 1 of 1" is an anecdote. */
export function precedes(leadHitDays: string[], eventDays: string[], maxLagDays: number): LeadResult | null {
  const events = Array.from(new Set(eventDays.filter((d) => Number.isFinite(dayMs(d))))).sort();
  if (events.length < LEAD_MIN_EVENTS) return null;
  const leads = Array.from(new Set(leadHitDays.filter((d) => Number.isFinite(dayMs(d))))).sort();
  const lags: number[] = [];
  let hits = 0;
  for (const e of events) {
    let best: number | null = null;
    for (const l of leads) {
      const lag = dayDiff(l, e);
      if (lag >= 0 && lag <= maxLagDays && (best == null || lag < best)) best = lag;
    }
    if (best != null) { hits++; lags.push(best); }
  }
  lags.sort((a, b) => a - b);
  const medianLeadDays = lags.length ? lags[Math.floor((lags.length - 1) / 2)] : null;
  const lead = medianLeadDays == null ? "" : medianLeadDays === 0 ? ", same day" : `, median lead ${medianLeadDays} d`;
  return { hits, events: events.length, medianLeadDays, label: `preceded ${hits} of ${events.length}${lead}` };
}

// ── Verdicts ────────────────────────────────────────────────────────────────
export interface Verdict { rate: number | null; label: string }

/** A tally below `minScored`, a rate at or above it. The decision-log rule:
 *  two-for-three is not 67% skill. */
export function verdict(hits: number, total: number, minScored: number): Verdict {
  if (total <= 0) return { rate: null, label: "nothing scored yet" };
  if (total < minScored) return { rate: null, label: `${hits} of ${total} so far (${minScored - total} more before a rate)` };
  const rate = hits / total;
  return { rate, label: `${Math.round(rate * 100)}% (${hits} of ${total})` };
}

/** Ordinal helper for level-like series: index in an ordered vocabulary, or -1. */
export function ordinal<T extends string>(order: readonly T[], v: string): number {
  return order.indexOf(v as T);
}
