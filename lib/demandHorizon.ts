// The 7-day demand horizon — PURE, client-safe, unit-tested.
//
// The north star asks for "accurately predicting the needs of my forces". The
// app derives CURRENT mobility demand in several places (the AMC demand read,
// HADR scoring, the I&W divergence sensor) and projects nothing. This rolls
// the sensors the board already runs into one deterministic outlook per
// combatant command: demand likely to RISE / HOLD / FALL over the next seven
// days, with every driver listed and weighted. No model call — a forecast you
// cannot audit is not one you can brief.
//
// ── Discipline ────────────────────────────────────────────────────────────
// TRAJECTORY OVER LEVEL. A board at WARNING and improving contributes less
// than one at WATCH and deteriorating — the question is where demand is
// going, not where it is. Same for posture: an escalation today outweighs a
// standing red (a permanent condition is posture, not warning — the I&W
// rule, applied here).
//
// RECENCY DECAYS. A red HADR disaster three weeks old is a relief operation
// already under way, not an emerging airlift demand; an ordered departure
// declared last year is a standing posture, not a NEO in motion.
//
// CONFIDENCE IS SOURCE COUNT, not score size. One loud sensor is a lead; three
// independent ones agreeing is a forecast. Learning-mode boards contribute
// with a cap, exactly as their own level is capped.
//
// FALL IS A REAL ANSWER. Improving boards and de-escalations pull the score
// down; the outlook can say demand is likely to fall, which is the opening
// the crew-state model on the other side of the equation needs.

import type { Aor } from "./aor";
import type { WarningLevel, Trajectory } from "./warning";

export type DemandDirection = "rise" | "hold" | "fall";
export type DemandSource = "iw" | "disaster" | "neo" | "posture" | "chokepoint" | "move";

export interface DemandBoard { label: string; aor: Aor; level: WarningLevel; trajectory: Trajectory; learning: boolean }
export interface DemandDisaster { title: string; aor: Aor; severity: "red" | "orange" | "green" | "unknown"; hadrScore: number; timeISO: string; nearBase: boolean }
export interface DemandAdvisory { country: string; aor: Aor; ordered: boolean; authorized: boolean; pubDate: string }
export interface DemandPosture { label: string; aor: Aor; composite: string; escalated: boolean; chronic: boolean }
/** A force-posture move read from the reporting (lib/postureMoves). */
export interface DemandMove { headline: string; aor: Aor; kind: "deploy" | "surge" | "mobilize" | "reposition" | "exercise" | "withdraw"; actor: string; side: "us" | "ally" | "adversary" | "other"; pubDate: string; sources: number }
export interface DemandChokepoint { name: string; aor: Aor; score: number; acts: number; threats: number; /** AIS transit state when keyed. */ transit?: string }

export interface DemandInput {
  today: string;                 // yyyy-mm-dd
  /** AORs the user watches (from posture) — always get a row, even when quiet. */
  watchedAors: Aor[];
  boards: DemandBoard[];
  disasters: DemandDisaster[];
  advisories: DemandAdvisory[];
  posture: DemandPosture[];
  chokepoints: DemandChokepoint[];
  /** Posture moves in the reporting; absent when the sweep did not run. */
  moves?: DemandMove[];
}

export interface DemandDriver {
  source: DemandSource;
  text: string;
  delta: number;     // signed contribution
}

export interface DemandOutlook {
  aor: Aor;
  direction: DemandDirection;
  score: number;
  confidence: "low" | "medium" | "high";
  /** Distinct sources that contributed materially. */
  sources: number;
  drivers: DemandDriver[];   // by |delta| desc
  line: string;
}

export const HORIZON_DAYS = 7;
export const RISE_AT = 25;
export const FALL_AT = -15;
/** A driver below this magnitude does not count toward confidence. */
const MATERIAL = 8;
/** Learning-mode boards cannot push more than this. */
const LEARNING_CAP = 12;
/** Disasters cannot dominate an AOR on their own. */
const DISASTER_CAP = 45;
/** Reported posture moves cannot dominate an AOR on their own either — they
 *  are reporting, not observation. */
export const MOVE_CAP = 30;
/** Per-kind base for a corroborated move by the U.S. or an adversary; a
 *  withdrawal is demand FALLING (an opening), by half for a non-U.S. mover. */
const MOVE_BASE: Record<DemandMove["kind"], number> = { deploy: 14, surge: 14, mobilize: 12, reposition: 8, exercise: 4, withdraw: -8 };
const MOVE_SIDE: Record<DemandMove["side"], number> = { us: 1, adversary: 1, ally: 0.6, other: 0.5 };

const DAY = 86_400_000;
const daysAgo = (iso: string, todayMs: number): number | null => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, (todayMs - t) / DAY) : null;
};

const IW: Record<WarningLevel, Record<Trajectory, number>> = {
  alert:   { deteriorating: 45, stable: 35, improving: 15 },
  warning: { deteriorating: 35, stable: 25, improving: 8 },
  watch:   { deteriorating: 20, stable: 10, improving: -8 },
  calm:    { deteriorating: 8,  stable: 0,  improving: -10 },
};

export function demandHorizon(input: DemandInput): DemandOutlook[] {
  const todayMs = Date.parse(`${input.today}T00:00:00Z`) || Date.now();
  const byAor = new Map<Aor, DemandDriver[]>();
  const add = (aor: Aor, d: DemandDriver) => {
    if (d.delta === 0) return;
    (byAor.get(aor) ?? byAor.set(aor, []).get(aor)!).push(d);
  };

  // I&W boards — trajectory over level.
  for (const b of input.boards) {
    let delta = IW[b.level]?.[b.trajectory] ?? 0;
    let note = "";
    if (b.learning && delta > LEARNING_CAP) { delta = LEARNING_CAP; note = " (learning mode — capped)"; }
    add(b.aor, { source: "iw", delta, text: `I&W ${b.label} ${b.level.toUpperCase()}, ${b.trajectory}${note}` });
  }

  // Disasters — HADR relevance, decayed by age, capped per AOR.
  const disasterTotals = new Map<Aor, number>();
  const sortedDisasters = input.disasters.slice().sort((a, b) => b.hadrScore - a.hadrScore);
  for (const d of sortedDisasters) {
    const age = daysAgo(d.timeISO, todayMs);
    if (age === null) continue;
    let base = 0;
    if (d.severity === "red" && d.hadrScore >= 55) base = 22;
    else if (d.severity === "orange" && d.hadrScore >= 50) base = 12;
    else if (d.severity === "red") base = 8;
    if (base === 0) continue;
    const decay = age <= HORIZON_DAYS ? 1 : age <= 14 ? 0.5 : d.severity === "red" && d.hadrScore >= 55 ? 0.2 : 0;
    if (decay === 0) continue;
    let delta = Math.round(base * decay + (d.nearBase ? 5 : 0));
    const sofar = disasterTotals.get(d.aor) ?? 0;
    if (sofar >= DISASTER_CAP) continue;
    if (sofar + delta > DISASTER_CAP) delta = DISASTER_CAP - sofar;
    disasterTotals.set(d.aor, sofar + delta);
    const ageText = age < 1 ? "today" : `${Math.round(age)}d ago`;
    add(d.aor, { source: "disaster", delta, text: `${d.severity.toUpperCase()} ${d.title} — HADR ${d.hadrScore}, ${ageText}${d.nearBase ? ", near a watched base" : ""}` });
  }

  // NEO posture — recent declarations are demand; old ones are standing.
  for (const a of input.advisories) {
    if (!a.ordered && !a.authorized) continue;
    const age = daysAgo(a.pubDate, todayMs);
    const recent = age !== null && age <= 14;
    const delta = a.ordered ? (recent ? 28 : 6) : (recent ? 16 : 3);
    const kind = a.ordered ? "Ordered departure" : "Authorized departure";
    add(a.aor, { source: "neo", delta, text: `${kind} — ${a.country}${recent ? ` (${age! < 1 ? "today" : `${Math.round(age!)}d ago`})` : " (standing)"}` });
  }

  // Posture — escalation outweighs a standing red.
  for (const p of input.posture) {
    let delta = 0;
    if (p.composite === "red") delta = p.escalated ? 18 : p.chronic ? 5 : 10;
    else if (p.composite === "amber") delta = p.escalated ? 8 : 3;
    if (delta === 0) continue;
    const tag = p.escalated ? "escalated today" : p.chronic ? "chronic" : "standing";
    add(p.aor, { source: "posture", delta, text: `Posture ${p.label} ${p.composite.toUpperCase()} (${tag})` });
  }

  // Chokepoints — a declared act outranks a declared intention; suppressed
  // AIS traffic (what ships DO) adds on top, and on its own is a signal.
  for (const c of input.chokepoints) {
    let delta = 0;
    if (c.acts > 0 || c.score >= 60) delta = 18;
    else if (c.threats > 0 || c.score >= 30) delta = 9;
    const suppressed = c.transit === "suppressed";
    if (suppressed) delta += 8;
    if (delta === 0) continue;
    add(c.aor, { source: "chokepoint", delta, text: `${c.name} interdiction — ${c.acts} act${c.acts === 1 ? "" : "s"}, ${c.threats} threat${c.threats === 1 ? "" : "s"}${suppressed ? ", AIS traffic suppressed" : ""}` });
  }

  // Posture moves — reporting of forces moving, decayed by age, capped per
  // AOR. A single source is a lead (×0.6, said so); two or more corroborate.
  // A withdrawal pulls the score DOWN.
  const moveTotals = new Map<Aor, number>();
  for (const m of (input.moves ?? []).slice().sort((a, b) => b.sources - a.sources)) {
    const age = daysAgo(m.pubDate, todayMs);
    if (age === null) continue;
    const decay = age <= 2 ? 1 : age <= HORIZON_DAYS ? 0.6 : age <= 14 ? 0.25 : 0;
    if (decay === 0) continue;
    const corroborated = m.sources >= 2;
    let delta = Math.round(MOVE_BASE[m.kind] * MOVE_SIDE[m.side] * decay * (corroborated ? 1 : 0.6));
    if (delta === 0) continue;
    const sofar = moveTotals.get(m.aor) ?? 0;
    if (Math.abs(sofar) >= MOVE_CAP) continue;
    if (Math.abs(sofar + delta) > MOVE_CAP) delta = Math.sign(delta) * (MOVE_CAP - Math.abs(sofar));
    if (delta === 0) continue;
    moveTotals.set(m.aor, sofar + delta);
    const ageText = age < 1 ? "today" : `${Math.round(age)}d ago`;
    add(m.aor, { source: "move", delta, text: `Posture move — ${m.actor} ${m.kind}: ${m.headline} (${ageText}${corroborated ? `, ${m.sources} sources` : ", single source"})` });
  }

  // One row per watched AOR plus any AOR with drivers; UNKNOWN only if driven.
  const aors = new Set<Aor>(input.watchedAors.filter((a) => a !== "UNKNOWN"));
  for (const a of byAor.keys()) aors.add(a);

  const out: DemandOutlook[] = [];
  for (const aor of aors) {
    const drivers = (byAor.get(aor) ?? []).slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const score = drivers.reduce((s, d) => s + d.delta, 0);
    const sources = new Set(drivers.filter((d) => Math.abs(d.delta) >= MATERIAL).map((d) => d.source)).size;
    const direction: DemandDirection = score >= RISE_AT ? "rise" : score <= FALL_AT ? "fall" : "hold";
    const confidence = drivers.length === 0 ? "low" : sources >= 3 ? "high" : sources === 2 ? "medium" : "low";
    const lead = drivers.slice(0, 3).map((d) => d.text).join("; ");
    const line = drivers.length === 0
      ? `${aor}: no demand signals on the board — HOLD (low confidence; absence of signal, not evidence of calm)`
      : `${aor}: demand likely to ${direction.toUpperCase()} over ${HORIZON_DAYS} days (${score >= 0 ? "+" : ""}${score}, ${confidence} confidence) — ${lead}`;
    out.push({ aor, direction, score, confidence, sources, drivers, line });
  }

  out.sort((a, b) => b.score - a.score || a.aor.localeCompare(b.aor));
  return out;
}
