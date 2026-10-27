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

// ── Conflict intensity × the user's own captured events ─────────────────────
// ACLED is embargoed a year on the free tier and UCDP lags one to two months,
// so the structured count can read DORMANT in a week of strikes. The user's
// browser-captured map events (lib/kineticEvents — LiveUAMap, read for a
// kinetic ACT and placed) are the timeliest georeferenced record the app
// holds, and they are the user's OWN source: the same ceiling as a single X
// post applies. Rules:
//   - structured feed live and already at or above watching: the state is
//     the feed's; CAPTURE_CORROBORATE_AT or more captured acts in the AOI add
//     a little confidence and are named in the note.
//   - structured feed live but dormant: CAPTURE_WATCH_AT or more captured
//     acts in 14 d lift it to WATCHING (never higher — own capture only),
//     confidence 0.4; fewer are a note.
//   - structured feed dead: the same floor earns watching at 0.35 and the
//     note says the structured feeds were unreachable. Below the floor the
//     indicator stays unobserved (dormant, health live:false) — a dead feed
//     plus two captures is not evidence of calm or of conflict.
export const CAPTURE_WATCH_AT = 5;
export const CAPTURE_CORROBORATE_AT = 5;

export function conflictWithCaptures(
  structured: { state: ObservedState; confidence: number; live: boolean },
  captured14d: number,
): { state: ObservedState; confidence: number; note: string } {
  const n = Math.max(0, Math.floor(captured14d));
  const mention = n > 0 ? `${n} captured kinetic event${n === 1 ? "" : "s"} in the AOI (LiveUAMap, your capture, 14 d)` : "";
  if (structured.live) {
    if (structured.state !== "dormant") {
      const boost = n >= CAPTURE_CORROBORATE_AT ? 0.05 : 0;
      return { state: structured.state, confidence: Math.min(0.9, structured.confidence + boost), note: mention ? `; ${mention}${boost ? " corroborate" : ""}` : "" };
    }
    if (n >= CAPTURE_WATCH_AT) return { state: "watching", confidence: 0.4, note: `; ${mention} — own capture only, caps at watching` };
    return { state: "dormant", confidence: 0, note: mention ? `; ${mention} — below the ${CAPTURE_WATCH_AT}-event floor` : "" };
  }
  if (n >= CAPTURE_WATCH_AT) return { state: "watching", confidence: 0.35, note: `; structured conflict feeds unreachable — ${mention} — own capture only, caps at watching` };
  return { state: "dormant", confidence: 0, note: mention ? `; structured conflict feeds unreachable — ${mention} — below the ${CAPTURE_WATCH_AT}-event floor` : "" };
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
export const MOBILITY_WEEKDAY_MIN_SAMPLES = 4;
export const MOBILITY_SURGE_FACTOR = 1.4;
export const MOBILITY_FALLBACK_SURGE = 25;

// `weekdayMean` / `weekdaySamples` are the SAME-WEEKDAY trailing mean (four
// weeks of that weekday before it counts). Lift has a weekly cycle — a Monday
// judged against a flat mean that includes Saturdays reads as a surge on an
// ordinary Monday — so once the weekday baseline exists it is the one the
// surge rule uses, and the provenance names which it used.
export interface MobilityBaseline {
  mean: number | null;
  samples: number;
  weekdayMean?: number | null;
  weekdaySamples?: number;
}

export interface EffectiveBaseline { mean: number | null; samples: number; kind: "weekday" | "flat" | "none" }

export function effectiveMobilityBaseline(b: MobilityBaseline): EffectiveBaseline {
  if (b.weekdayMean != null && (b.weekdaySamples ?? 0) >= MOBILITY_WEEKDAY_MIN_SAMPLES) {
    return { mean: b.weekdayMean, samples: b.weekdaySamples ?? 0, kind: "weekday" };
  }
  if (b.mean != null && b.samples >= MOBILITY_BASELINE_MIN_SAMPLES) return { mean: b.mean, samples: b.samples, kind: "flat" };
  return { mean: null, samples: 0, kind: "none" };
}

export function mobilityObservedHigh(count: number, baseline: MobilityBaseline): boolean {
  const eff = effectiveMobilityBaseline(baseline);
  if (eff.mean != null) return count > Math.max(eff.mean * MOBILITY_SURGE_FACTOR, eff.mean + 2);
  return count >= MOBILITY_FALLBACK_SURGE;
}

// ── Mobility divergence × the user's own lift chatter ───────────────────────
// Plane-spotter posts ("six KC-135s out of Mildenhall heading east") read the
// same ADS-B the sensor reads, aggregated by a human and NAMED by
// destination (lib/mobilityChatter). They are the user's own source, so the
// single-X-post ceiling applies:
//   - ADS-B live and already HIGH: chatter corroborates — confidence up a
//     step, named in the note; the state is the observation's.
//   - ADS-B live and NOT high: two or more handles reporting lift toward the
//     command lift a DORMANT read to WATCHING (reported, not observed — and
//     never past watching); an active early-warning read (demand with no
//     lift seen) keeps its state and gains the note that lift is reported
//     en route; one handle is a lead and a note only.
//   - ADS-B dead: any chatter earns WATCHING at 0.35 — reported only.
export interface ChatterLite { reports: number; sources: number; tankers: number; airlifters: number; count: number | null; lead: string | null }
export const CHATTER_CORROBORATE_SOURCES = 2;

export function mobilityWithChatter(
  base: { state: ObservedState; confidence: number; observedHigh: boolean; live: boolean },
  chatter: ChatterLite | null,
): { state: ObservedState; confidence: number; note: string } {
  if (!chatter || chatter.reports <= 0) return { state: base.state, confidence: base.confidence, note: "" };
  const what = [chatter.tankers ? `${chatter.tankers} tanker` : "", chatter.airlifters ? `${chatter.airlifters} airlift` : ""].filter(Boolean).join(" + ");
  const who = `${chatter.reports} report${chatter.reports === 1 ? "" : "s"} from ${chatter.sources} ${chatter.sources === 1 ? "handle" : "handles"}`;
  const says = `your sources report lift toward the AOI (${who}${what ? `: ${what}` : ""}${chatter.count ? `, up to ${chatter.count} stated` : ""})`;
  if (!base.live) return { state: "watching", confidence: 0.35, note: `; ADS-B unreachable — ${says} — reported only, capped at watching` };
  if (base.observedHigh) return { state: base.state, confidence: Math.min(0.9, base.confidence + 0.1), note: `; ${says} — corroborates the observed lift` };
  if (chatter.sources >= CHATTER_CORROBORATE_SOURCES) {
    if (base.state === "dormant") return { state: "watching", confidence: 0.4, note: `; ${says} — not yet above normal on ADS-B; reported, not observed — caps at watching` };
    return { state: base.state, confidence: base.confidence, note: `; ${says} — lift reported en route that ADS-B has not yet shown above normal` };
  }
  return { state: base.state, confidence: base.confidence, note: `; ${says} — a single handle is a lead, not a signal` };
}

/** The provenance fragment naming the baseline the surge rule judged against. */
export function mobilityBaselineNote(baseline: MobilityBaseline, today?: string): string {
  const eff = effectiveMobilityBaseline(baseline);
  if (eff.kind === "weekday") {
    const wd = today ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${today}T00:00:00Z`).getUTCDay()] ?? "" : "";
    return `, vs ${wd ? `${wd} ` : "same-weekday "}normal ~${eff.mean!.toFixed(0)} over ${eff.samples} wk`;
  }
  if (eff.kind === "flat") return `, baseline ~${eff.mean!.toFixed(0)}/day over ${eff.samples}d`;
  return baseline.mean != null ? `, baseline ~${baseline.mean.toFixed(0)}/day over ${baseline.samples}d (forming)` : ", baseline forming";
}

// ── (d) Chokepoint interdiction — graded, not counted ───────────────────────
// The chokepoint indicator used to count GDELT items containing any of a few
// substrings ("clos", "mine", "seiz"…), so a think-piece about mining the
// strait scored like a tanker actually struck. It now reads the SAME graded
// activity read the Economy tab's chokepoint board shows (lib/chokepointSignals
// readActivity: modality act / threat / analysis + georeferenced events near
// the point), and this rule turns that read into an observed state.
//
// Discipline (mirrors the user-source rule above): a REPORTED ACT is active;
// with the user's own sources agreeing it is confirmed. A DECLARED THREAT is
// watching; agreement lifts it to active. ANALYSIS alone never passes
// watching, and needs two pieces to reach it. Kinetic events in the
// approaches with no interdiction text at all are watching — something is
// happening there, but nobody has called it interdiction. Own-source-only
// still caps at watching.
export interface ChokepointReadLite {
  acts: number; threats: number; analysis: number; events: number; score: number;
  /** AIS transit state when keyed (lib/chokepointTransit): "suppressed" is
   *  what ships DO when a strait is interdicted, and corroborates the text. */
  transit?: "unconfigured" | "unknown" | "learning" | "normal" | "suppressed" | "elevated";
  /** How often suppressed transits have preceded a reported act HERE
   *  (lib/series.precedes hits/events); null until three acts are on record.
   *  Confidence only — never a state change. */
  transitLeadRate?: number | null;
}

/** A lead rate at or above this earns the extra confidence. */
export const TRANSIT_LEAD_TRUSTED = 0.6;

export function chokepointState(read: ChokepointReadLite | null, userHits: number): { state: ObservedState; confidence: number; why: string } {
  const base = chokepointTextState(read, userHits);
  // AIS corroboration: suppressed traffic lifts a text-derived state one step
  // (dormant → watching, watching → active, active → confirmed) and adds
  // confidence; it never lowers one, and "normal" traffic does not clear a
  // reported act — ships keep sailing through threats until they don't.
  // Where this strait's own history says suppression has preceded acts, the
  // lift is trusted a little more; the STATE is the same either way.
  if (read?.transit === "suppressed") {
    const up: Record<ObservedState, ObservedState> = { dormant: "watching", watching: "active", active: "confirmed", confirmed: "confirmed" };
    const trusted = read.transitLeadRate != null && read.transitLeadRate >= TRANSIT_LEAD_TRUSTED;
    return {
      state: up[base.state],
      confidence: Math.min(0.9, base.confidence + 0.15 + (trusted ? 0.05 : 0)),
      why: `${base.why}; AIS traffic suppressed vs its own normal${trusted ? ` (has preceded ${Math.round(read.transitLeadRate! * 100)}% of acts here)` : ""}`,
    };
  }
  return base;
}

function chokepointTextState(read: ChokepointReadLite | null, userHits: number): { state: ObservedState; confidence: number; why: string } {
  if (!read) {
    if (userHits >= 1) return { state: "watching", confidence: 0.45, why: "own sources only (read unavailable)" };
    return { state: "dormant", confidence: 0, why: "read unavailable" };
  }
  if (read.acts >= 1) {
    return userHits >= 1
      ? { state: "confirmed", confidence: 0.8, why: `${read.acts} reported act${read.acts === 1 ? "" : "s"}, corroborated by your sources` }
      : { state: "active", confidence: 0.7, why: `${read.acts} reported act${read.acts === 1 ? "" : "s"}` };
  }
  if (read.threats >= 1) {
    return userHits >= 1
      ? { state: "active", confidence: 0.6, why: `${read.threats} declared threat${read.threats === 1 ? "" : "s"}, corroborated by your sources` }
      : { state: "watching", confidence: 0.55, why: `${read.threats} declared threat${read.threats === 1 ? "" : "s"}` };
  }
  if (read.events >= 3) return { state: "watching", confidence: 0.5, why: `${read.events} kinetic events in the approaches, no interdiction reporting` };
  if (read.analysis >= 2) return { state: "watching", confidence: 0.3, why: `${read.analysis} analysis pieces, no reported act or threat` };
  if (userHits >= 1) return { state: "watching", confidence: 0.45, why: "own sources only" };
  return { state: "dormant", confidence: 0, why: "nothing interdiction-shaped reported" };
}
