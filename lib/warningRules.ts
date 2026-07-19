// I&W sensor calibration rules — PURE, client-safe, unit-tested. These are the
// tunable judgments that turn raw feed values into observation states, split out
// of lib/warningSensors so they're testable and reviewable in one place.
//
// The through-line: BOTH halves of every signal must be baseline- or recency-
// relative. A permanent condition (Iran is always Level-4; a year of UCDP events
// is always >10; Gulf hubs always have >4 mobility aircraft) is posture, not
// warning — and any indicator pinned by one has zero warning sensitivity.

import type { ObservedState } from "./warning";

// ── NEO / departure posture ──────────────────────────────────────────────────
// A Level-4 advisory is only a warning SIGNAL when it's NEW — Iran/Iraq/Syria/
// Yemen/Lebanon are permanently Level-4, which used to pin this indicator (and
// impliedHigh) permanently on. Same 14-day recency gate the Glance tab uses.
// Ordered/authorized departure stays ungated: the RSS carries it only while in
// effect, and an in-effect departure order IS the warning state.
export const RECENT_L4_WINDOW_MS = 14 * 86_400_000;

export function isRecentLevel4(adv: { level: number | null; pubDate?: string }, nowMs: number): boolean {
  if (adv.level !== 4 || !adv.pubDate) return false;
  const t = Date.parse(adv.pubDate);
  return Number.isFinite(t) && nowMs - t < RECENT_L4_WINDOW_MS;
}

// ── Conflict intensity ───────────────────────────────────────────────────────
// Band on a ~90-day slice, not the feed's full 365-day window: a year of AOR
// events saturates any threshold, and a saturated indicator can't move when
// strikes double. 90d (not 30d) because UCDP's monthly candidates lag 1-2 months
// — a 30d window would routinely read zero. Undated points (ReliefWeb ongoing
// situations) count as current. Thresholds are 90-day event-count judgments for
// a theater-scale bbox; tune against real history.
export const CONFLICT_WINDOW_DAYS = 90;

export function recentConflictCount(
  points: { count: number; date?: string }[],
  nowMs: number,
  windowDays = CONFLICT_WINDOW_DAYS,
): number {
  const cutoff = nowMs - windowDays * 86_400_000;
  let sum = 0;
  for (const p of points) {
    if (p.date) {
      const t = Date.parse(p.date);
      if (Number.isFinite(t) && t < cutoff) continue;   // dated + old → out
    }
    sum += p.count || 1;                                 // undated = current situation
  }
  return sum;
}

export function bandConflictIntensity(recent90: number): ObservedState {
  if (recent90 <= 0) return "dormant";
  if (recent90 <= 10) return "watching";
  if (recent90 <= 40) return "active";
  return "confirmed";
}

// Implied-demand trigger from conflict: confirmed-level 90-day intensity, not
// "any events in the last year".
export function conflictImpliesDemand(recent90: number): boolean {
  return recent90 > 40;
}

// ── Mobility divergence (observed half) ──────────────────────────────────────
// "Observed surge" must mean surge ABOVE THIS AOR'S OWN NORMAL — a static ≥4
// within 600 km of five Gulf hubs is exceeded on any ordinary day, which pinned
// the divergence to the "surge" column. Once the daily-count baseline has enough
// samples, surge = today > mean × 1.4 (and at least mean + 2, so a tiny mean
// doesn't make +1 aircraft a "surge"). While the baseline is still forming we
// fall back to a deliberately HIGH static bar (a real theater surge), so a
// half-learned baseline can't cry surge on a normal day.
export const MOBILITY_BASELINE_MIN_SAMPLES = 5;
export const MOBILITY_SURGE_FACTOR = 1.4;
export const MOBILITY_FALLBACK_SURGE = 25;

export interface MobilityBaseline { mean: number | null; samples: number }

export function mobilityObservedHigh(count: number, baseline: MobilityBaseline): boolean {
  if (baseline.mean != null && baseline.samples >= MOBILITY_BASELINE_MIN_SAMPLES) {
    return count > Math.max(baseline.mean * MOBILITY_SURGE_FACTOR, baseline.mean + 2);
  }
  return count >= MOBILITY_FALLBACK_SURGE;
}
