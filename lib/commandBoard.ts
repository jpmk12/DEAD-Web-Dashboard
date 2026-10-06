// The command board — one row per combatant command, PURE and unit-tested.
//
// REVIEW-2026-10 §6: four surfaces grouped by command on their own (posture
// by `cocom`, the events list by `aor`, the Regional rail by COCOM, the demand
// horizon one row per AOR) and the I&W boards carried the command only inside
// their label. Nothing answered "what is going on in CENTCOM" in one place.
// This is that answer: a join over the rows the app already computes — force
// posture, I&W assessments, SITREP summaries, demand outlooks, events, the
// per-user delta, alerts — into one `CommandRow` per AOR, each with a WHY, and
// a `CommandDetail` beneath it (boards → countries → airfields) so the UI can
// drill in place without a second join.
//
// Disciplines carried over from the surfaces it reads:
//   • UNKNOWN ≠ clear — a dead feed is counted as unknown, never folded into
//     green; a command with no board says "no board", not "calm".
//   • Colour is earned — `worst` is the real worst level, no rounding up.
//   • ★ orders and pins, never adds — a ★ country with no posture row is
//     shown with `posture: null` and the row says it is unwatched.
//   • The server does the gathering (lib/commandsAssemble.ts); every input
//     here is a plain row so the join is testable without a database.

import { AOR_LABELS, type Aor } from "./aor";
import { SEVERITY_RANK, worstOf, type Severity } from "./severity";
import { isStarCountry, type MustTrack } from "./missionProfile";

export const COMMANDS: Aor[] = ["CENTCOM", "EUCOM", "INDOPACOM", "AFRICOM", "SOUTHCOM", "NORTHCOM"];

export type IwLevel = "calm" | "watch" | "warning" | "alert";
export type Led = "g" | "a" | "r" | "u";

/** One force-posture assessment (country watch or pinned base). */
export interface CbPosture {
  id: string;
  label: string;
  kind: "country" | "base";
  country: string;
  aor: Aor;
  icao?: string;
  lat: number;
  lon: number;
  composite: Severity;
  /** Prior day's composite, only when it changed today (= escalated/eased). */
  previousComposite?: Severity | null;
  chronicity?: string | null;        // new | recurring | chronic | improving | unknown
  topDriver: string;
}

export interface CbBoard {
  problemId: string;
  label: string;
  aor: Aor;
  level: IwLevel;
  anomaly: number;
  trajectory: "deteriorating" | "improving" | "stable";
  learning: boolean;
  drivers: string[];
}

export interface CbSitrep {
  icao: string;
  label: string;
  country: string;
  aor: Aor;
  status: { wx: Led; ops: Led; threat: Led; infra: Led; spectrum: Led };
  driver: string;
  worse: string[];
}

export interface CbDemand { aor: Aor; direction: "rise" | "hold" | "fall"; score: number; confidence: "low" | "medium" | "high"; line: string }

export interface CbEvent {
  id: string;
  kind: "kinetic" | "disaster" | "neo" | "weather";
  title: string;
  aor: Aor;
  country?: string;
  severity: "red" | "amber" | "sky";
  timeISO: string | null;
  lat?: number | null;
  lon?: number | null;
}

/** A net transition since the user's last look (lib/oeDelta), with the AOR
 *  the assembler joined on (null when the subject has no command). */
export interface CbDelta {
  kind: "posture" | "sitrep" | "iw";
  id: string;
  label: string;
  axis?: string;
  from: string | null;
  to: string;
  direction: "worse" | "better" | "new";
  aor: Aor | null;
  country?: string | null;
  icao?: string | null;
}

export interface CbAlert { id: string; severity: "red" | "amber"; kind: string; title: string; sub: string; aor: Aor | null }

/** A declared own-force airfield (hub or spoke) for the My airfields strip. */
export interface CbOwnField { icao: string; label: string; role: "hub" | "spoke"; country: string; lat: number; lon: number }

export interface CommandInput {
  nowMs: number;
  /** The user's last look at the OSINT tab (ms), 0 = none recorded. */
  sinceMs: number;
  mustTrack: MustTrack;
  ownFields: CbOwnField[];
  posture: CbPosture[] | null;       // null = feed unavailable
  boards: CbBoard[] | null;
  sitreps: CbSitrep[] | null;
  demand: CbDemand[] | null;
  events: CbEvent[] | null;
  delta: CbDelta[] | null;
  alerts: CbAlert[] | null;
  /** Commands where demand is rising against thin/critical crews. */
  crewMismatchAors: Aor[];
  /** AOR per ★ country (lower-cased name), classified by the assembler, so a
   *  ★ country with no posture row still lands under its command. */
  countryAors?: Record<string, Aor>;
}

export interface CommandRow {
  aor: Aor;
  label: string;
  star: boolean;
  /** Worst board on the command; null = no board declared here. */
  iw: { level: IwLevel; anomaly: number; trajectory: CbBoard["trajectory"]; boards: number; learning: boolean; worstLabel: string } | null;
  posture: { red: number; amber: number; green: number; unknown: number; escalated: number; worst: Severity | null; watched: number };
  bases: { count: number; red: number; amber: number; worse: number; worst: Led | null };
  demand: CbDemand | null;
  events: { total: number; kinetic: number; neo: number; disaster: number; fresh: number };
  delta: { worse: number; better: number; fresh: number };
  alerts: number;
  /** One line that explains the row's colour. */
  why: string;
  /** Nothing watched, no board, no events — folds into the "other commands" line unless ★. */
  quiet: boolean;
  /** Sort key (higher first). ★ dominates. */
  score: number;
}

export interface FieldRow {
  icao: string;
  label: string;
  country: string;
  aor: Aor;
  star: boolean;
  role: "hub" | "spoke" | null;
  posture: CbPosture | null;
  sitrep: CbSitrep | null;
  /** True when this field holds a full-SITREP slot. */
  hasSitrep: boolean;
}

export interface CountryRow {
  country: string;
  aor: Aor;
  star: boolean;
  /** The country watch itself, when one exists. */
  posture: CbPosture | null;
  /** Worst composite across the country row and its bases; null when nothing is watched. */
  worst: Severity | null;
  escalated: boolean;
  chronicity: string | null;
  topDriver: string;
  fields: FieldRow[];
  delta: { worse: number; better: number };
  events: number;
  /** Nothing in the posture watch — a ★ or a SITREP base put it here. */
  unwatched: boolean;
}

export interface CommandDetail {
  aor: Aor;
  boards: CbBoard[];
  countries: CountryRow[];
  events: CbEvent[];
  deltas: CbDelta[];
}

export interface CommandBoard {
  rows: CommandRow[];
  details: Record<string, CommandDetail>;
  /** The pinned strip: hub, spokes, ★ fields — in that order, deduped. */
  myFields: FieldRow[];
  /** Feeds that answered this pass. */
  sources: { posture: boolean; boards: boolean; sitreps: boolean; demand: boolean; events: boolean; delta: boolean; alerts: boolean };
}

const IW_RANK: Record<IwLevel, number> = { calm: 0, watch: 1, warning: 2, alert: 3 };
const LED_RANK: Record<Led, number> = { g: 0, u: 1, a: 2, r: 3 };
const SEV_WEIGHT: Record<Severity, number> = { green: 0, unknown: 1, amber: 2, red: 3 };

const lc = (s: string) => s.trim().toLowerCase();

export function isElevated(s: Severity | null | undefined): boolean { return s === "red" || s === "amber"; }

/** Escalated today = the composite changed and got worse. */
export function escalatedToday(p: Pick<CbPosture, "composite" | "previousComposite">): boolean {
  return !!p.previousComposite && SEVERITY_RANK[p.composite] > SEVERITY_RANK[p.previousComposite];
}

function worstLed(s: CbSitrep["status"]): Led {
  return (Object.values(s) as Led[]).reduce((w, l) => (LED_RANK[l] > LED_RANK[w] ? l : w), "g");
}

function worstBoard(boards: CbBoard[]): CbBoard | null {
  if (!boards.length) return null;
  return boards.slice().sort((a, b) =>
    IW_RANK[b.level] - IW_RANK[a.level]
    || (b.trajectory === "deteriorating" ? 1 : 0) - (a.trajectory === "deteriorating" ? 1 : 0)
    || b.anomaly - a.anomaly)[0];
}

/** Sort: ★ first, then worst composite, then escalated, then label. */
export function byCountryPriority(a: CountryRow, b: CountryRow): number {
  return (b.star ? 1 : 0) - (a.star ? 1 : 0)
    || SEV_WEIGHT[b.worst ?? "green"] - SEV_WEIGHT[a.worst ?? "green"]
    || (b.escalated ? 1 : 0) - (a.escalated ? 1 : 0)
    || b.events - a.events
    || a.country.localeCompare(b.country);
}

function fieldRow(
  icao: string, label: string, country: string, aor: Aor,
  mt: MustTrack, own: CbOwnField | undefined, posture: CbPosture | null, sitrep: CbSitrep | null,
): FieldRow {
  return {
    icao, label, country, aor,
    star: mt.icaos.includes(icao),
    role: own?.role ?? null,
    posture, sitrep, hasSitrep: !!sitrep,
  };
}

export function commandBoard(input: CommandInput): CommandBoard {
  const mt = input.mustTrack;
  const posture = input.posture ?? [];
  const boards = input.boards ?? [];
  const sitreps = input.sitreps ?? [];
  const demand = input.demand ?? [];
  const events = input.events ?? [];
  const deltas = input.delta ?? [];
  const alerts = input.alerts ?? [];
  const own = new Map(input.ownFields.map((f) => [f.icao, f]));
  const baseByIcao = new Map(posture.filter((p) => p.kind === "base" && p.icao).map((p) => [p.icao as string, p]));
  const sitrepByIcao = new Map(sitreps.map((s) => [s.icao, s]));

  const isFresh = (t: string | null) => !!t && input.sinceMs > 0 && Date.parse(t) > input.sinceMs;

  const rows: CommandRow[] = [];
  const details: Record<string, CommandDetail> = {};

  for (const aor of COMMANDS) {
    const star = mt.aors.includes(aor);
    const pAor = posture.filter((p) => p.aor === aor);
    const bAor = boards.filter((b) => b.aor === aor);
    const sAor = sitreps.filter((s) => s.aor === aor);
    const eAor = events.filter((e) => e.aor === aor);
    const dAor = deltas.filter((d) => d.aor === aor);
    const alAor = alerts.filter((a) => a.aor === aor);
    const dem = demand.find((d) => d.aor === aor) ?? null;

    // ── Posture tally ──
    const tally = { red: 0, amber: 0, green: 0, unknown: 0 };
    let escalated = 0;
    for (const p of pAor) { tally[p.composite] += 1; if (escalatedToday(p)) escalated += 1; }
    const worstPosture = pAor.length ? worstOf(pAor.map((p) => p.composite)) : null;

    // ── Boards ──
    const wb = worstBoard(bAor);
    const iw = wb ? { level: wb.level, anomaly: wb.anomaly, trajectory: wb.trajectory, boards: bAor.length, learning: wb.learning, worstLabel: wb.label } : null;

    // ── Bases ──
    const basesWorst = sAor.length ? sAor.map((s) => worstLed(s.status)).reduce((w, l) => (LED_RANK[l] > LED_RANK[w] ? l : w), "g" as Led) : null;
    const bases = {
      count: sAor.length,
      red: sAor.filter((s) => worstLed(s.status) === "r").length,
      amber: sAor.filter((s) => worstLed(s.status) === "a").length,
      worse: sAor.filter((s) => s.worse.length > 0).length,
      worst: basesWorst,
    };

    // ── Events ──
    const ev = {
      total: eAor.length,
      kinetic: eAor.filter((e) => e.kind === "kinetic").length,
      neo: eAor.filter((e) => e.kind === "neo").length,
      disaster: eAor.filter((e) => e.kind === "disaster").length,
      fresh: eAor.filter((e) => isFresh(e.timeISO)).length,
    };

    const delta = {
      worse: dAor.filter((d) => d.direction === "worse").length,
      better: dAor.filter((d) => d.direction === "better").length,
      fresh: dAor.filter((d) => d.direction === "new").length,
    };

    // ── WHY — the row's colour explains itself, worst thing first ──
    const why: string[] = [];
    const escal = pAor.filter(escalatedToday).sort((a, b) => SEV_WEIGHT[b.composite] - SEV_WEIGHT[a.composite])[0];
    if (escal) why.push(`${escal.label} ${escal.composite.toUpperCase()} (escalated)`);
    if (wb && wb.level !== "calm") why.push(`${wb.label.split("·").pop()?.trim() ?? wb.label} board ${wb.level.toUpperCase()} ${wb.trajectory === "deteriorating" ? "↗" : wb.trajectory === "improving" ? "↘" : "→"}`);
    else if (wb?.learning) why.push("board learning — baseline forming");
    const redBases = sAor.filter((s) => worstLed(s.status) === "r");
    const worseBases = sAor.filter((s) => s.worse.length > 0);
    if (redBases.length) why.push(`${redBases.map((s) => s.icao).join("/")} RED`);
    else if (worseBases.length) why.push(`${worseBases.map((s) => s.icao).join("/")} worse than yesterday`);
    if (!escal && worstPosture === "red") {
      const r = pAor.find((p) => p.composite === "red");
      if (r) why.push(`${r.label} RED${r.chronicity === "chronic" ? " (chronic)" : ""}`);
    }
    if (dem?.direction === "rise") why.push(`demand likely to RISE${input.crewMismatchAors.includes(aor) ? " vs thin crews" : ""}`);
    else if (dem?.direction === "fall") why.push("demand likely to FALL");
    if (ev.neo) why.push(`${ev.neo} departure advisor${ev.neo === 1 ? "y" : "ies"}`);
    if (!why.length) {
      if (pAor.length === 0 && bAor.length === 0 && sAor.length === 0) why.push(ev.total ? `${ev.total} event${ev.total === 1 ? "" : "s"} · nothing watched here` : "nothing watched here — absence of signal, not evidence of calm");
      else if (tally.unknown && !tally.red && !tally.amber) why.push(`${tally.unknown} UNKNOWN — a feed is down, not a quiet picture`);
      else why.push(`${pAor.length} watched · ${bAor.length} board${bAor.length === 1 ? "" : "s"} · ${sAor.length} base${sAor.length === 1 ? "" : "s"} · nothing elevated`);
    }

    const quiet = !star && pAor.length === 0 && bAor.length === 0 && sAor.length === 0;

    const score =
      (star ? 100 : 0)
      + (wb ? IW_RANK[wb.level] * 10 + (wb.trajectory === "deteriorating" ? 3 : 0) : 0)
      + (worstPosture ? SEV_WEIGHT[worstPosture] * 4 : 0)
      + escalated * 5
      + (basesWorst ? LED_RANK[basesWorst] * 3 : 0)
      + bases.worse * 2
      + delta.worse * 3
      + (dem?.direction === "rise" ? 2 : 0)
      + Math.min(ev.total, 5)
      + alAor.length * 2;

    rows.push({
      aor, label: AOR_LABELS[aor], star, iw,
      posture: { ...tally, escalated, worst: worstPosture, watched: pAor.length },
      bases, demand: dem, events: ev, delta, alerts: alAor.length,
      why: why.slice(0, 3).join(" · "), quiet, score,
    });

    // ── Detail: countries → fields ──
    const countryMap = new Map<string, CountryRow>();
    const ensure = (country: string): CountryRow => {
      const k = lc(country);
      let c = countryMap.get(k);
      if (!c) {
        c = {
          country, aor, star: isStarCountry(mt, country), posture: null, worst: null, escalated: false,
          chronicity: null, topDriver: "", fields: [], delta: { worse: 0, better: 0 }, events: 0, unwatched: true,
        };
        countryMap.set(k, c);
      }
      return c;
    };
    const addField = (c: CountryRow, f: FieldRow) => { if (!c.fields.some((x) => x.icao === f.icao)) c.fields.push(f); };

    for (const p of pAor) {
      if (!p.country) continue;
      const c = ensure(p.country);
      c.unwatched = false;
      if (p.kind === "country") {
        c.posture = p;
        c.chronicity = p.chronicity ?? null;
        c.topDriver = p.topDriver;
        if (escalatedToday(p)) c.escalated = true;
      } else if (p.icao) {
        addField(c, fieldRow(p.icao, p.label, p.country, aor, mt, own.get(p.icao), p, sitrepByIcao.get(p.icao) ?? null));
        if (escalatedToday(p)) c.escalated = true;
        if (!c.topDriver || (c.posture == null && SEV_WEIGHT[p.composite] >= 2)) c.topDriver = c.topDriver || `${p.label}: ${p.topDriver}`;
      }
    }
    for (const s of sAor) {
      if (!s.country) continue;
      const c = ensure(s.country);
      addField(c, fieldRow(s.icao, s.label, s.country, aor, mt, own.get(s.icao), baseByIcao.get(s.icao) ?? null, s));
    }
    for (const f of input.ownFields) {
      if (!f.country) continue;
      const fAor = baseByIcao.get(f.icao)?.aor ?? sitrepByIcao.get(f.icao)?.aor ?? null;
      if (fAor !== aor) continue;
      const c = ensure(f.country);
      addField(c, fieldRow(f.icao, f.label, f.country, aor, mt, f, baseByIcao.get(f.icao) ?? null, sitrepByIcao.get(f.icao) ?? null));
    }
    // ★ countries declared for this command with nothing watched: present, flagged.
    for (const name of mt.countries) {
      const guess = pAor.find((p) => lc(p.country) === lc(name));
      if (guess || countryMap.has(lc(name))) continue;
      if ((input.countryAors?.[lc(name)] ?? countryAor(name, posture)) === aor) ensure(name);
    }
    for (const c of countryMap.values()) {
      const comps = [...(c.posture ? [c.posture.composite] : []), ...c.fields.map((f) => f.posture?.composite).filter((x): x is Severity => !!x)];
      c.worst = comps.length ? worstOf(comps) : null;
      if (!c.topDriver) {
        const f = c.fields.find((x) => x.sitrep && worstLed(x.sitrep.status) !== "g");
        c.topDriver = f?.sitrep ? `${f.icao}: ${f.sitrep.driver}` : c.fields[0]?.posture?.topDriver ?? (c.unwatched ? "not in the posture watch — add it under Force posture" : "");
      }
      c.delta = {
        worse: dAor.filter((d) => d.direction === "worse" && (lc(d.country ?? "") === lc(c.country) || c.fields.some((f) => f.icao === d.icao))).length,
        better: dAor.filter((d) => d.direction === "better" && (lc(d.country ?? "") === lc(c.country) || c.fields.some((f) => f.icao === d.icao))).length,
      };
      c.events = eAor.filter((e) => e.country && lc(e.country) === lc(c.country)).length;
      c.fields.sort((a, b) =>
        (b.star ? 1 : 0) - (a.star ? 1 : 0)
        || (a.role === "hub" ? -1 : 0) - (b.role === "hub" ? -1 : 0)
        || (b.hasSitrep ? 1 : 0) - (a.hasSitrep ? 1 : 0)
        || SEV_WEIGHT[b.posture?.composite ?? "green"] - SEV_WEIGHT[a.posture?.composite ?? "green"]
        || a.icao.localeCompare(b.icao));
    }

    details[aor] = {
      aor, boards: bAor.slice().sort((a, b) => IW_RANK[b.level] - IW_RANK[a.level] || b.anomaly - a.anomaly),
      countries: [...countryMap.values()].sort(byCountryPriority),
      events: eAor, deltas: dAor,
    };
  }

  rows.sort((a, b) => b.score - a.score || a.aor.localeCompare(b.aor));

  // My airfields: hub, spokes, then ★ fields — one row each, wherever they sit.
  const myFields: FieldRow[] = [];
  const pushMine = (icao: string) => {
    if (myFields.some((f) => f.icao === icao)) return;
    const o = own.get(icao);
    const p = baseByIcao.get(icao) ?? null;
    const s = sitrepByIcao.get(icao) ?? null;
    const label = o?.label ?? p?.label ?? s?.label ?? icao;
    const country = o?.country ?? p?.country ?? s?.country ?? "";
    const aor = p?.aor ?? s?.aor ?? "UNKNOWN";
    myFields.push(fieldRow(icao, label, country, aor, mt, o, p, s));
  };
  for (const f of input.ownFields.filter((x) => x.role === "hub")) pushMine(f.icao);
  for (const f of input.ownFields.filter((x) => x.role === "spoke")) pushMine(f.icao);
  for (const icao of mt.icaos) pushMine(icao);

  return {
    rows, details, myFields,
    sources: {
      posture: input.posture !== null, boards: input.boards !== null, sitreps: input.sitreps !== null,
      demand: input.demand !== null, events: input.events !== null, delta: input.delta !== null, alerts: input.alerts !== null,
    },
  };
}

/** The AOR a country name belongs to, from the posture rows that name it,
 *  else UNKNOWN — the assembler passes a classifier-backed hint through the
 *  posture rows, so this never guesses from text here. */
export function countryAor(name: string, posture: CbPosture[]): Aor {
  const hit = posture.find((p) => lc(p.country) === lc(name));
  return hit?.aor ?? "UNKNOWN";
}
