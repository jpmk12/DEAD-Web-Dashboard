// Two reads of the same sighting history that nothing was using.
//
// PURE, client-safe, unit-tested. `household_bills` has been accumulating every
// bill sighting — date and amount per biller — and only two things ever read it:
// `silenceWatch` (did it arrive?) and `amountDelta` (is THIS bill unusual
// against its own average?). Neither looks along the series.
//
//   observedCadence — what the biller ACTUALLY does, versus what you declared.
//                     A declared cadence is load-bearing: it is what lets the
//                     silence watch tell "quarterly" from "stopped". If the
//                     declaration is wrong, the silence watch is wrong, and
//                     today nothing would ever tell you.
//
//   creep           — slow, compounding increases. `amountDelta` compares a
//                     bill to its trailing average and stays quiet under 15%,
//                     which is correct for one bill and blind to three 6% rises
//                     in a year. Creep is invisible precisely because each step
//                     is individually unremarkable.
//
// ── Discipline ────────────────────────────────────────────────────────────
// Both obey the learning-mode floor that runs through this codebase: below a
// minimum number of samples they return null rather than a number. Four
// sightings cannot establish a cadence, and two amounts are not a trend — and a
// confidently wrong cadence correction would break the silence watch that
// currently works.

import type { BillCadence, FamilyBiller } from "./familyProfile";

/** One stored sighting, narrowed to what these functions need. */
export interface BillSample {
  billerId: string;
  seenISO: string;          // yyyy-mm-dd
  amountCents: number | null;
}

const DAY = 86_400_000;
const toMs = (iso: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const t = Date.parse(`${iso}T12:00:00Z`);
  return Number.isFinite(t) ? t : null;
};

/** Median is used rather than the mean throughout: one statement that arrived
 *  three weeks late would drag a mean enough to reclassify a monthly biller. */
export function median(ns: number[]): number | null {
  if (ns.length === 0) return null;
  const s = ns.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// ─────────────────────────── observed cadence ───────────────────────────

/** Gaps needed before we will name a cadence. Four sightings = three gaps, the
 *  fewest from which a median is not just "the middle one". */
export const MIN_GAPS = 3;

/** Share of gaps that must fall inside the band, not merely the median. Without
 *  this, one wildly irregular biller reads as regular — see observedCadence. */
export const CADENCE_CONSISTENCY = 0.6;

/** Bands for naming an observed gap. Generous, because statements slip. */
const BANDS: { cadence: Exclude<BillCadence, "irregular">; min: number; max: number }[] = [
  { cadence: "monthly", min: 20, max: 45 },
  { cadence: "quarterly", min: 75, max: 110 },
  { cadence: "annual", min: 300, max: 430 },
];

export interface ObservedCadence {
  biller: FamilyBiller;
  /** Median days between sightings. */
  medianGap: number;
  gaps: number;
  /** The band the median fell in, or null when it fits none. */
  observed: BillCadence | null;
  /** True when `observed` is a real cadence that disagrees with the declaration. */
  disagrees: boolean;
  /** One sentence, always safe to render. */
  reason: string;
}

/**
 * What the biller actually does. Returns null when there is not enough history
 * — with three sightings, "quarterly" and "monthly but you missed two" look
 * identical, and a wrong correction here would break a silence watch that works.
 */
export function observedCadence(
  biller: FamilyBiller,
  samples: BillSample[],
  opts: { minGaps?: number } = {},
): ObservedCadence | null {
  const minGaps = opts.minGaps ?? MIN_GAPS;
  const days = samples
    .filter((s) => s.billerId === biller.id)
    .map((s) => toMs(s.seenISO))
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);
  if (days.length < minGaps + 1) return null;

  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) {
    const g = Math.round((days[i] - days[i - 1]) / DAY);
    // A same-day duplicate is a re-read, not a cycle.
    if (g > 0) gaps.push(g);
  }
  if (gaps.length < minGaps) return null;

  const medianGap = median(gaps)!;
  const band = BANDS.find((b) => medianGap >= b.min && medianGap <= b.max);
  // A median inside a band is not enough — it hides dispersion. Gaps of 8, 12,
  // 60 and 140 days have a median of 36 and would be named "monthly", which
  // would then produce a confident (and wrong) correction against the user's
  // declaration and break the silence watch this is supposed to protect. So
  // most of the gaps must ALSO sit in the band before we name it.
  const inBand = band ? gaps.filter((g) => g >= band.min && g <= band.max).length : 0;
  const consistent = !!band && inBand / gaps.length >= CADENCE_CONSISTENCY;
  const observed: BillCadence | null = consistent ? band!.cadence : null;

  // Only a CONFIDENT observation contradicts a declaration. A median that fits
  // no band means this biller is irregular in practice, which is information
  // but not grounds to overwrite what the user said.
  const disagrees = observed !== null && biller.cadence !== "irregular" && observed !== biller.cadence;

  const reason = observed
    ? `writes about every ${medianGap} days (${observed}) across ${gaps.length} cycles` +
      (disagrees ? ` — you declared ${biller.cadence}` : "")
    : `${gaps.length} cycles, ${medianGap} days on median, too scattered to call a cadence`;

  return { biller, medianGap, gaps: gaps.length, observed, disagrees, reason };
}

// ───────────────────────────── amount creep ─────────────────────────────

/** Amounts needed before a trend is claimed. */
export const MIN_CREEP_SAMPLES = 4;

/** Total rise across the window that counts as creep, as a fraction. Set above
 *  AMOUNT_ALERT_PCT (15%) deliberately: a single 15% jump is already reported by
 *  `amountDelta`, and this exists for the case that one cannot see. */
export const CREEP_PCT = 0.2;

/** An implausible parse must not poison a trend. Mirrors the guard amountDelta
 *  applies to a single bill. */
const MAX_PLAUSIBLE_CENTS = 10_000_000;

export interface AmountCreep {
  biller: FamilyBiller;
  firstCents: number;
  lastCents: number;
  /** Fractional rise from the oldest to the newest amount. */
  risePct: number;
  /** How many of the step-to-step changes were increases. */
  increases: number;
  steps: number;
  samples: number;
  reason: string;
}

/**
 * Slow compounding rises. Requires BOTH a meaningful total rise and that most
 * steps were increases: a bill that doubled once and then sat flat is a jump
 * `amountDelta` already reported, not creep, and conflating them would double-
 * report the loud case while still missing the quiet one.
 */
export function amountCreep(
  biller: FamilyBiller,
  samples: BillSample[],
  opts: { minSamples?: number; creepPct?: number } = {},
): AmountCreep | null {
  const minSamples = opts.minSamples ?? MIN_CREEP_SAMPLES;
  const creepPct = opts.creepPct ?? CREEP_PCT;

  const series = samples
    .filter((s) => s.billerId === biller.id)
    .filter((s) => typeof s.amountCents === "number" && s.amountCents! > 0 && s.amountCents! < MAX_PLAUSIBLE_CENTS)
    .map((s) => ({ t: toMs(s.seenISO), c: s.amountCents as number }))
    .filter((x): x is { t: number; c: number } => x.t !== null)
    .sort((a, b) => a.t - b.t);
  if (series.length < minSamples) return null;

  const firstCents = series[0].c;
  const lastCents = series[series.length - 1].c;
  if (firstCents <= 0) return null;

  const risePct = (lastCents - firstCents) / firstCents;
  if (risePct < creepPct) return null;

  let increases = 0;
  for (let i = 1; i < series.length; i++) if (series[i].c > series[i - 1].c) increases++;
  const steps = series.length - 1;
  // Most steps must be up. Otherwise this is a single jump, already covered.
  if (increases * 2 <= steps) return null;

  return {
    biller, firstCents, lastCents, risePct, increases, steps, samples: series.length,
    reason: `up ${Math.round(risePct * 100)}% across ${series.length} bills — ${increases} of ${steps} rose, ` +
      `no single step large enough to flag on its own`,
  };
}
