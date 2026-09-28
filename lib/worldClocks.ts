// World clocks for the Glance header — PURE, client-safe, unit-tested.
//
// A mobility commander lives in several clocks at once: the home station,
// the adversaries' capitals, and Zulu. The row answers "what time is it
// THERE, and is it their day or night" without arithmetic. Everything is
// derived with Intl from one instant, so the five clocks can never disagree
// with each other or with the device.

export interface ClockDef { label: string; tz: string }

export const DEFAULT_CLOCKS: ClockDef[] = [
  { label: "New Jersey", tz: "America/New_York" },
  { label: "Moscow", tz: "Europe/Moscow" },
  { label: "Tehran", tz: "Asia/Tehran" },
  { label: "Beijing", tz: "Asia/Shanghai" },
  { label: "Zulu", tz: "UTC" },
];

export interface ClockView extends ClockDef {
  time: string;        // "14:05"
  weekday: string;     // "Mon"
  hour: number;        // 0-23 in that zone
  /** That zone's calendar day relative to the device's: -1, 0, +1. */
  dayOffset: number;
  isNight: boolean;    // 18:00–05:59 local
  /** "UTC+3", "UTC−4:30", "UTC" */
  utcOffset: string;
  valid: boolean;
}

export function isValidTz(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

const dayNumber = (d: Date, tz: string): number => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const [y, m, dd] = p.split("-").map(Number);
  return Date.UTC(y, m - 1, dd) / 86_400_000;
};

/** Offset of `tz` from UTC at instant `d`, in minutes. */
export function utcOffsetMinutes(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(d).reduce<Record<string, number>>((acc, p) => { if (p.type !== "literal") acc[p.type] = Number(p.value); return acc; }, {});
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return Math.round((asUtc - Math.floor(d.getTime() / 60_000) * 60_000) / 60_000);
}

export function formatUtcOffset(minutes: number): string {
  if (minutes === 0) return "UTC";
  const sign = minutes > 0 ? "+" : "−";
  const h = Math.floor(Math.abs(minutes) / 60), m = Math.abs(minutes) % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

export function renderClock(nowMs: number, def: ClockDef, deviceTz: string): ClockView {
  if (!isValidTz(def.tz)) {
    return { ...def, time: "--:--", weekday: "", hour: 0, dayOffset: 0, isNight: false, utcOffset: "", valid: false };
  }
  const d = new Date(nowMs);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: def.tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(d);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: def.tz, weekday: "short" }).format(d);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: def.tz, hourCycle: "h23", hour: "2-digit" }).format(d));
  const dayOffset = isValidTz(deviceTz) ? dayNumber(d, def.tz) - dayNumber(d, deviceTz) : 0;
  return {
    ...def, time, weekday, hour, dayOffset,
    isNight: hour < 6 || hour >= 18,
    utcOffset: formatUtcOffset(utcOffsetMinutes(d, def.tz)),
    valid: true,
  };
}

export function renderClocks(nowMs: number, defs: ClockDef[], deviceTz: string): ClockView[] {
  return defs.map((c) => renderClock(nowMs, c, deviceTz));
}
