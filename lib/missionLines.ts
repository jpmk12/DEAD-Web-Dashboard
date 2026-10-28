// Mission lines — PURE, client-safe, dependency-free (docs/PLAN-MISSION-OBJECT.md,
// the schema as FIXED by the operator's answers, 2026-10-27).
//
// A line is a REFERENCE to a day's flying, not the flying: one Zulu day, one
// airframe, the fields of interest in order, and whether it is planned or in
// execution. Nothing else — no label, no note, no tail, no callsign, no load,
// no times. The operator said "I don't want to actually put real flight data
// in here. I want to keep it high level", so the record is coarse BY DESIGN
// and the validator REFUSES anything finer at the write boundary (the
// /api/family/event rule). A line is declared, never derived, and never
// changes a level: it is the lens that picks which of the app's readings
// matter on that day.

export const LINE_AIRFRAMES = ["C-17", "C-130", "KC-135", "KC-46"] as const;
export type LineAirframe = (typeof LINE_AIRFRAMES)[number];

export const LINE_STATUSES = ["planned", "execution"] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];
export const LINE_STATUS_LABEL: Record<LineStatus, string> = { planned: "Planned", execution: "Execution" };

/** The schedule is real this far out (the operator's answer: 4 days,
 *  today included). Lines beyond it exist but are not read. */
export const LINE_HORIZON_DAYS = 4;
export const LINE_MAX_FIELDS = 8;
/** The only keys a line may carry — anything else is refused, not dropped. */
export const LINE_KEYS = ["id", "day", "airframe", "fields", "status"] as const;

export interface MissionLine {
  id: string;
  /** The Zulu calendar day, YYYY-MM-DD (the Julian day is derived for display). */
  day: string;
  airframe: LineAirframe;
  /** Ordered ICAO fields of interest. */
  fields: string[];
  status: LineStatus;
  updatedBy: string;
  updatedAt: string;
}

export interface LineDraft {
  day: string;
  airframe: LineAirframe;
  fields: string[];
  status: LineStatus;
}

const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;
const ICAO_RX = /^[A-Z0-9]{4}$/;
// The refusals, named so the error can say WHAT the token looked like. A line
// holds fields only; the shapes below are the data the operator said must
// never be typed in — each is refused by its own name, never silently kept.
const REFUSALS: { rx: RegExp; what: string }[] = [
  { rx: /^(?:RCH|REACH|MOOSE|TEAL|GOLD|KING)\s?\d{2,4}[A-Z]?$/i, what: "a callsign" },
  { rx: /^\d{2}-?\d{4}$/, what: "a tail number" },
  { rx: /^\d{4}Z$|^\d{2}:\d{2}Z?$|^\d{6}Z$/i, what: "a time" },
  { rx: /^\d{1,3}(?:x|pax|plt|k|lbs?)$/i, what: "a load" },
];

export function isValidDay(day: unknown): day is string {
  if (typeof day !== "string" || !DAY_RX.test(day)) return false;
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "OJAQ OTBH" / "OJAQ, OTBH" / "OJAQ → OTBH" → ["OJAQ", "OTBH"] (upper, raw — validate after). */
export function parseFieldsText(text: string): string[] {
  return text.split(/[\s,;→>/|]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
}

/** The validator's sentence, or null when the draft is a line. Every rule
 *  states its refusal in words the editor shows as-is. */
export function validateLineDraft(input: Record<string, unknown>, opts: { nowMs?: number } = {}): string | null {
  for (const k of Object.keys(input)) {
    if (!(LINE_KEYS as readonly string[]).includes(k)) return `A line holds no “${k}” — a day, an airframe, the fields and a status, nothing finer.`;
  }
  if (!isValidDay(input.day)) return "Day must be a calendar date (YYYY-MM-DD, Zulu).";
  // With a clock, a day outside the horizon is refused by name — it would
  // save and then never appear (code review 2026-10-28).
  if (opts.nowMs != null) {
    const today = todayZulu(opts.nowMs), last = addDaysYmd(today, LINE_HORIZON_DAYS - 1);
    if (String(input.day) < today) return `That day has passed — lines are for today through ${last} (Zulu).`;
    if (String(input.day) > last) return `Lines reach ${LINE_HORIZON_DAYS} days ahead — today through ${last} (Zulu).`;
  }
  if (typeof input.airframe !== "string" || !(LINE_AIRFRAMES as readonly string[]).includes(input.airframe)) return `Airframe must be one of ${LINE_AIRFRAMES.join(", ")}.`;
  if (typeof input.status !== "string" || !(LINE_STATUSES as readonly string[]).includes(input.status)) return "Status must be planned or execution.";
  const raw = Array.isArray(input.fields) ? input.fields : typeof input.fields === "string" ? parseFieldsText(input.fields) : null;
  if (!raw) return "Fields must be a list of ICAO identifiers.";
  const fields = raw.map((f) => String(f).trim().toUpperCase()).filter(Boolean);
  if (fields.length === 0) return "Name at least one field (ICAO).";
  if (fields.length > LINE_MAX_FIELDS) return `Keep a line to ${LINE_MAX_FIELDS} fields.`;
  for (const f of fields) {
    const refused = REFUSALS.find((r) => r.rx.test(f));
    if (refused) return `“${f}” looks like ${refused.what} — a line holds fields only, never tails, callsigns, loads or times.`;
    if (!ICAO_RX.test(f)) return `“${f}” is not an ICAO identifier (four letters or digits).`;
  }
  return null;
}

/** The validated draft, normalised (upper-cased ICAOs, duplicates kept in
 *  order — a turn OJAQ → OTBH → OJAQ is a real shape). Throws never: call
 *  validateLineDraft first. */
export function normalizeLineDraft(input: Record<string, unknown>): LineDraft {
  const raw = Array.isArray(input.fields) ? input.fields.map(String) : parseFieldsText(String(input.fields ?? ""));
  return {
    day: String(input.day),
    airframe: input.airframe as LineAirframe,
    fields: raw.map((f) => f.trim().toUpperCase()).filter(Boolean).slice(0, LINE_MAX_FIELDS),
    status: input.status as LineStatus,
  };
}

// ── Day arithmetic (UTC, the Zulu day) ──────────────────────────────────────

export function addDaysYmd(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function todayZulu(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** The ordinal day of the year on that Zulu day — the three-digit "JD" a
 *  flying schedule prints (lib/date.ts has the device-zone form). */
export function julianOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Wed 28 Oct · JD 301" */
export function lineDayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DOW[dt.getUTCDay()]} ${d} ${MON[m - 1]} · JD ${String(julianOf(day)).padStart(3, "0")}`;
}

/** "C-17 · OJAQ → OTBH" — the only label a line has; it is derived. */
export function lineLabel(line: Pick<MissionLine, "airframe" | "fields">): string {
  return `${line.airframe} · ${line.fields.join(" → ")}`;
}

/** Lines on or after today inside the horizon (today + horizon − 1), by day
 *  then airframe then declaration order. A past line is never read. */
export function linesInHorizon<T extends { day: string; airframe: string; updatedAt?: string }>(lines: T[], today: string, horizon = LINE_HORIZON_DAYS): T[] {
  const last = addDaysYmd(today, horizon - 1);
  return lines
    .filter((l) => l.day >= today && l.day <= last)
    .sort((a, b) => a.day.localeCompare(b.day) || a.airframe.localeCompare(b.airframe) || (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""));
}

/** The runway class an airframe needs for a PLANNING-GRADE "can it land here"
 *  (lib/ourAirports classes a field C-17 ≥ 7,000 ft hard · C-130 ≥ 3,500 ft ·
 *  else light). Tankers are heavies: they need the C-17 class. Advisory only
 *  — never an assault minimum. */
export function runwayClassFor(airframe: LineAirframe): "C-17" | "C-130" {
  return airframe === "C-130" ? "C-130" : "C-17";
}
