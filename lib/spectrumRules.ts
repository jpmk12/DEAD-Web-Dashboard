// The spectrum state ladders — PNT denial, cyber pressure, space activity,
// edge exposure. PURE, client-safe, unit-tested. The tunable judgements
// live here, not inline in the sensors (the warningRules discipline).
//
// Through-line, same as every other indicator: BOTH halves of a signal are
// baseline- or recency-relative. A permanent condition is posture, not
// warning; an unreachable sensor is UNKNOWN, never clear; own-source-only
// caps at watching; and space weather never raises a level — it GUARDS the
// attribution of a PNT anomaly.

import type { ObservedState } from "./warning";
import { instrumentState, type GradedEvidence } from "./economicWarfare";
import type { KevHit } from "./cyberSignals";
import type { Led } from "./sitrepSignals";

export interface StateRead { state: ObservedState; confidence: number; why: string }

const RANK: Record<ObservedState, number> = { dormant: 0, watching: 1, active: 2, confirmed: 3 };
const worseOf = (a: StateRead, b: StateRead): StateRead => (RANK[b.state] > RANK[a.state] ? b : a);
const cap = (s: StateRead, at: ObservedState, why: string): StateRead => (RANK[s.state] > RANK[at] ? { state: at, confidence: Math.min(s.confidence, 0.5), why: `${s.why} — ${why}` } : s);

// ───────────────────────────── PNT denial ─────────────────────────────

export interface PntInputs {
  /** GPSJam reachable this cycle. */
  cellsLive: boolean;
  /** Elevated cells inside the AOI bbox (level-2 cells counted twice). */
  cells: number;
  /** Own trailing baseline of that count. */
  baseline: { mean: number | null; samples: number };
  /** AOI hubs that sit inside an elevated cell. */
  hubHits: number;
  /** DAIP GPS/WAAS system NOTAMs naming the AOI (null = DAIP unreachable). */
  gpsNotams: number | null;
  /** RAIM outage NOTAMs at AOI hubs. */
  raimNotams: number;
  /** SWPC G3+ in effect — attribute to the environment first. */
  stormGuard: boolean;
}

/** Samples below this keep the density half in learning mode. */
export const PNT_LEARNING_SAMPLES = 7;

export function pntState(i: PntInputs): StateRead | null {
  if (!i.cellsLive && i.gpsNotams == null) return null;   // nothing observed — UNKNOWN
  let s: StateRead = { state: "dormant", confidence: 0, why: "no interference reported over the AOI" };

  if (i.cellsLive) {
    const learning = i.baseline.mean == null || i.baseline.samples < PNT_LEARNING_SAMPLES;
    const mean = i.baseline.mean ?? 0;
    const surge = !learning && i.cells > Math.max(mean * 1.5, mean + 4);
    if (i.hubHits > 0) {
      s = worseOf(s, { state: "active", confidence: 0.75, why: `${i.hubHits} AOI hub${i.hubHits === 1 ? "" : "s"} inside an elevated GPS-interference cell` });
    }
    if (surge) {
      s = worseOf(s, { state: "active", confidence: 0.7, why: `${i.cells} elevated cells vs ~${mean.toFixed(0)} baseline over ${i.baseline.samples}d` });
    } else if (i.cells > 0) {
      s = worseOf(s, { state: "watching", confidence: learning ? 0.4 : 0.45, why: learning ? `${i.cells} elevated cells, baseline forming (${i.baseline.samples}/${PNT_LEARNING_SAMPLES} days)` : `${i.cells} elevated cells, within baseline (~${mean.toFixed(0)})` });
    }
  }
  if (i.gpsNotams != null && i.gpsNotams > 0) {
    s = worseOf(s, { state: i.gpsNotams >= 3 ? "active" : "watching", confidence: 0.6, why: `${i.gpsNotams} GPS/WAAS NOTAM${i.gpsNotams === 1 ? "" : "s"} over the AOI` });
  }
  if (i.raimNotams > 0) {
    s = worseOf(s, { state: "watching", confidence: 0.5, why: `${i.raimNotams} RAIM outage NOTAM${i.raimNotams === 1 ? "" : "s"} at AOI hubs` });
  }
  // The guard: during a G3+ storm the ionosphere degrades GPS everywhere;
  // a jamming read cannot pass watching until the storm clears.
  if (i.stormGuard) s = cap(s, "watching", "G3+ geomagnetic storm in effect, attributed to environment first");
  return s;
}

// ───────────────────────────── cyber pressure ─────────────────────────────

export interface CyberInputs {
  /** IODA reachable this cycle. */
  outagesLive: boolean;
  /** Country-level outage alerts in AOI countries (24 h). */
  outages: { country: string; level: string }[];
  /** ransomware.live reachable. */
  victimsLive: boolean;
  /** Relevant victims in the window. */
  victims: number;
  /** Own trailing baseline of that count. */
  victimsBaseline: { mean: number | null; samples: number };
  /** Graded cyber texts attributed BY the actor. */
  actsBy: GradedEvidence[];
  /** CISA advisories naming a state actor tied to the AOI, 14 d. */
  advisories: number;
}

export const CYBER_LEARNING_SAMPLES = 5;

export function cyberState(i: CyberInputs): StateRead | null {
  const anyLive = i.outagesLive || i.victimsLive || i.actsBy.length > 0 || i.advisories > 0;
  if (!anyLive) return null;
  // Graded text through the same ladder as every economic instrument
  // (wire act → active, confirmed with ≥2 sources or own agreement; own-only
  // caps at watching).
  let s: StateRead = i.actsBy.length ? instrumentState(i.actsBy) : { state: "dormant", confidence: 0, why: "no attributed cyber act reported" };
  if (s.state === "dormant" && !i.actsBy.length) s.why = "no attributed cyber act reported";

  // A CISA/JCDC advisory naming the state actor is a primary record — an
  // act by the actor with the standing of a Federal Register document.
  if (i.advisories > 0) {
    const adv: StateRead = { state: "active", confidence: 0.8, why: `${i.advisories} CISA advisor${i.advisories === 1 ? "y" : "ies"} naming the actor in 14d` };
    s = RANK[s.state] >= RANK.active
      ? { state: "confirmed", confidence: 0.85, why: `${s.why}; ${adv.why}` }
      : worseOf(s, adv);
  }

  // Outage alerts corroborate and can trip a watch alone.
  const critical = i.outages.filter((o) => o.level === "critical");
  if (i.outages.length) {
    const line = `${critical.length ? `${critical.length} critical` : `${i.outages.length}`} connectivity outage alert${i.outages.length === 1 ? "" : "s"} (${i.outages.map((o) => o.country).join(", ")})`;
    if (RANK[s.state] >= RANK.active) s = { state: s.state, confidence: Math.min(0.9, s.confidence + 0.05), why: `${s.why}; corroborated by ${line}` };
    else s = worseOf(s, { state: "watching", confidence: critical.length ? 0.55 : 0.45, why: line });
  }

  // Victims vs the AOI's own baseline; learning until enough samples.
  if (i.victimsLive) {
    const learning = i.victimsBaseline.mean == null || i.victimsBaseline.samples < CYBER_LEARNING_SAMPLES;
    const mean = i.victimsBaseline.mean ?? 0;
    if (!learning && i.victims > Math.max(mean * 1.5, mean + 3)) {
      s = worseOf(s, { state: "watching", confidence: 0.5, why: `${i.victims} ransomware victims vs ~${mean.toFixed(0)} baseline` });
    }
  }
  return s;
}

// ───────────────────────────── space activity ─────────────────────────────

export interface SpaceInputs {
  live: boolean;
  last14: number;
  per14: number | null;
  next14: number;
  conjunctions: number;
}

export function spaceActivityState(i: SpaceInputs): StateRead | null {
  if (!i.live) return null;
  let s: StateRead = { state: "dormant", confidence: 0, why: "launch cadence within the actor's own norm" };
  if (i.conjunctions > 0) {
    s = worseOf(s, { state: "active", confidence: 0.7, why: `${i.conjunctions} close conjunction${i.conjunctions === 1 ? "" : "s"} involving a U.S. military payload` });
  }
  if (i.per14 == null) {
    if (i.last14 > 0) s = worseOf(s, { state: "watching", confidence: 0.4, why: `${i.last14} launch${i.last14 === 1 ? "" : "es"} in 14d, cadence baseline forming` });
  } else if (i.last14 > Math.max(i.per14 * 1.5, i.per14 + 2)) {
    s = worseOf(s, { state: "active", confidence: 0.65, why: `${i.last14} launches in 14d vs ~${i.per14.toFixed(1)} cadence` });
  } else if (i.last14 > i.per14 + 0.5) {
    s = worseOf(s, { state: "watching", confidence: 0.45, why: `${i.last14} launches in 14d, above ~${i.per14.toFixed(1)} cadence` });
  }
  if (i.next14 >= 3 && s.state === "dormant") {
    s = { state: "watching", confidence: 0.35, why: `${i.next14} launches scheduled in the next 14d` };
  }
  return s;
}

// ───────────────────────────── edge exposure (KEV × vendors) ─────────────────────────────

/** UNKNOWN when nothing is declared (not green — the absence of a list is
 *  not the absence of exposure); red only when an exploited entry on a
 *  declared vendor is in known ransomware use. */
export function edgeExposureLed(hits: KevHit[], declared: boolean, live: boolean): Led {
  if (!declared) return "u";
  if (!live) return "u";
  if (hits.some((h) => h.entry.knownRansomwareCampaignUse)) return "r";
  if (hits.length) return "a";
  return "g";
}

/** Indicator state → the LED the tiles and cards use. Confirmed earns red
 *  (an attributed, corroborated act); active and watching are amber. */
export function stateLed(s: ObservedState | null | undefined): Led {
  if (!s) return "u";
  return s === "confirmed" ? "r" : s === "active" || s === "watching" ? "a" : "g";
}

export const LED_RANK: Record<Led, number> = { u: 0, g: 1, a: 2, r: 3 };
export const worstLed = (...leds: Led[]): Led => leds.reduce((w, l) => (LED_RANK[l] > LED_RANK[w] ? l : w), "u" as Led);
