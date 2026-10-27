// The line read — PURE, client-safe, tested (docs/PLAN-MISSION-OBJECT.md §4).
//
// One line in, one LineRead out: what the app already knows about each
// field on the line, on that day, ranked. Every input is a reading the app
// already holds (SITREP LEDs and closure state, force posture, the TAF turn,
// runway capability); nothing here fetches, nothing calls a model, and a
// line NEVER changes a level — a line through a red field is a red LINE
// READ, not a redder field. UNKNOWN is a value: a field with no SITREP slot,
// a dead source, a field the app cannot place all read "u" and say why.

import type { LineAirframe, LineStatus } from "./missionLines";
import { lineDayLabel, lineLabel, runwayClassFor } from "./missionLines";
import type { Aor } from "./aor";

export type LineLed = "g" | "a" | "r" | "u";
export interface LineLeds { wx: LineLed; ops: LineLed; threat: LineLed; infra: LineLed; spectrum: LineLed }
const RANK: Record<LineLed, number> = { g: 0, u: 1, a: 2, r: 3 };
export const worstLineLed = (...leds: LineLed[]): LineLed => leds.reduce((w, l) => (RANK[l] > RANK[w] ? l : w), "g" as LineLed);

export interface LineFieldInput {
  icao: string;
  /** The combatant command the field sits in (by country, then coordinates); null when the app cannot place it. */
  aor?: Aor | null;
  /** The field has a SITREP slot (configured base). */
  sitrepSlot: boolean;
  /** The SITREP rollup when the slot assembled; null when it did not. */
  sitrep: {
    status: LineLeds;
    driver: string;
    worse: string[];
    closure: { now: boolean; next: string | null; indeterminate: boolean } | null;
  } | null;
  /** Force posture for the field (its own base row, else its country's). */
  posture: { composite: "green" | "unknown" | "amber" | "red"; topDriver: string; country: string; via: "base" | "country" } | null;
  /** The worst forecast category ahead at the field. */
  taf: { worst: "VFR" | "MVFR" | "IFR" | "LIFR" | "UNKNOWN"; fromISO: string } | null;
  /** Longest open runway, classed planning-grade. */
  cap: { lengthFt: number; surface: string; cls: "C-17" | "C-130" | "light" } | null;
}

export interface LineReadInput {
  line: { id: string; day: string; airframe: LineAirframe; fields: string[]; status: LineStatus };
  fields: LineFieldInput[];
  /** Which source families answered this pass (a dead one is named, never implied clear). */
  sources: { sitrep: boolean; posture: boolean; taf: boolean; cap: boolean };
  /** Today's Zulu day — the TAF reaches ~30 h, so it speaks only to today and tomorrow. */
  today: string;
}

export type LineDriverKind = "closure" | "led" | "posture" | "taf" | "runway" | "unknown";

export interface LineDriver {
  icao: string;
  kind: LineDriverKind;
  level: LineLed;
  text: string;
}

export interface LineFieldRead {
  icao: string;
  aor: Aor | null;
  worst: LineLed;
  leds: LineLeds | null;
  drivers: LineDriver[];
  sitrepSlot: boolean;
}

export interface LineRead {
  id: string;
  day: string;
  dayLabel: string;
  airframe: LineAirframe;
  fields: string[];
  status: LineStatus;
  label: string;
  worst: LineLed;
  /** Ranked worst-first across the line; the first is the lead driver. */
  drivers: LineDriver[];
  perField: LineFieldRead[];
  summary: string;
  /** Source families that did not answer. */
  unavailable: string[];
  /** The commands the line routes through (distinct, field order; UNKNOWN left out). */
  commands: Aor[];
  /** The 7-day demand outlook of each command the line enters — CONTEXT on the
   *  line, never a driver (the forecast and the commitment stay separate). */
  outlook?: { aor: Aor; direction: "rise" | "hold" | "fall" }[];
}

/** What the demand card shows beside a command's forecast: the lines
 *  COMMITTED into it. A command with no line is ABSENT — the card shows
 *  nothing, so an unused feature leaves the board exactly as it was. */
export interface LineCommandSummary {
  aor: Aor;
  count: number;
  worst: LineLed;
  /** The worst line's lead driver, "ICAO: text"; null when every line is quiet. */
  lead: string | null;
  lineIds: string[];
}

const KIND_RANK: Record<LineDriverKind, number> = { closure: 5, runway: 4, led: 3, posture: 2, taf: 1, unknown: 0 };
const byWorst = (a: LineDriver, b: LineDriver) => RANK[b.level] - RANK[a.level] || KIND_RANK[b.kind] - KIND_RANK[a.kind];

const addDays = (day: string, n: number) => { const [y, m, d] = day.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const hhmmZ = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? `${new Date(t).toISOString().slice(11, 16)}Z` : ""; };

function readField(f: LineFieldInput, line: LineReadInput["line"], today: string, sources: LineReadInput["sources"]): LineFieldRead {
  const drivers: LineDriver[] = [];
  let leds: LineFieldRead["leds"] = null;

  // SITREP — the five LEDs and the closure state. No slot → UNKNOWN, said.
  if (f.sitrep) {
    leds = f.sitrep.status;
    const w = worstLineLed(...Object.values(f.sitrep.status));
    if (f.sitrep.closure?.now) drivers.push({ icao: f.icao, kind: "closure", level: "r", text: "field CLOSED now (NOTAM)" });
    else if (f.sitrep.closure?.next) drivers.push({ icao: f.icao, kind: "closure", level: "a", text: `field closure scheduled ${f.sitrep.closure.next}` });
    else if (f.sitrep.closure?.indeterminate) drivers.push({ icao: f.icao, kind: "closure", level: "a", text: "a closure schedule is published but unreadable — LIMITED, see the NOTAM" });
    if (w === "r" || w === "a") {
      const axes = (Object.entries(f.sitrep.status) as [string, LineLed][]).filter(([, l]) => l === w).map(([k]) => k);
      drivers.push({ icao: f.icao, kind: "led", level: w, text: `${axes.join("/")} ${w === "r" ? "RED" : "AMBER"} — ${f.sitrep.driver}${f.sitrep.worse.length ? ` · worse than yesterday: ${f.sitrep.worse.join(", ")}` : ""}` });
    } else if (w === "u") {
      const axes = (Object.entries(f.sitrep.status) as [string, LineLed][]).filter(([, l]) => l === "u").map(([k]) => k);
      drivers.push({ icao: f.icao, kind: "unknown", level: "u", text: `${axes.join("/")} UNKNOWN — ${f.sitrep.driver}` });
    }
  } else if (f.sitrepSlot) {
    drivers.push({ icao: f.icao, kind: "unknown", level: "u", text: sources.sitrep ? "SITREP did not assemble this pass — UNKNOWN, not clear" : "SITREP source unavailable — UNKNOWN, not clear" });
  } else {
    drivers.push({ icao: f.icao, kind: "unknown", level: "u", text: "no SITREP slot — ★ the field for one; LEDs UNKNOWN" });
  }

  // Posture — the field's own row, else its host country's.
  if (f.posture) {
    if (f.posture.composite === "red" || f.posture.composite === "amber") {
      drivers.push({ icao: f.icao, kind: "posture", level: f.posture.composite === "red" ? "r" : "a", text: `posture ${f.posture.composite.toUpperCase()}${f.posture.via === "country" ? ` (${f.posture.country})` : ""} — ${f.posture.topDriver}` });
    } else if (f.posture.composite === "unknown") {
      drivers.push({ icao: f.icao, kind: "unknown", level: "u", text: `posture UNKNOWN${f.posture.via === "country" ? ` (${f.posture.country})` : ""} — ${f.posture.topDriver}` });
    }
  } else if (!sources.posture) {
    drivers.push({ icao: f.icao, kind: "unknown", level: "u", text: "force posture unavailable — UNKNOWN" });
  }

  // TAF — advisory, and only where the forecast reaches (today / tomorrow).
  const tafReaches = line.day === today || line.day === addDays(today, 1);
  if (tafReaches && f.taf && (f.taf.worst === "IFR" || f.taf.worst === "LIFR")) {
    drivers.push({ icao: f.icao, kind: "taf", level: "a", text: `${f.taf.worst} forecast${f.taf.fromISO ? ` from ${hhmmZ(f.taf.fromISO)}` : ""} (TAF, advisory)` });
  }

  // Runway capability vs the airframe's class — a hard driver, stated once.
  if (f.cap) {
    const need = runwayClassFor(line.airframe);
    const order = { "C-17": 2, "C-130": 1, light: 0 } as const;
    if (order[f.cap.cls] < order[need]) {
      drivers.push({ icao: f.icao, kind: "runway", level: "r", text: `longest open runway ${f.cap.lengthFt.toLocaleString()} ft${f.cap.surface ? ` ${f.cap.surface.toLowerCase().slice(0, 4)}` : ""} classes ${f.cap.cls} — below the ${need} class a ${line.airframe} needs (planning-grade, not an assault minimum)` });
    }
  } else if (sources.cap) {
    drivers.push({ icao: f.icao, kind: "unknown", level: "u", text: "runway length unknown (not in OurAirports) — capability UNKNOWN" });
  }

  drivers.sort(byWorst);
  const worst = drivers.length ? worstLineLed(...drivers.map((d) => d.level)) : "g";
  return { icao: f.icao, aor: f.aor && f.aor !== "UNKNOWN" ? f.aor : null, worst, leds, drivers, sitrepSlot: f.sitrepSlot };
}

export function readLine(input: LineReadInput): LineRead {
  const byIcao = new Map(input.fields.map((f) => [f.icao, f]));
  const perField = input.line.fields.map((icao) => {
    const f = byIcao.get(icao) ?? { icao, sitrepSlot: false, sitrep: null, posture: null, taf: null, cap: null };
    return readField(f, input.line, input.today, input.sources);
  });
  const drivers = perField.flatMap((p) => p.drivers).sort(byWorst);
  const worst = perField.length ? worstLineLed(...perField.map((p) => p.worst)) : "u";
  const unavailable = (["sitrep", "posture", "taf", "cap"] as const).filter((k) => !input.sources[k]).map((k) => ({ sitrep: "SITREP", posture: "force posture", taf: "TAF", cap: "runway capability" })[k]);
  const label = lineLabel(input.line);
  const lead = drivers[0];
  const summary = worst === "g"
    ? `${label}: quiet across the line — absence of signal, not evidence of calm${unavailable.length ? ` (${unavailable.join(", ")} UNAVAILABLE)` : ""}.`
    : worst === "u"
      ? `${label}: UNKNOWN — ${lead ? `${lead.icao} ${lead.text}` : "no reading"}.`
      : `${label}: ${worst === "r" ? "RED" : "AMBER"} at ${lead.icao} — ${lead.text}.`;
  const commands: Aor[] = [];
  for (const p of perField) if (p.aor && !commands.includes(p.aor)) commands.push(p.aor);
  return {
    id: input.line.id, day: input.line.day, dayLabel: lineDayLabel(input.line.day), airframe: input.line.airframe,
    fields: input.line.fields, status: input.line.status, label, worst, drivers, perField, summary, unavailable, commands,
  };
}

/** Fold the reads per command. A line through fields in two commands is
 *  committed into both. Commands with no line do not appear. */
export function linesByCommand(reads: LineRead[]): Record<string, LineCommandSummary> {
  const out: Record<string, LineCommandSummary> = {};
  for (const r of reads) {
    for (const aor of r.commands) {
      const cur = out[aor] ?? (out[aor] = { aor, count: 0, worst: "g", lead: null, lineIds: [] });
      cur.count += 1;
      cur.lineIds.push(r.id);
      const lead = r.drivers.find((d) => d.level !== "g");
      if (RANK[r.worst] > RANK[cur.worst] || (cur.lead === null && lead)) {
        cur.worst = worstLineLed(cur.worst, r.worst);
        if (lead) cur.lead = `${r.label} · ${lead.icao}: ${lead.text}`;
      }
    }
  }
  return out;
}

const DIR_WORD = { rise: "likely to RISE", hold: "holding", fall: "likely to fall" } as const;

/** The lines for a prompt / the Ask pack: one line each, drivers inline. */
export function lineReadLines(reads: LineRead[], limit = 12): string[] {
  return reads.slice(0, limit).map((r) => {
    const drv = r.drivers.filter((d) => d.level !== "g").slice(0, 3).map((d) => `${d.icao}: ${d.text}`).join(" · ");
    const ctx = r.outlook?.length ? ` · entering ${r.outlook.map((o) => `${o.aor} (demand ${DIR_WORD[o.direction]})`).join(", ")}` : "";
    return `- ${r.dayLabel} · ${r.label} · ${r.status} · worst ${r.worst === "g" ? "GREEN" : r.worst === "a" ? "AMBER" : r.worst === "r" ? "RED" : "UNKNOWN"}${drv ? ` — ${drv}` : " — quiet (absence of signal, not evidence of calm)"}${r.unavailable.length ? ` · UNAVAILABLE: ${r.unavailable.join(", ")}` : ""}${ctx}`;
  });
}
