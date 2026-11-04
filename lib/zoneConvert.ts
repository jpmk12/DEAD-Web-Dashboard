// Time-zone converter — PURE, client-safe, tested (tests/zoneConvert.test.ts).
//
// Zulu ↔ any IANA zone, both ways, DST-aware, from the browser's own zone
// database (Intl). Three rules, stated once:
//   • A wall time is resolved by `resolveWall` (lib/plannerTools): the
//     spring-forward hour does not exist on that clock and is SAID (read as
//     the instant after the gap); the fall-back hour happens twice and is
//     SAID (the first by default, the second on request). Never a silent pick.
//   • DST state is read from the zone's own offsets that year — standard is
//     the smaller of January's and July's offset (works south of the equator,
//     where DST runs over January). A zone whose two agree observes no DST.
//   • A typed abbreviation names the DST-AWARE zone ("EST" → America/New_York,
//     which shows EDT in summer) and says so: IANA's own "EST" is a FIXED
//     UTC−5 that never changes, which is never what a planner typing EST means.
//     A military letter ("C") is a fixed offset and says that too.

import { formatUtcOffset } from "./worldClocks";

// ── Offsets (one cached formatter per zone — the change scan calls this ~400× per zone)

const FMT = new Map<string, Intl.DateTimeFormat>();
function fmtFor(zone: string): Intl.DateTimeFormat | null {
  let f = FMT.get(zone);
  if (f) return f;
  try {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return null; }
  FMT.set(zone, f);
  return f;
}

/** The zone's offset from UTC at an instant, in minutes; null for an unknown zone. */
export function offsetAt(ms: number, zone: string): number | null {
  const f = fmtFor(zone);
  if (!f) return null;
  const p = f.formatToParts(new Date(ms)).reduce<Record<string, number>>((acc, x) => { if (x.type !== "literal") acc[x.type] = Number(x.value); return acc; }, {});
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute);
  return Math.round((asUtc - Math.floor(ms / 60_000) * 60_000) / 60_000);
}

// ── DST state ──────────────────────────────────────────────────────────────

export interface DstInfo {
  /** The zone changes its clocks in this year. */
  observes: boolean;
  /** At this instant the zone is on its summer (DST) offset. */
  isDst: boolean;
  offset: number;
  stdOffset: number;
  dstOffset: number | null;
}

export function dstInfo(ms: number, zone: string): DstInfo | null {
  const off = offsetAt(ms, zone);
  if (off == null) return null;
  const y = new Date(ms).getUTCFullYear();
  const jan = offsetAt(Date.UTC(y, 0, 1, 12), zone) ?? off;
  const jul = offsetAt(Date.UTC(y, 6, 1, 12), zone) ?? off;
  const observes = jan !== jul;
  const std = Math.min(jan, jul);
  return { observes, isDst: observes && off > std, offset: off, stdOffset: std, dstOffset: observes ? Math.max(jan, jul) : null };
}

/** "DST" / "standard" / "no DST" — the word a row shows. */
export function dstWord(d: DstInfo | null): string {
  if (!d) return "—";
  if (!d.observes) return "no DST";
  return d.isDst ? "DST" : "standard";
}

// ── Clock changes ──────────────────────────────────────────────────────────

export interface ZoneChange {
  /** The instant the change takes effect. */
  ms: number;
  fromOffset: number;
  toOffset: number;
  /** Positive = clocks go forward (spring), negative = back (fall). */
  shiftMin: number;
  /** Local date of the change, "2026-03-08". */
  ymd: string;
  /** The local clock just as the change hits, on the old and the new offset: "02:00" → "03:00". */
  wallFrom: string;
  wallTo: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
function wallOf(ms: number, offsetMin: number): { ymd: string; hhmm: string } {
  const d = new Date(ms + offsetMin * 60_000);
  return { ymd: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, hhmm: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
}

/** Bisect to the minute between a and b where the offset changes. */
function findEdge(a: number, b: number, zone: string, offA: number): number {
  while (b - a > 60_000) {
    const mid = Math.floor((a + b) / 2 / 60_000) * 60_000;
    if (offsetAt(mid, zone) === offA) a = mid; else b = mid;
  }
  return b;
}

/** The clock changes in (fromMs, fromMs + horizon], oldest first. A day step
 *  (no real zone changes twice inside 24 h), then a minute bisection. */
export function zoneChanges(fromMs: number, zone: string, horizonDays = 400, max = 4): ZoneChange[] {
  const out: ZoneChange[] = [];
  const start = offsetAt(fromMs, zone);
  if (start == null) return out;
  let prev: number = start;
  const DAY = 86_400_000;
  for (let t = fromMs; t < fromMs + horizonDays * DAY && out.length < max; t += DAY) {
    const next = offsetAt(t + DAY, zone);
    if (next == null) break;
    if (next !== prev) {
      const ms = findEdge(t, t + DAY, zone, prev);
      const to: number = offsetAt(ms, zone) ?? next;
      const w0 = wallOf(ms, prev), w1 = wallOf(ms, to);
      out.push({ ms, fromOffset: prev, toOffset: to, shiftMin: to - prev, ymd: w0.ymd, wallFrom: w0.hhmm, wallTo: w1.hhmm });
      prev = to;
    }
  }
  return out;
}

export function nextZoneChange(fromMs: number, zone: string, horizonDays = 400): ZoneChange | null {
  return zoneChanges(fromMs, zone, horizonDays, 1)[0] ?? null;
}

/** "Sun 08 Mar 2026 · 02:00 → 03:00 (+1 h, UTC−5 → UTC−4)" */
export function zoneChangeLine(c: ZoneChange): string {
  const d = new Date(`${c.ymd}T12:00:00Z`);
  const wd = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const mon = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const a = Math.abs(c.shiftMin);
  const shift = `${c.shiftMin > 0 ? "+" : "−"}${a % 60 ? `${Math.floor(a / 60) ? `${Math.floor(a / 60)} h ` : ""}${a % 60} min` : `${a / 60} h`}`;
  return `${wd} ${c.ymd.slice(8)} ${mon} ${c.ymd.slice(0, 4)} · ${c.wallFrom} → ${c.wallTo} (${shift}, ${formatUtcOffset(c.fromOffset)} → ${formatUtcOffset(c.toOffset)})`;
}

// ── Abbreviations ──────────────────────────────────────────────────────────

/** The zone's own short name at that instant ("EDT", "CEST", "BST", "JST"),
 *  or null when the browser has none and would only print "GMT+3" — the
 *  offset column already says that. */
export function zoneAbbrev(ms: number, zone: string): string | null {
  if (zone === "UTC" || zone === "Etc/UTC") return "UTC";
  for (const loc of ["en-US", "en-GB"]) {
    try {
      const n = new Intl.DateTimeFormat(loc, { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value;
      if (n && !/^(GMT|UTC)/.test(n)) return n;
    } catch { return null; }
  }
  return null;
}

// ── Zone list and typed input ──────────────────────────────────────────────

const FALLBACK_ZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
  "America/Halifax", "America/Sao_Paulo", "Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin", "Europe/Rome", "Europe/Madrid",
  "Europe/Warsaw", "Europe/Athens", "Europe/Istanbul", "Europe/Kyiv", "Europe/Moscow", "Africa/Cairo", "Africa/Djibouti", "Africa/Nairobi", "Africa/Lagos",
  "Asia/Amman", "Asia/Jerusalem", "Asia/Baghdad", "Asia/Riyadh", "Asia/Kuwait", "Asia/Qatar", "Asia/Bahrain", "Asia/Dubai", "Asia/Tehran", "Asia/Kabul",
  "Asia/Karachi", "Asia/Kolkata", "Asia/Kathmandu", "Asia/Dhaka", "Asia/Bangkok", "Asia/Singapore", "Asia/Manila", "Asia/Shanghai", "Asia/Taipei", "Asia/Seoul",
  "Asia/Tokyo", "Pacific/Guam", "Australia/Darwin", "Australia/Adelaide", "Australia/Sydney", "Pacific/Auckland",
];

/** Every zone this browser knows (UTC first); a short fallback list where the engine cannot enumerate. */
export function allZones(): string[] {
  const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  let list: string[] = [];
  try { list = sv ? sv("timeZone") : []; } catch { list = []; }
  if (!list.length) list = FALLBACK_ZONES;
  return ["UTC", ...list.filter((z) => z !== "UTC")];
}

/** Abbreviations that name ONE DST-aware zone. Ambiguous ones (AST, IST,
 *  CST-for-China, BST-for-Bangladesh) are deliberately absent — guessing
 *  which one the writer meant is the error a converter exists to prevent. */
const ABBREV_ZONE: Record<string, string> = {
  EST: "America/New_York", EDT: "America/New_York", ET: "America/New_York",
  CST: "America/Chicago", CDT: "America/Chicago", CT: "America/Chicago",
  MST: "America/Denver", MDT: "America/Denver", MT: "America/Denver",
  PST: "America/Los_Angeles", PDT: "America/Los_Angeles", PT: "America/Los_Angeles",
  AKST: "America/Anchorage", AKDT: "America/Anchorage", HST: "Pacific/Honolulu",
  GMT: "Europe/London", BST: "Europe/London", WET: "Europe/Lisbon", WEST: "Europe/Lisbon",
  CET: "Europe/Berlin", CEST: "Europe/Berlin", EET: "Europe/Athens", EEST: "Europe/Athens",
  MSK: "Europe/Moscow", JST: "Asia/Tokyo", KST: "Asia/Seoul", AEST: "Australia/Sydney", AEDT: "Australia/Sydney",
  NZST: "Pacific/Auckland", NZDT: "Pacific/Auckland", ChST: "Pacific/Guam",
};

const MIL_EAST = "ABCDEFGHIKLM", MIL_WEST = "NOPQRSTUVWXY";

export interface ZoneInput { zone: string; label: string; note: string | null }

/** A typed zone → an IANA id: "Zulu" / "Z" / "UTC"; an IANA id in any case;
 *  a city ("tehran", "new york"); a single military letter (a FIXED offset,
 *  said so); an unambiguous abbreviation (the DST-aware zone, said so). Null
 *  when nothing matches — never the nearest guess. */
export function resolveZoneInput(raw: string, zones: string[] = allZones()): ZoneInput | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const up = s.toUpperCase();
  if (["Z", "ZULU", "UTC", "GMT+0", "UTC+0", "ETC/UTC"].includes(up)) return { zone: "UTC", label: "Zulu", note: null };
  if (/^[A-IK-Y]$/.test(up)) {
    const east = MIL_EAST.indexOf(up), west = MIL_WEST.indexOf(up);
    const h = east >= 0 ? east + 1 : -(west + 1);
    // Etc/GMT signs are inverted: Etc/GMT-3 is UTC+3.
    const zone = `Etc/GMT${h > 0 ? "-" : "+"}${Math.abs(h)}`;
    return { zone, label: `${up} (${formatUtcOffset(h * 60)})`, note: `“${up}” is a fixed ${formatUtcOffset(h * 60)} — a letter zone never changes for DST; name the place for its local clock.` };
  }
  const ab = Object.keys(ABBREV_ZONE).find((k) => k.toUpperCase() === up);
  if (ab) {
    const zone = ABBREV_ZONE[ab];
    return { zone, label: cityOf(zone), note: `“${ab}” read as ${zone}, which follows DST — the clock shows its summer or winter name by date.` };
  }
  const exact = zones.find((z) => z.toLowerCase() === s.toLowerCase());
  if (exact) return { zone: exact, label: cityOf(exact), note: null };
  const key = s.toLowerCase().replace(/[\s-]+/g, "_");
  const byCity = zones.filter((z) => (z.split("/").pop() ?? "").toLowerCase() === key);
  if (byCity.length === 1) return { zone: byCity[0], label: cityOf(byCity[0]), note: null };
  if (byCity.length > 1) return { zone: byCity[0], label: cityOf(byCity[0]), note: `${byCity.length} zones are named “${s}” — using ${byCity[0]}.` };
  return null;
}

/** "America/New_York" → "New York"; "UTC" → "Zulu"; "Etc/GMT-3" → "UTC+3". */
export function cityOf(zone: string): string {
  if (zone === "UTC" || zone === "Etc/UTC") return "Zulu";
  const etc = /^Etc\/GMT([+-])(\d{1,2})$/.exec(zone);
  if (etc) return formatUtcOffset((etc[1] === "-" ? 1 : -1) * Number(etc[2]) * 60);
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}
