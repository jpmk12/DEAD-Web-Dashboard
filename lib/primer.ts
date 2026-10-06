// "Where to look first" — the ranked primer at the top of the OSINT command
// board. PURE, client-safe, unit-tested. DETERMINISTIC and free: it ranks rows
// the app already computes (the same inputs as the command board) and never
// calls a model; the "✦ Read (AI)" beside it spends a call only on tap.
//
// REVIEW-2026-10 §6 O5: the OE delta knew what changed, the demand horizon
// knew which command was rising, alerts knew what was red, and nothing
// composed them into "drill here first" with a DOOR to the place. Every item
// here carries one — the exact level (command › country › airfield / board)
// the board should open.
//
// Ranking (tiers; a ★ must-track outranks a non-★ at the same tier):
//   1  posture escalated today to RED
//   2  I&W board at ALERT
//   3  an airfield worse than yesterday with a RED LED, or any ★ field worse
//   4  I&W board at WARNING and deteriorating
//   5  demand likely to RISE against thin/critical crews
//   6  forming — convergence across ≥3 surfaces
//   7  I&W calls due for scoring
// A standing (chronic) RED is NOT a tier: a permanent condition is posture,
// not warning — the row itself carries it. The footer names the commands
// with nothing to say as "absence of signal, not evidence of calm" and any
// source that is down, so a short list never reads as a quiet world.

import { AOR_LABELS, type Aor } from "./aor";
import { escalatedToday, type CommandInput, type CbSitrep, type Led } from "./commandBoard";

export interface PrimerDoor {
  aor: Aor;
  country?: string;
  icao?: string;
  problemId?: string;
}

export interface PrimerItem {
  key: string;
  tier: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  star: boolean;
  tone: "red" | "amber" | "slate";
  /** The sentence, plain text (the UI bolds the subject). */
  text: string;
  /** Short subject for the bold lead — e.g. "CENTCOM › Jordan". */
  subject: string;
  /** "★ must-track" / "★ hub" / "not a must-track — consider ★". */
  note: string;
  door: PrimerDoor;
  doorLabel: string;
}

export interface PrimerConvergence { subject: string; breadth: number; kinds: string[]; aor: Aor | null; country?: string | null }
export interface PrimerDecision { problemId: string; label: string; aor: Aor | null; call: string; dueISO: string }

export interface PrimerInput extends CommandInput {
  convergence: PrimerConvergence[] | null;
  decisionsDue: PrimerDecision[] | null;
  /** Names of sources that did not answer (free text, from the assembler). */
  sourcesDown: string[];
}

export interface Primer {
  items: PrimerItem[];
  /** Commands with nothing elevated and nothing new. */
  quiet: Aor[];
  sourcesDown: string[];
  /** Calls due for scoring that did not make the list. */
  dueCount: number;
  footer: string;
}

export const PRIMER_MAX = 6;

const LED_RANK: Record<Led, number> = { g: 0, u: 1, a: 2, r: 3 };
const worstLed = (s: CbSitrep["status"]): Led => (Object.values(s) as Led[]).reduce((w, l) => (LED_RANK[l] > LED_RANK[w] ? l : w), "g");
const lc = (s: string) => s.trim().toLowerCase();

export function doorLabel(d: PrimerDoor): string {
  const parts = [d.aor as string];
  if (d.country) parts.push(d.country);
  if (d.icao) parts.push(d.icao);
  if (d.problemId && !d.country && !d.icao) parts.push("board");
  return `→ ${parts.join(" › ")}`;
}

export function primer(input: PrimerInput, max = PRIMER_MAX): Primer {
  const mt = input.mustTrack;
  const starAor = (a: Aor) => mt.aors.includes(a);
  const starCountry = (c: string) => mt.countries.some((x) => lc(x) === lc(c));
  const starIcao = (i: string) => mt.icaos.includes(i);
  const own = new Map(input.ownFields.map((f) => [f.icao, f]));
  const items: PrimerItem[] = [];
  const push = (it: Omit<PrimerItem, "doorLabel">) => items.push({ ...it, doorLabel: doorLabel(it.door) });
  const fieldNote = (icao: string, aor: Aor, country: string) => {
    const o = own.get(icao);
    if (o?.role === "hub") return "★ hub";
    if (starIcao(icao)) return "★ must-track";
    if (o?.role === "spoke") return "spoke";
    if (starCountry(country) || starAor(aor)) return `★ ${starCountry(country) ? country : aor}`;
    return "not a must-track — consider ★";
  };
  const aorNote = (aor: Aor, country?: string) =>
    country && starCountry(country) ? "★ must-track" : starAor(aor) ? "★ must-track" : "not a must-track — consider ★";

  // 1 — escalated today to RED (posture).
  for (const p of input.posture ?? []) {
    if (p.composite !== "red" || !escalatedToday(p)) continue;
    const star = starAor(p.aor) || starCountry(p.country) || (!!p.icao && starIcao(p.icao));
    const sitrep = p.icao ? (input.sitreps ?? []).find((s) => s.icao === p.icao) : null;
    const extra = sitrep && worstLed(sitrep.status) !== "g" ? `; ${sitrep.icao} SITREP ${sitrep.driver}` : "";
    push({
      key: `esc:${p.id}`, tier: 1, star, tone: "red",
      subject: `${p.aor} › ${p.country || p.label}`,
      text: `${p.kind === "base" ? `${p.label} ` : ""}posture went RED since your last look (was ${p.previousComposite}): ${p.topDriver}${extra}.`,
      note: p.icao ? fieldNote(p.icao, p.aor, p.country) : aorNote(p.aor, p.country),
      door: { aor: p.aor, country: p.country || undefined, icao: p.icao },
    });
  }

  // 2 — board at ALERT.
  for (const b of input.boards ?? []) {
    if (b.level !== "alert") continue;
    push({
      key: `alert:${b.problemId}`, tier: 2, star: starAor(b.aor), tone: "red",
      subject: b.label,
      text: `board is at ALERT (${b.anomaly >= 0 ? "+" : ""}${b.anomaly.toFixed(2)}, ${b.trajectory})${b.drivers.length ? ` — ${b.drivers.slice(0, 2).join("; ")}` : ""}.`,
      note: aorNote(b.aor),
      door: { aor: b.aor, problemId: b.problemId },
    });
  }

  // 3 — an airfield worse than yesterday: any field with a RED LED, or a ★ /
  //     own field at amber.
  for (const s of input.sitreps ?? []) {
    if (!s.worse.length) continue;
    const worst = worstLed(s.status);
    const mine = starIcao(s.icao) || own.has(s.icao);
    if (worst !== "r" && !(mine && worst === "a")) continue;
    push({
      key: `worse:${s.icao}`, tier: 3, star: mine, tone: worst === "r" ? "red" : "amber",
      subject: `${s.icao}${own.get(s.icao)?.role === "hub" ? " (your hub)" : ""}`,
      text: `${s.worse.join("/")} LED worse than yesterday — ${s.driver}.`,
      note: fieldNote(s.icao, s.aor, s.country),
      door: { aor: s.aor, country: s.country || undefined, icao: s.icao },
    });
  }

  // 4 — board at WARNING and deteriorating.
  for (const b of input.boards ?? []) {
    if (b.level !== "warning" || b.trajectory !== "deteriorating") continue;
    push({
      key: `warn:${b.problemId}`, tier: 4, star: starAor(b.aor), tone: "amber",
      subject: b.label,
      text: `board at WARNING and deteriorating (${b.anomaly >= 0 ? "+" : ""}${b.anomaly.toFixed(2)})${b.drivers.length ? ` — ${b.drivers[0]}` : ""}.`,
      note: aorNote(b.aor),
      door: { aor: b.aor, problemId: b.problemId },
    });
  }

  // 5 — demand rising against thin crews.
  for (const d of input.demand ?? []) {
    if (d.direction !== "rise" || !input.crewMismatchAors.includes(d.aor)) continue;
    push({
      key: `demand:${d.aor}`, tier: 5, star: starAor(d.aor), tone: "amber",
      subject: d.aor,
      text: `demand likely to RISE over 7 d (${d.score >= 0 ? "+" : ""}${d.score}, ${d.confidence} confidence) against thin crews.`,
      note: aorNote(d.aor),
      door: { aor: d.aor },
    });
  }

  // 6 — forming: convergence across ≥3 distinct surfaces.
  for (const c of input.convergence ?? []) {
    if (c.breadth < 3 || !c.aor) continue;
    push({
      key: `conv:${c.subject}`, tier: 6, star: starAor(c.aor) || (!!c.country && starCountry(c.country)), tone: "slate",
      subject: "Forming:",
      text: `"${c.subject}" converges across ${c.kinds.join(", ")} (breadth ${c.breadth}).`,
      note: aorNote(c.aor, c.country ?? undefined),
      door: { aor: c.aor, country: c.country ?? undefined },
    });
  }

  // 7 — calls due for scoring (one line per board).
  const dueByBoard = new Map<string, PrimerDecision>();
  for (const d of input.decisionsDue ?? []) if (!dueByBoard.has(d.problemId)) dueByBoard.set(d.problemId, d);
  for (const d of dueByBoard.values()) {
    if (!d.aor) continue;
    push({
      key: `due:${d.problemId}`, tier: 7, star: starAor(d.aor), tone: "slate",
      subject: d.label,
      text: `an I&W call ("${d.call}") is due for scoring — say right / wrong / ambiguous.`,
      note: aorNote(d.aor),
      door: { aor: d.aor, problemId: d.problemId },
    });
  }

  items.sort((a, b) => a.tier - b.tier || (b.star ? 1 : 0) - (a.star ? 1 : 0) || a.subject.localeCompare(b.subject));
  const kept = items.slice(0, max);

  // Quiet commands: no elevated posture, no board above calm, no base above
  // green, no change since the last look.
  const quiet: Aor[] = [];
  for (const aor of ["CENTCOM", "EUCOM", "INDOPACOM", "AFRICOM", "SOUTHCOM", "NORTHCOM"] as Aor[]) {
    const elevated =
      (input.posture ?? []).some((p) => p.aor === aor && (p.composite === "red" || p.composite === "amber"))
      || (input.boards ?? []).some((b) => b.aor === aor && b.level !== "calm")
      || (input.sitreps ?? []).some((s) => s.aor === aor && worstLed(s.status) !== "g")
      || (input.delta ?? []).some((d) => d.aor === aor)
      || kept.some((k) => k.door.aor === aor);
    if (!elevated) quiet.push(aor);
  }

  const dueCount = (input.decisionsDue ?? []).length;
  const parts: string[] = [];
  if (dueCount) parts.push(`${dueCount} I&W call${dueCount === 1 ? "" : "s"} due for scoring`);
  if (quiet.length) parts.push(`nothing changed in ${quiet.map((a) => AOR_LABELS[a].replace(/^US/, "")).join(", ")} (absence of signal, not evidence of calm)`);
  if (input.sourcesDown.length) parts.push(`${input.sourcesDown.length === 1 ? "one source" : `${input.sourcesDown.length} sources`} down: ${input.sourcesDown.join(", ")}`);
  if (!kept.length) parts.unshift("nothing to drill into first");

  return { items: kept, quiet, sourcesDown: input.sourcesDown, dueCount, footer: parts.join(" · ") };
}
