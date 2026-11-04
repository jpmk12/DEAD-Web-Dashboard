// Tools tab add-ons — PURE, client-safe, tested (tests/plannerExtras.test.ts).
// Three vocabularies, stated once:
//   • SUN-RELATIVE OFFSETS — "BMNT-30", "EENT+0:15", "SR", "MR+1:00": an
//     event of the night that CONTAINS H at the chosen place (lib/moon
//     `lunarNight`), plus or minus minutes. An event that does not occur that
//     night (polar, a moon that never rises) is a row that SAYS so, never a
//     guessed time.
//   • EN ROUTE — a departure (or an arrive-by) plus an ETE, the ETE typed as
//     "7:45", "7.75", "7h45m", "465m", or derived from distance ÷ ground
//     speed. Whole minutes; nothing rounds silently past a minute.
//   • UNITS — distance, speed, temperature, weight, fuel (by a stated density,
//     JP-8 6.7 lb/US gal by default — density varies with temperature and
//     product, so the number is planning-grade and the card says so),
//     pressure. Exact factors (the international nautical mile, foot, pound).

import type { LunarNight } from "./moon";

// ── Sun-relative offsets ───────────────────────────────────────────────────

export type SunEvent = "SS" | "EENT" | "BMNT" | "SR" | "MR" | "MS";
export const SUN_EVENTS: SunEvent[] = ["SS", "EENT", "BMNT", "SR", "MR", "MS"];
export const SUN_EVENT_LABEL: Record<SunEvent, string> = {
  SS: "sunset", EENT: "end evening nautical twilight", BMNT: "begin morning nautical twilight", SR: "sunrise", MR: "moonrise", MS: "moonset",
};
const EVENT_ALIASES: Record<string, SunEvent> = {
  SS: "SS", SUNSET: "SS", EENT: "EENT", BMNT: "BMNT", SR: "SR", SUNRISE: "SR", MR: "MR", MOONRISE: "MR", MS: "MS", MOONSET: "MS",
};

export interface SunOffset { event: SunEvent; minutes: number }

/** "BMNT-30" · "bmnt -0:30" · "SR+1:00" · "EENT+15m" · "SS" · "MR+1h" → the
 *  event and a signed minute offset; null when it is not one. A bare number
 *  is MINUTES ("BMNT-30" is thirty minutes before BMNT, the way an OPORD
 *  writes it); "h" or a colon means hours. */
export function parseSunOffset(raw: string): SunOffset | null {
  const s = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const m = /^([A-Z]+)(?:([+-])(\d{1,3})(?::(\d{2})|H(?:(\d{1,2})M?)?|M)?)?$/.exec(s);
  if (!m) return null;
  const event = EVENT_ALIASES[m[1]];
  if (!event) return null;
  if (!m[2]) return { event, minutes: 0 };
  const sign = m[2] === "-" ? -1 : 1;
  const n = Number(m[3]);
  let minutes: number;
  if (m[4] != null) minutes = n * 60 + Number(m[4]);
  else if (/H/.test(s.slice(m[1].length))) minutes = n * 60 + (m[5] ? Number(m[5]) : 0);
  else minutes = n;
  if (minutes > 24 * 60) return null;
  return { event, minutes: sign * minutes };
}

export function sunOffsetLabel(o: SunOffset): string {
  if (o.minutes === 0) return o.event;
  const a = Math.abs(o.minutes), sign = o.minutes < 0 ? "-" : "+";
  return a % 60 === 0 && a >= 60 ? `${o.event}${sign}${a / 60}:00` : a >= 60 ? `${o.event}${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}` : `${o.event}${sign}${a}`;
}

/** The instant of an event in a night; null when it does not occur. Moon
 *  events take the first one at or after the night's sunset (else the first
 *  in the window) — the one a planner means by "moonrise tonight". */
export function sunEventMs(night: LunarNight, event: SunEvent): number | null {
  switch (event) {
    case "SS": return night.sunset;
    case "EENT": return night.eent;
    case "BMNT": return night.bmnt;
    case "SR": return night.sunrise;
    case "MR": case "MS": {
      const list = [...(event === "MR" ? night.moonrise : night.moonset)].sort((a, b) => a - b);
      if (!list.length) return null;
      const from = night.sunset ?? -Infinity;
      return list.find((t) => t >= from) ?? list[0];
    }
  }
}

export interface SunRow { key: string; label: string; ms: number | null; offsetH: number | null; why: string | null }

/** One row per sun-relative offset, against the night that contains H.
 *  `offsetH` is the row's distance from H in hours (for the H± column). */
export function sunOffsetRows(hMs: number, offsets: SunOffset[], night: LunarNight | null): SunRow[] {
  return offsets.map((o) => {
    const label = sunOffsetLabel(o);
    if (!night) return { key: label, label, ms: null, offsetH: null, why: "no place chosen" };
    const base = sunEventMs(night, o.event);
    if (base == null) return { key: label, label, ms: null, offsetH: null, why: night.polar && (o.event === "EENT" || o.event === "BMNT") ? "no nautical darkness that night (polar)" : `no ${SUN_EVENT_LABEL[o.event]} that night` };
    const ms = base + o.minutes * 60_000;
    return { key: label, label, ms, offsetH: Math.round(((ms - hMs) / 3_600_000) * 60) / 60, why: null };
  });
}

// ── En route ───────────────────────────────────────────────────────────────

/** "7:45" · "7.75" · "7h45m" · "7h" · "465m" · "0745" → whole minutes; null
 *  when it is not a duration. A bare integer up to 24 is hours; four digits
 *  is HHMM; "m" alone is minutes. */
export function parseDuration(raw: string): number | null {
  const s = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2}):(\d{2})$/.exec(s))) return Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
  if ((m = /^(\d{1,2})h(?:(\d{1,2})m?)?$/.exec(s))) return Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
  if ((m = /^(\d{1,4})m(?:in)?$/.exec(s))) return Number(m[1]);
  if ((m = /^(\d{2})(\d{2})$/.exec(s))) return Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
  if ((m = /^(\d{1,2}(?:\.\d+)?)$/.exec(s))) { const h = Number(m[1]); return h <= 48 ? Math.round(h * 60) : null; }
  return null;
}

export function durationLabel(min: number): string {
  const a = Math.abs(Math.round(min));
  return `${min < 0 ? "-" : ""}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
}

/** Distance (nm) ÷ ground speed (kt) → whole minutes; null for nonsense. */
export function eteFromDistance(nm: number, kts: number): number | null {
  if (!Number.isFinite(nm) || !Number.isFinite(kts) || nm <= 0 || kts <= 0) return null;
  return Math.round((nm / kts) * 60);
}

export interface EnRoute { depMs: number; arrMs: number; eteMin: number }

/** Depart at `anchorMs` + ETE, or — `arriveBy` — arrive at `anchorMs`, so
 *  depart ETE earlier. */
export function enRoute(anchorMs: number, eteMin: number, arriveBy = false): EnRoute {
  const d = eteMin * 60_000;
  return arriveBy ? { depMs: anchorMs - d, arrMs: anchorMs, eteMin } : { depMs: anchorMs, arrMs: anchorMs + d, eteMin };
}

// ── Units ──────────────────────────────────────────────────────────────────

export type UnitFamily = "distance" | "speed" | "temperature" | "weight" | "fuel" | "pressure";
export interface UnitDef { id: string; label: string; family: UnitFamily }

/** Linear families: the factor converts ONE unit to the family's base
 *  (metres · m/s · kg · hPa). Fuel goes through mass with a density. */
const FACTOR: Record<string, number> = {
  nm: 1852, km: 1000, sm: 1609.344, ft: 0.3048, m: 1,
  kt: 1852 / 3600, kmh: 1000 / 3600, mph: 1609.344 / 3600, ms: 1, fpm: 0.3048 / 60,
  lb: 0.45359237, kg: 1, t: 1000, klb: 453.59237,
  hpa: 1, inhg: 33.8638866667, mb: 1,
};

export const UNITS: UnitDef[] = [
  { id: "nm", label: "NM", family: "distance" }, { id: "sm", label: "SM", family: "distance" }, { id: "km", label: "km", family: "distance" }, { id: "ft", label: "ft", family: "distance" }, { id: "m", label: "m", family: "distance" },
  { id: "kt", label: "kt", family: "speed" }, { id: "kmh", label: "km/h", family: "speed" }, { id: "mph", label: "mph", family: "speed" }, { id: "ms", label: "m/s", family: "speed" }, { id: "fpm", label: "ft/min", family: "speed" },
  { id: "c", label: "°C", family: "temperature" }, { id: "f", label: "°F", family: "temperature" }, { id: "k", label: "K", family: "temperature" },
  { id: "lb", label: "lb", family: "weight" }, { id: "klb", label: "K lb", family: "weight" }, { id: "kg", label: "kg", family: "weight" }, { id: "t", label: "t (metric)", family: "weight" },
  { id: "flb", label: "lb", family: "fuel" }, { id: "fklb", label: "K lb", family: "fuel" }, { id: "fkg", label: "kg", family: "fuel" }, { id: "gal", label: "US gal", family: "fuel" }, { id: "l", label: "L", family: "fuel" },
  { id: "hpa", label: "hPa", family: "pressure" }, { id: "mb", label: "mb", family: "pressure" }, { id: "inhg", label: "inHg", family: "pressure" },
];
export const UNIT_FAMILIES: UnitFamily[] = ["distance", "speed", "temperature", "weight", "fuel", "pressure"];
export const unitsOf = (f: UnitFamily) => UNITS.filter((u) => u.family === f);

/** JP-8 / Jet A: about 6.7 lb per US gallon at 15 °C. Planning-grade. */
export const DEFAULT_FUEL_LB_PER_GAL = 6.7;
const L_PER_GAL = 3.785411784;

function toKelvin(v: number, u: string): number { return u === "c" ? v + 273.15 : u === "f" ? (v - 32) * 5 / 9 + 273.15 : v; }
function fromKelvin(k: number, u: string): number { return u === "c" ? k - 273.15 : u === "f" ? (k - 273.15) * 9 / 5 + 32 : k; }

/** Fuel to pounds (density `lbPerGal` for the volume units). */
function fuelToLb(v: number, u: string, lbPerGal: number): number {
  switch (u) {
    case "flb": return v;
    case "fklb": return v * 1000;
    case "fkg": return v / 0.45359237;
    case "gal": return v * lbPerGal;
    case "l": return (v / L_PER_GAL) * lbPerGal;
    default: return NaN;
  }
}
function lbToFuel(lb: number, u: string, lbPerGal: number): number {
  switch (u) {
    case "flb": return lb;
    case "fklb": return lb / 1000;
    case "fkg": return lb * 0.45359237;
    case "gal": return lb / lbPerGal;
    case "l": return (lb / lbPerGal) * L_PER_GAL;
    default: return NaN;
  }
}

/** Convert within a family; null when the units are of different families
 *  or the input is not a number (or a fuel density is not positive). */
export function convertUnit(value: number, from: string, to: string, lbPerGal = DEFAULT_FUEL_LB_PER_GAL): number | null {
  const a = UNITS.find((u) => u.id === from), b = UNITS.find((u) => u.id === to);
  if (!a || !b || a.family !== b.family || !Number.isFinite(value)) return null;
  if (a.family === "temperature") return fromKelvin(toKelvin(value, from), to);
  if (a.family === "fuel") {
    if (!(lbPerGal > 0)) return null;
    return lbToFuel(fuelToLb(value, from, lbPerGal), to, lbPerGal);
  }
  return (value * FACTOR[from]) / FACTOR[to];
}

/** A display number: enough significant digits to be useful, no float noise. */
export function fmtUnit(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const digits = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 4;
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
