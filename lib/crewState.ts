// Team state — PURE, client-safe, unit-tested. lib/crewStore.ts reads and
// writes rows; every judgement is here.
//
// The missing half of the north star: the app could say that Bab el-Mandeb
// was being interdicted and KWRI was PMC for weather, and could not say
// whether there were crews to do anything about either. This is the
// smallest model that closes that gap, and it is DELIBERATELY counts only:
// per qualification level, how many crews exist and how many are out (crew
// rest, on mission, DNIF, other). No names, no individuals — the decision
// taken when this was designed. Availability is DERIVED, never entered, so
// the arithmetic is always honest: a row whose outs exceed its total is
// flagged invalid rather than silently clamped.
//
// Declared, not inferred — the same call the Mission Profile and
// FamilyDocument make, for the same reason: this never arrives in a feed.
// Shared and crew-maintained like sitrep_limfacs, attributed by email.
// STALE after 24 h without an update: a crew count nobody has touched since
// yesterday is a guess dressed as a fact, and the posture line says so.

export interface CrewRow {
  qual: string;            // stable key, e.g. "AC", "IP", "FP", "LM"
  label: string;           // display, e.g. "Aircraft commander"
  total: number;
  crewRest: number;
  onMission: number;
  dnif: number;
  other: number;
  note: string | null;
  sort: number;
  updatedBy: string | null;
  updatedAt: string | null;   // ISO
}

export interface CrewAvailability extends CrewRow {
  available: number;
  unavailable: number;
  /** Outs exceed total — the row cannot be right. */
  invalid: boolean;
  fraction: number | null;   // available / total, null when total is 0
}

export interface CrewSummary {
  rows: CrewAvailability[];
  total: number;
  available: number;
  fraction: number | null;
  /** Hours since the oldest row was last updated; null when nothing is declared. */
  staleHours: number | null;
  stale: boolean;
  invalid: boolean;
  /** One clause, e.g. "3 of 8 crews available (2 crew rest, 3 on mission)". */
  line: string | null;
}

export type CrewPosture = "unknown" | "sufficient" | "thin" | "critical";

export const STALE_HOURS = 24;
export const THIN_BELOW = 0.5;
export const CRITICAL_BELOW = 0.25;

const n = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function deriveAvailability(rows: CrewRow[], nowMs = Date.now()): CrewSummary {
  const out: CrewAvailability[] = rows.slice().sort((a, b) => a.sort - b.sort || a.qual.localeCompare(b.qual)).map((r) => {
    const total = n(r.total);
    const unavailable = n(r.crewRest) + n(r.onMission) + n(r.dnif) + n(r.other);
    const invalid = unavailable > total;
    const available = invalid ? 0 : total - unavailable;
    return { ...r, total, available, unavailable, invalid, fraction: total > 0 ? available / total : null };
  });
  const total = out.reduce((s, r) => s + r.total, 0);
  const available = out.reduce((s, r) => s + r.available, 0);
  const invalid = out.some((r) => r.invalid);

  let staleHours: number | null = null;
  for (const r of out) {
    const t = r.updatedAt ? Date.parse(r.updatedAt) : NaN;
    const h = Number.isFinite(t) ? Math.max(0, (nowMs - t) / 3_600_000) : Infinity;
    staleHours = staleHours === null ? h : Math.max(staleHours, h);
  }
  const stale = staleHours !== null && staleHours >= STALE_HOURS;

  let line: string | null = null;
  if (total > 0) {
    const outs: string[] = [];
    const sum = (k: "crewRest" | "onMission" | "dnif" | "other") => out.reduce((s, r) => s + n(r[k]), 0);
    if (sum("crewRest")) outs.push(`${sum("crewRest")} crew rest`);
    if (sum("onMission")) outs.push(`${sum("onMission")} on mission`);
    if (sum("dnif")) outs.push(`${sum("dnif")} DNIF`);
    if (sum("other")) outs.push(`${sum("other")} other`);
    line = `${available} of ${total} crews available${outs.length ? ` (${outs.join(", ")})` : ""}${invalid ? " — a row's outs exceed its total, fix it" : ""}`;
  }

  return { rows: out, total, available, fraction: total > 0 ? available / total : null, staleHours, stale, invalid, line };
}

export function postureOf(fraction: number | null): CrewPosture {
  if (fraction === null) return "unknown";
  if (fraction < CRITICAL_BELOW) return "critical";
  if (fraction < THIN_BELOW) return "thin";
  return "sufficient";
}

export interface DemandRef { aor: string; direction: "rise" | "hold" | "fall"; score: number }

export interface PostureLine {
  aor: string;
  direction: DemandRef["direction"];
  posture: CrewPosture;
  /** Demand rising against thin/critical availability — the sentence that matters. */
  mismatch: boolean;
  line: string;
}

/** The sentence the north star asks for: demand direction per command
 *  against declared availability. Crew state is squadron-wide, so every
 *  command sees the same availability — what differs is the demand. */
export function postureAgainstDemand(crew: CrewSummary, outlooks: DemandRef[], labels: Record<string, string> = {}): { lines: PostureLine[]; headline: string } {
  const posture = postureOf(crew.fraction);
  const staleNote = crew.stale && crew.staleHours !== null ? ` — crew state last updated ${crew.staleHours >= 48 ? `${Math.round(crew.staleHours / 24)}d` : `${Math.round(crew.staleHours)}h`} ago, confirm` : "";
  const avail = crew.total > 0 ? `${crew.available} of ${crew.total} crews available` : "no crew state declared";

  const lines: PostureLine[] = outlooks.map((o) => {
    const name = labels[o.aor] ?? o.aor;
    const mismatch = o.direction === "rise" && (posture === "thin" || posture === "critical");
    const dir = o.direction === "rise" ? "likely to RISE" : o.direction === "fall" ? "likely to fall" : "holding";
    const line = posture === "unknown"
      ? `${name} demand ${dir} — ${avail}`
      : `${name} demand ${dir} — ${avail} (${posture})${mismatch ? " ⚠ rising demand against thin crews" : ""}${staleNote}`;
    return { aor: o.aor, direction: o.direction, posture, mismatch, line };
  });

  const rising = lines.filter((l) => l.direction === "rise").map((l) => labels[l.aor] ?? l.aor);
  const headline = posture === "unknown"
    ? "No crew state declared — posture against demand cannot be judged."
    : rising.length
      ? `${avail} (${posture}) with demand likely to rise in ${rising.join(", ")}${lines.some((l) => l.mismatch) ? " — mismatch" : ""}${staleNote}`
      : `${avail} (${posture}); no command with rising demand${staleNote}`;

  return { lines, headline };
}

/** Seed qualification levels for a fresh table. Labels are the user's to change. */
export const DEFAULT_QUALS: { qual: string; label: string; sort: number }[] = [
  { qual: "IP", label: "Instructor / evaluator pilot", sort: 1 },
  { qual: "AC", label: "Aircraft commander", sort: 2 },
  { qual: "FP", label: "First pilot / copilot", sort: 3 },
  { qual: "LM", label: "Loadmaster", sort: 4 },
];
