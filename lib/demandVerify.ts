// Demand-horizon verification — PURE, client-safe, unit-tested
// (docs/PLAN-TREND-LEARNING.md §4 B1).
//
// The 7-day demand horizon is the app's own deterministic forecast, so the
// app may score it — "the app never scores for you" protects the analyst's
// decision-log calls, not the app's claims. Each recorded outlook is judged
// against what the app OBSERVED in the seven days after it, using only
// series it already keeps: the AOR's day-peak mobility lift (warning_daily)
// and its posture composites (force_posture_daily). Disasters and NEO
// advisories are not stored as history, so they are not proxies; the label
// says what the score is against.
//
// Three-valued: right / wrong / AMBIGUOUS when the proxies were dead or too
// thin to decide — ambiguous stays visible and is never counted either way.
// HOLD forecasts are scored (a forecast that never commits still has to be
// right) but reported per direction, because a hit rate dominated by
// hold-on-hold days would flatter the board; and drivers are credited only
// on RISE/FALL calls — a driver's presence on a HOLD says nothing about it.

import type { DemandDirection, DemandDriver, DemandSource } from "./demandHorizon";
import { verdict, type Verdict } from "./series";

export type Outcome = "right" | "wrong" | "ambiguous";
export type ObservedDirection = DemandDirection | "unknown";

export interface ObservedWindow {
  /** Mean day-peak mobility over the observed days BEFORE the forecast day. */
  mobilityBefore: number | null;
  mobilityBeforeDays: number;
  /** Mean day-peak mobility over the observed days in (day, day+7]. */
  mobilityAfter: number | null;
  mobilityAfterDays: number;
  /** Posture entries in the AOR whose composite ended the window higher / lower than at the forecast day. */
  postureUps: number;
  postureDowns: number;
  /** Distinct days in the window with any posture row for the AOR. */
  postureObservedDays: number;
}

export const MOBILITY_RISE_RATIO = 1.25;
export const MOBILITY_FALL_RATIO = 0.8;
export const MIN_MOBILITY_BEFORE_DAYS = 5;
export const MIN_MOBILITY_AFTER_DAYS = 4;
export const MIN_POSTURE_DAYS = 3;
/** Same floor as the decision log: two-for-three is not skill. */
export const MIN_SCORED_FOR_SKILL = 5;
/** A driver below this magnitude is not credited (mirrors demandHorizon's MATERIAL). */
const MATERIAL = 8;

export function observedDirection(w: ObservedWindow): { direction: ObservedDirection; why: string } {
  const mobilityKnown = w.mobilityBefore != null && w.mobilityAfter != null
    && w.mobilityBeforeDays >= MIN_MOBILITY_BEFORE_DAYS && w.mobilityAfterDays >= MIN_MOBILITY_AFTER_DAYS && w.mobilityBefore > 0;
  const postureKnown = w.postureObservedDays >= MIN_POSTURE_DAYS;
  if (!mobilityKnown && !postureKnown) return { direction: "unknown", why: "lift and posture both unobserved in the window" };

  let mob: ObservedDirection = "unknown";
  if (mobilityKnown) {
    const ratio = w.mobilityAfter! / w.mobilityBefore!;
    mob = ratio >= MOBILITY_RISE_RATIO ? "rise" : ratio <= MOBILITY_FALL_RATIO ? "fall" : "hold";
  }
  let pos: ObservedDirection = "unknown";
  if (postureKnown) pos = w.postureUps > w.postureDowns ? "rise" : w.postureDowns > w.postureUps ? "fall" : "hold";

  const mobText = mobilityKnown ? `lift ${w.mobilityBefore!.toFixed(0)}→${w.mobilityAfter!.toFixed(0)}/day` : "lift unobserved";
  const posText = postureKnown ? `posture ${w.postureUps}↑ ${w.postureDowns}↓` : "posture unobserved";
  const why = `${mobText}, ${posText}`;

  // Lift is the direct measure; posture corroborates or, alone, decides.
  if (mob !== "unknown" && pos !== "unknown") {
    if (mob === pos) return { direction: mob, why };
    if (mob === "hold") return { direction: pos, why };          // a posture move the lift has not yet answered
    return { direction: mob, why };                              // lift moved: that is demand
  }
  return { direction: mob !== "unknown" ? mob : pos, why };
}

export interface ScoredOutlook {
  day: string;
  aor: string;
  direction: DemandDirection;
  drivers: DemandDriver[];
  outcome: Outcome;
  observed: ObservedDirection;
  why: string;
}

export function scoreOutlook(
  forecast: { day: string; aor: string; direction: DemandDirection; drivers: DemandDriver[] },
  w: ObservedWindow,
): ScoredOutlook {
  const obs = observedDirection(w);
  const outcome: Outcome = obs.direction === "unknown" ? "ambiguous" : obs.direction === forecast.direction ? "right" : "wrong";
  return { day: forecast.day, aor: forecast.aor, direction: forecast.direction, drivers: forecast.drivers, outcome, observed: obs.direction, why: obs.why };
}

export interface SourceSkill { source: DemandSource; hits: number; scored: number; verdict: Verdict }

export interface DemandSkill {
  scored: number;
  ambiguous: number;
  overall: Verdict;
  byDirection: Record<DemandDirection, Verdict>;
  /** Over RISE/FALL calls only. */
  bySource: SourceSkill[];
  /** One sentence for a card footer or the OE snapshot. */
  line: string;
}

export function demandSkill(scoredRows: ScoredOutlook[], minScored = MIN_SCORED_FOR_SKILL): DemandSkill {
  const decided = scoredRows.filter((r) => r.outcome !== "ambiguous");
  const ambiguous = scoredRows.length - decided.length;
  const hits = decided.filter((r) => r.outcome === "right").length;
  const overall = verdict(hits, decided.length, minScored);

  const byDirection = {} as Record<DemandDirection, Verdict>;
  for (const dir of ["rise", "hold", "fall"] as DemandDirection[]) {
    const rows = decided.filter((r) => r.direction === dir);
    byDirection[dir] = verdict(rows.filter((r) => r.outcome === "right").length, rows.length, minScored);
  }

  const src = new Map<DemandSource, { hits: number; scored: number }>();
  for (const r of decided) {
    if (r.direction === "hold") continue;
    const present = new Set(r.drivers.filter((d) => Math.abs(d.delta) >= MATERIAL).map((d) => d.source));
    for (const s of present) {
      const e = src.get(s) ?? { hits: 0, scored: 0 };
      e.scored++;
      if (r.outcome === "right") e.hits++;
      src.set(s, e);
    }
  }
  const bySource: SourceSkill[] = Array.from(src.entries())
    .map(([source, e]) => ({ source, hits: e.hits, scored: e.scored, verdict: verdict(e.hits, e.scored, minScored) }))
    .sort((a, b) => b.scored - a.scored);

  let line: string;
  if (scoredRows.length === 0) line = "Skill: no outlook old enough to score yet — the horizon is 7 days.";
  else if (decided.length === 0) line = `Skill: ${scoredRows.length} outlook${scoredRows.length === 1 ? "" : "s"} due, all ambiguous (lift/posture unobserved in the window).`;
  else {
    const parts = [`Skill: ${overall.label} against observed lift and posture`];
    const rf = decided.filter((r) => r.direction !== "hold");
    if (rf.length) parts.push(`RISE/FALL calls ${rf.filter((r) => r.outcome === "right").length} of ${rf.length}`);
    if (ambiguous) parts.push(`${ambiguous} ambiguous`);
    line = parts.join(" · ");
  }
  return { scored: scoredRows.length, ambiguous, overall, byDirection, bySource, line };
}
