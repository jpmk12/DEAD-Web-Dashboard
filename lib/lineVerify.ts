// Scoring the line reads against how the lines went — PURE, client-safe,
// tested in tests/lineVerify.test.ts (docs/PLAN-MISSION-OBJECT.md §6, built
// 2026-11-26 when the operator chose the one-tap outcome).
//
// Every day a line is inside the horizon the app records how it READ
// (`line_read_daily`: the worst LED that day and the kinds of amber / red
// driver behind it). After the day the crew taps how it went: flew, slipped
// or cancelled. This joins the two and answers the question the series
// exists for — do the warnings the app shows on lines come before the lines
// that do not fly?
//
// Disciplines (the demand-horizon verifier's, applied to lines):
//   - The app scores its OWN reads, never the crew: the outcome is the
//     observation, the read is the forecast.
//   - Only reads taken BEFORE or ON the day count (lead 0–3 days); a read
//     with no record is "no read on record" and is left out, never scored.
//   - A line whose every read was UNKNOWN is its own bucket, never "quiet".
//   - A tally below the floor, never a rate: MIN_SCORED_FOR_RATE lines
//     overall, MIN_PER_KIND lines carrying a driver kind.
//   - Annotation only: nothing here changes a line read, a level or a weight.

import type { LineDriverKind, LineLed } from "./lineRead";
import type { LineOutcome } from "./missionLines";

export const MIN_SCORED_FOR_RATE = 10;
export const MIN_PER_KIND = 5;
/** Reads up to this many days before the line's day count as its call. */
export const READ_LEAD_DAYS = 3;

/** One stored day of a line's read. */
export interface LineReadDay {
  lineId: string;
  /** The Zulu day the read was taken. */
  observedDay: string;
  /** Days from the observation to the line's day (0 = on the day). */
  leadDays: number;
  worst: LineLed;
  /** Kinds of amber / red driver behind the read (never "unknown"). */
  kinds: LineDriverKind[];
  /** The lead driver, "ICAO: text"; null when quiet. */
  lead: string | null;
}

export interface ScoredLine { id: string; day: string; outcome: LineOutcome }

export type LineCall = "flagged" | "quiet" | "unknown" | "unread";

export interface LineCallRead {
  call: LineCall;
  worst: LineLed | null;
  kinds: LineDriverKind[];
  /** The earliest lead (days before the day) at which the line was flagged; null when never. */
  firstFlaggedLead: number | null;
  lead: string | null;
}

const RANK: Record<LineLed, number> = { g: 0, u: 1, a: 2, r: 3 };

/** The read a line carried into its day: flagged when any read before it was
 *  amber or red; unknown when every read was UNKNOWN; quiet otherwise. */
export function lineCall(reads: LineReadDay[]): LineCallRead {
  const use = reads.filter((r) => r.leadDays >= 0 && r.leadDays <= READ_LEAD_DAYS);
  if (!use.length) return { call: "unread", worst: null, kinds: [], firstFlaggedLead: null, lead: null };
  const worst = use.reduce((w, r) => (RANK[r.worst] > RANK[w] ? r.worst : w), "g" as LineLed);
  const flagged = use.filter((r) => r.worst === "a" || r.worst === "r");
  if (flagged.length) {
    const kinds = Array.from(new Set(flagged.flatMap((r) => r.kinds))).filter((k) => k !== "unknown");
    const worstRead = flagged.slice().sort((a, b) => RANK[b.worst] - RANK[a.worst] || a.leadDays - b.leadDays)[0];
    return { call: "flagged", worst, kinds, firstFlaggedLead: Math.max(...flagged.map((r) => r.leadDays)), lead: worstRead.lead };
  }
  if (use.every((r) => r.worst === "u")) return { call: "unknown", worst: "u", kinds: [], firstFlaggedLead: null, lead: null };
  return { call: "quiet", worst, kinds: [], firstFlaggedLead: null, lead: null };
}

export interface KindScore {
  kind: LineDriverKind;
  /** Scored lines carrying this kind before their day. */
  n: number;
  /** Of those, slipped or cancelled. */
  bad: number;
  /** bad / n once n ≥ MIN_PER_KIND, else null. */
  rate: number | null;
  /** rate ÷ the base rate of bad outcomes; null below the floor or with no base rate. */
  lift: number | null;
}

export interface LineVerify {
  scored: number;
  flew: number;
  slipped: number;
  cancelled: number;
  /** Scored lines with no read on record — left out of every rate. */
  unread: number;
  /** Scored lines whose every read was UNKNOWN — left out of the hit / miss rates. */
  unknown: number;
  flagged: { n: number; bad: number };
  quiet: { n: number; bad: number };
  /** Share of judged lines (flagged + quiet) that slipped or cancelled; null below the floor. */
  baseRate: number | null;
  /** Of the lines that went bad, the share the read flagged first; null below the floor. */
  caught: number | null;
  /** Of the flagged lines, the share that flew anyway; null below the floor. */
  falseAlarm: number | null;
  /** Median days ahead a bad line was first flagged; null when none. */
  medianLeadDays: number | null;
  byKind: KindScore[];
  forming: boolean;
  lines: string[];
}

const KIND_WORD: Record<LineDriverKind, string> = { closure: "a closure", runway: "runway capability", led: "a SITREP LED", posture: "force posture", taf: "the TAF turn", unknown: "UNKNOWN" };
const pct = (x: number) => `${Math.round(x * 100)} %`;
const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function verifyLines(scored: ScoredLine[], reads: LineReadDay[]): LineVerify {
  const byLine = new Map<string, LineReadDay[]>();
  for (const r of reads) byLine.set(r.lineId, [...(byLine.get(r.lineId) ?? []), r]);
  let flew = 0, slipped = 0, cancelled = 0, unread = 0, unknown = 0;
  const flagged = { n: 0, bad: 0 }, quiet = { n: 0, bad: 0 };
  const leads: number[] = [];
  const kindTally = new Map<LineDriverKind, { n: number; bad: number }>();
  for (const s of scored) {
    if (s.outcome === "flew") flew++; else if (s.outcome === "slipped") slipped++; else cancelled++;
    const bad = s.outcome !== "flew";
    const c = lineCall(byLine.get(s.id) ?? []);
    if (c.call === "unread") { unread++; continue; }
    if (c.call === "unknown") { unknown++; continue; }
    const b = c.call === "flagged" ? flagged : quiet;
    b.n++; if (bad) b.bad++;
    if (c.call === "flagged") {
      if (bad && c.firstFlaggedLead != null) leads.push(c.firstFlaggedLead);
      for (const k of c.kinds) { const t = kindTally.get(k) ?? { n: 0, bad: 0 }; t.n++; if (bad) t.bad++; kindTally.set(k, t); }
    }
  }
  const judged = flagged.n + quiet.n;
  const forming = judged < MIN_SCORED_FOR_RATE;
  const badJudged = flagged.bad + quiet.bad;
  const baseRate = forming ? null : badJudged / judged;
  const caught = forming || badJudged === 0 ? null : flagged.bad / badJudged;
  const falseAlarm = forming || flagged.n === 0 ? null : (flagged.n - flagged.bad) / flagged.n;
  const byKind: KindScore[] = [...kindTally.entries()].map(([kind, t]) => {
    const rate = t.n >= MIN_PER_KIND ? t.bad / t.n : null;
    return { kind, n: t.n, bad: t.bad, rate, lift: rate != null && baseRate ? rate / baseRate : null };
  }).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.n - a.n);

  const lines: string[] = [];
  const total = scored.length;
  if (!total) lines.push("No line has an outcome yet — after a line's day, tap how it went (flew, slipped, cancelled).");
  else {
    lines.push(`${total} line${total === 1 ? "" : "s"} scored — ${flew} flew, ${slipped} slipped, ${cancelled} cancelled${unread ? ` · ${unread} with no read on record` : ""}${unknown ? ` · ${unknown} read UNKNOWN throughout` : ""}.`);
    lines.push(`Flagged amber / red before the day: ${flagged.n} → ${flagged.bad} slipped or cancelled · read quiet: ${quiet.n} → ${quiet.bad} slipped or cancelled.`);
    if (forming) lines.push(`Forming — ${judged} of ${MIN_SCORED_FOR_RATE} judged lines before any rate; tallies only.`);
    else {
      lines.push(`Of the lines that did not fly as planned, the read flagged ${caught != null ? pct(caught) : "—"}; of the flagged lines, ${falseAlarm != null ? pct(falseAlarm) : "—"} flew anyway (base rate ${pct(baseRate!)}).`);
      if (medianLeadDays(leads) != null) lines.push(`A line that went bad was first flagged a median ${medianLeadDays(leads)} day${medianLeadDays(leads) === 1 ? "" : "s"} ahead.`);
    }
    for (const k of byKind.slice(0, 4)) {
      lines.push(k.rate != null
        ? `${KIND_WORD[k.kind]}: ${k.bad} of ${k.n} lines carrying it did not fly as planned (${pct(k.rate)}${k.lift != null ? `, ${k.lift.toFixed(1)}× the base rate` : ""}).`
        : `${KIND_WORD[k.kind]}: ${k.bad} of ${k.n} — forming (${MIN_PER_KIND} lines before a rate).`);
    }
  }
  return { scored: total, flew, slipped, cancelled, unread, unknown, flagged, quiet, baseRate, caught, falseAlarm, medianLeadDays: medianLeadDays(leads), byKind, forming, lines };
}

function medianLeadDays(leads: number[]): number | null {
  return leads.length ? Math.round(median(leads) * 10) / 10 : null;
}

/** What one line's stored read says, for the "how did it go?" row. */
export function callLine(c: LineCallRead): string {
  if (c.call === "unread") return "no read on record";
  if (c.call === "unknown") return "read UNKNOWN throughout";
  if (c.call === "quiet") return "read quiet before the day";
  return `read ${c.worst === "r" ? "RED" : "AMBER"}${c.firstFlaggedLead != null ? ` from ${c.firstFlaggedLead === 0 ? "the day itself" : `${c.firstFlaggedLead} day${c.firstFlaggedLead === 1 ? "" : "s"} ahead`}` : ""}${c.lead ? ` — ${c.lead}` : ""}`;
}

/** One stored row from a live read: the worst LED and the amber / red driver kinds. */
export function readDayFrom(read: { id: string; day: string; worst: LineLed; drivers: { icao: string; kind: LineDriverKind; level: LineLed; text: string }[] }, today: string): LineReadDay | null {
  const lead = daysBetween(today, read.day);
  if (lead < 0) return null;
  const hits = read.drivers.filter((d) => (d.level === "a" || d.level === "r") && d.kind !== "unknown");
  const top = read.drivers[0];
  return {
    lineId: read.id, observedDay: today, leadDays: lead, worst: read.worst,
    kinds: Array.from(new Set(hits.map((d) => d.kind))),
    lead: top && read.worst !== "g" ? `${top.icao}: ${top.text}`.slice(0, 250) : null,
  };
}

function daysBetween(a: string, b: string): number {
  const t = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return Date.UTC(y, m - 1, dd); };
  return Math.round((t(b) - t(a)) / 86_400_000);
}
