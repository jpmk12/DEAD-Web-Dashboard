// Planner date-time tools — PURE, client-safe, dependency-free beyond Intl
// (tests/plannerTools.test.ts). The Tools tab's arithmetic lives here so a
// converter can be checked against known dates rather than trusted.
//
// Three vocabularies, each stated once:
// - "Julian date" in the flying-schedule sense: the ORDINAL day of the year
//   (001–366), never the astronomical Julian Day Number. `YYDDD` is the
//   five-digit form (26300) that fuel receipts and some schedules print.
// - H-hour: a planning anchor; every other time is an OFFSET from it
//   ("H-72" is 72 hours before H). Offsets are hours, fractional allowed.
// - DTG: the military date-time group DDHHMM[Z]MONYY ("271930ZOCT26").
//   The zone letter is Z for UTC; a whole-hour offset gets its letter
//   (A–M east skipping J, N–Y west); a half-hour zone has no letter and is
//   written as "+0330". J (local) is never produced.
//
// Zone maths goes through Intl (the same as lib/worldClocks) so DST is
// honoured per instant; a wall time that does not exist (the spring-forward
// gap) resolves to the instant after it, one that exists twice (fall-back)
// resolves to the FIRST, and `wallToMs` says neither — a planner who cares
// about that hour reads the DTG beside it, which is unambiguous.

import { utcOffsetMinutes, isValidTz } from "./worldClocks";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
export const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── Julian (ordinal day) ────────────────────────────────────────────────────

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInYear(y: number): number { return isLeapYear(y) ? 366 : 365; }

const YMD_RX = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A valid YYYY-MM-DD (a real calendar date), else null. */
export function parseYmd(s: string): { y: number; m: number; d: number } | null {
  const m = YMD_RX.exec((s ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

export interface JulianDate {
  year: number;
  /** 1..366 */
  jd: number;
  /** "300" */
  label: string;
  /** "26300" — the YYDDD form. */
  yyddd: string;
  ymd: string;
  weekday: string;
  leap: boolean;
}

/** YYYY-MM-DD → its ordinal day. Null for anything that is not a real date. */
export function ymdToJulian(ymd: string): JulianDate | null {
  const p = parseYmd(ymd);
  if (!p) return null;
  const jd = Math.round((Date.UTC(p.y, p.m - 1, p.d) - Date.UTC(p.y, 0, 1)) / DAY_MS) + 1;
  return describeJulian(p.y, jd);
}

/** An ordinal day in a year → the date. Null when the day is outside 1..daysInYear. */
export function julianToYmd(jd: number, year: number): JulianDate | null {
  if (!Number.isInteger(jd) || !Number.isInteger(year) || year < 1 || year > 9999) return null;
  if (jd < 1 || jd > daysInYear(year)) return null;
  return describeJulian(year, jd);
}

function describeJulian(year: number, jd: number): JulianDate {
  const dt = new Date(Date.UTC(year, 0, jd));
  const ymd = dt.toISOString().slice(0, 10);
  return {
    year, jd, label: String(jd).padStart(3, "0"),
    yyddd: `${String(year % 100).padStart(2, "0")}${String(jd).padStart(3, "0")}`,
    ymd, weekday: DOW[dt.getUTCDay()], leap: isLeapYear(year),
  };
}

/** Read a Julian the ways people type it: "300" (needs `defaultYear`),
 *  "26300" (YYDDD — 20YY), "2026-300" / "2026/300" / "300/2026", "2026300".
 *  Returns the resolved date or null; never guesses a year beyond the
 *  default handed in. */
export function parseJulianInput(s: string, defaultYear: number): JulianDate | null {
  const t = (s ?? "").trim().toUpperCase().replace(/^JD\s*/, "");
  if (!t) return null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,3})$/.exec(t))) return julianToYmd(Number(m[1]), defaultYear);
  if ((m = /^(\d{2})(\d{3})$/.exec(t))) return julianToYmd(Number(m[2]), 2000 + Number(m[1]));
  if ((m = /^(\d{4})(\d{3})$/.exec(t))) return julianToYmd(Number(m[2]), Number(m[1]));
  if ((m = /^(\d{4})[-/ ](\d{1,3})$/.exec(t))) return julianToYmd(Number(m[2]), Number(m[1]));
  if ((m = /^(\d{1,3})[-/ ](\d{4})$/.exec(t))) return julianToYmd(Number(m[1]), Number(m[2]));
  return null;
}

/** Whole days from `a` to `b` (both YYYY-MM-DD; negative when b is earlier). Null on a bad date. */
export function daysBetween(a: string, b: string): number | null {
  const pa = parseYmd(a), pb = parseYmd(b);
  if (!pa || !pb) return null;
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / DAY_MS);
}

/** ISO-8601 week number (Monday-first, week 1 holds 4 January). */
export function isoWeek(ymd: string): number | null {
  const p = parseYmd(ymd);
  if (!p) return null;
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
}

// ── Zones ───────────────────────────────────────────────────────────────────

/** The military zone letter for a whole-hour UTC offset; null for a
 *  half-hour zone (no letter exists) or an offset outside ±12. */
export function zoneLetter(offsetMin: number): string | null {
  if (offsetMin === 0) return "Z";
  if (offsetMin % 60 !== 0) return null;
  const h = offsetMin / 60;
  if (h > 0 && h <= 12) return "ABCDEFGHIKLM"[h - 1];   // J is skipped
  if (h < 0 && h >= -12) return "NOPQRSTUVWXY"[-h - 1];
  return null;
}

/** The UTC offset a zone letter stands for, in minutes; null for J or an unknown letter. */
export function letterOffset(letter: string): number | null {
  const L = (letter ?? "").trim().toUpperCase();
  if (L === "Z") return 0;
  const east = "ABCDEFGHIKLM".indexOf(L);
  if (east >= 0) return (east + 1) * 60;
  const west = "NOPQRSTUVWXY".indexOf(L);
  if (west >= 0) return -(west + 1) * 60;
  return null;
}

/** "+0330" / "-0500" / "+0000" — the offset the DTG carries when no letter fits. */
export function offsetTag(offsetMin: number): string {
  const sign = offsetMin < 0 ? "-" : "+";
  const a = Math.abs(offsetMin);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}${String(a % 60).padStart(2, "0")}`;
}

/** The instant a wall-clock YYYY-MM-DD + HH:MM in `zone` names. Two passes
 *  so a DST change on that day resolves to the right offset; a non-existent
 *  wall time lands on the instant after the gap. Null on a bad input. */
export function wallToMs(ymd: string, hhmm: string, zone: string): number | null {
  const p = parseYmd(ymd);
  const t = /^(\d{1,2}):?(\d{2})$/.exec((hhmm ?? "").trim());
  if (!p || !t || !isValidTz(zone)) return null;
  const hh = Number(t[1]), mm = Number(t[2]);
  if (hh > 23 || mm > 59) return null;
  // The offsets a day either side are the ones in force before and after any
  // change that day. A candidate is valid when the zone really shows that
  // wall time at it. Both valid = the doubled fall-back hour → the FIRST
  // instant; neither = the spring-forward gap → the instant after the gap
  // (the before-offset carries the clock past it). Code review 2026-10-28:
  // the earlier two-pass guess landed BEFORE the gap and on the SECOND
  // occurrence in some zones.
  const guess = Date.UTC(p.y, p.m - 1, p.d, hh, mm);
  const before = utcOffsetMinutes(new Date(guess - 86_400_000), zone);
  const after = utcOffsetMinutes(new Date(guess + 86_400_000), zone);
  const cands = [...new Set([before, after])].map((off) => ({ off, ms: guess - off * 60_000 }));
  const valid = cands.filter((c) => utcOffsetMinutes(new Date(c.ms), zone) === c.off).map((c) => c.ms);
  if (valid.length) return Math.min(...valid);
  return guess - before * 60_000;
}

export interface ZoneTime {
  zone: string;
  ymd: string;
  /** "19:30" */
  hhmm: string;
  weekday: string;
  /** "27 Oct" */
  dayShort: string;
  offsetMin: number;
  /** "Z" / "C" / null when no letter fits. */
  letter: string | null;
  /** The DTG in this zone: "271930ZOCT26", "272130BOCT26", "272300+0330OCT26". */
  dtg: string;
}

/** An instant as that zone's wall clock, with its DTG. An invalid zone reads as UTC and says so in `zone`. */
export function inZone(ms: number, zone: string): ZoneTime {
  const z = isValidTz(zone) ? zone : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: z, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" })
    .formatToParts(new Date(ms)).reduce<Record<string, string>>((acc, p) => { if (p.type !== "literal") acc[p.type] = p.value; return acc; }, {});
  const y = Number(parts.year), mo = Number(parts.month), d = Number(parts.day);
  const hh = parts.hour === "24" ? "00" : parts.hour;
  const offsetMin = utcOffsetMinutes(new Date(ms), z);
  const letter = zoneLetter(offsetMin);
  const dtg = `${String(d).padStart(2, "0")}${hh}${parts.minute}${letter ?? offsetTag(offsetMin)}${MONTHS[mo - 1]}${String(y % 100).padStart(2, "0")}`;
  return {
    zone: z, ymd: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    hhmm: `${hh}:${parts.minute}`, weekday: parts.weekday, dayShort: `${String(d).padStart(2, "0")} ${MONTHS[mo - 1][0]}${MONTHS[mo - 1].slice(1).toLowerCase()}`,
    offsetMin, letter, dtg,
  };
}

/** The Zulu DTG of an instant — the one every row prints. */
export function dtgZulu(ms: number): string { return inZone(ms, "UTC").dtg; }

const DTG_RX = /^(\d{2})(\d{2})(\d{2})\s*(?:([A-IK-Z])|([+-])(\d{2}):?(\d{2}))?\s*([A-Z]{3})\s*(\d{2}|\d{4})$/;

/** Parse a DTG: "271930ZOCT26", "271930Z OCT 26", "271930 OCT 2026" (no
 *  letter = Zulu), "272130BOCT26" (a letter zone), "272300+0330OCT26".
 *  Returns the instant, or null — a J (local) DTG is refused because the
 *  reader cannot know whose local. */
export function parseDtg(s: string): number | null {
  const m = DTG_RX.exec((s ?? "").trim().toUpperCase().replace(/\s+/g, " "));
  if (!m) return null;
  const d = Number(m[1]), hh = Number(m[2]), mm = Number(m[3]);
  const mon = MONTHS.indexOf(m[8]);
  if (mon < 0 || hh > 23 || mm > 59) return null;
  const y = m[9].length === 4 ? Number(m[9]) : 2000 + Number(m[9]);
  let off = 0;
  if (m[4]) { const o = letterOffset(m[4]); if (o == null) return null; off = o; }
  else if (m[5]) off = (m[5] === "-" ? -1 : 1) * (Number(m[6]) * 60 + Number(m[7]));
  const dt = new Date(Date.UTC(y, mon, d, hh, mm));
  if (dt.getUTCMonth() !== mon || dt.getUTCDate() !== d) return null;
  return dt.getTime() - off * 60_000;
}

// ── H-hour ──────────────────────────────────────────────────────────────────

/** The planning offsets a fresh H-hour card shows, in hours. */
export const DEFAULT_H_OFFSETS: number[] = [-96, -72, -48, -24, -12, -6, -3, -1, 0, 1, 3, 6, 12, 24, 48, 72];

/** "H-72" / "H" / "H+24" / "H+0:30" / "H-1:15". */
export function hLabel(offsetH: number): string {
  if (offsetH === 0) return "H";
  const sign = offsetH < 0 ? "-" : "+";
  const a = Math.abs(offsetH);
  const whole = Math.floor(a);
  const min = Math.round((a - whole) * 60);
  if (min === 0) return `H${sign}${whole}`;
  if (min === 60) return `H${sign}${whole + 1}`;
  return `H${sign}${whole}:${String(min).padStart(2, "0")}`;
}

/** Read an offset the ways people type it: "H-72", "-72", "+36", "36h",
 *  "H+2d", "H-1:30", "H+90m". Hours as a number, or null. */
export function parseOffsetInput(s: string): number | null {
  const t = (s ?? "").trim().toUpperCase().replace(/^H\s*/, "").replace(/\s+/g, "");
  if (!t) return null;
  const m = /^([+-]?)(\d+(?:\.\d+)?)(?::(\d{1,2}))?(H|HR|HRS|D|DAY|DAYS|M|MIN|MINS)?$/.exec(t);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  let hours = Number(m[2]);
  const unit = m[4] ?? "H";
  if (m[3]) { if (unit !== "H") return null; hours += Number(m[3]) / 60; }
  else if (unit.startsWith("D")) hours *= 24;
  else if (unit.startsWith("M")) hours /= 60;
  if (!Number.isFinite(hours) || hours > 24 * 365) return null;
  return sign * hours;
}

export interface HRow {
  offsetH: number;
  label: string;
  ms: number;
  dtg: string;
}

/** One row per offset, ascending, the anchor included if it is in the list. */
export function hHourTable(hMs: number, offsets: number[]): HRow[] {
  const uniq = [...new Set(offsets.filter((o) => Number.isFinite(o)))].sort((a, b) => a - b);
  return uniq.map((o) => { const ms = hMs + o * HOUR_MS; return { offsetH: o, label: hLabel(o), ms, dtg: dtgZulu(ms) }; });
}

/** The table as plain text for the clipboard — one line per offset, the
 *  Zulu DTG then each zone's wall clock, columns padded. */
export function hTableText(hMs: number, offsets: number[], zones: { zone: string; label: string }[]): string {
  const rows = hHourTable(hMs, offsets);
  const head = ["Offset", "Zulu DTG", ...zones.map((z) => z.label)];
  const body = rows.map((r) => [r.label, r.dtg, ...zones.map((z) => { const t = inZone(r.ms, z.zone); return `${t.weekday} ${t.dayShort} ${t.hhmm}${t.letter && t.letter !== "Z" ? t.letter : t.letter ? "" : offsetTag(t.offsetMin)}`; })]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  return [`H-hour: ${dtgZulu(hMs)}`, line(head), ...body.map(line)].join("\n");
}

/** Hours from `nowMs` to the anchor, signed; "H in 36.5 h" / "H was 2.0 h ago". */
export function hCountdown(hMs: number, nowMs: number): { hours: number; text: string } {
  const hours = (hMs - nowMs) / HOUR_MS;
  const a = Math.abs(hours);
  const span = a >= 48 ? `${(a / 24).toFixed(1)} d` : `${a.toFixed(1)} h`;
  return { hours, text: hours >= 0 ? `H in ${span}` : `H was ${span} ago` };
}
