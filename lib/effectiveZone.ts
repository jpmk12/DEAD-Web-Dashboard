// The one rule for "which time zone is today" — PURE, client-safe, tested.
//
// Found in the 2026-10-05 Glance walkthrough: a 10:00 event in Jordan rendered
// as "3:00 AM" because the laptop's clock was still on New Jersey time while
// the operator was TDY in Amman. The arithmetic was right; the zone was wrong
// for where the operator was, and no label said which zone it was. Two rules
// follow, and this module holds both so the Glance rail, the brief's
// schedule, the prefetch and the modal cannot disagree:
//
//   1. In Auto mode an ACTIVE TRIP's zone wins over the device zone. A
//      declared TDY is a stronger statement of "where I am" than the clock
//      on a laptop that may never have been changed. Pinned mode still
//      overrides everything — a pin is explicit.
//   2. A time is never shown without its zone label. `zoneLabel` gives the
//      short name ("EDT", "GMT+3") for the instant in question.
//
// Day bucketing (Today / Tomorrow) has to follow the same zone, so the
// calendar-day helpers live here too and take the zone explicitly.

import { isValidTz, utcOffsetMinutes } from "./worldClocks";

export type ZoneSource = "pinned" | "trip" | "device" | "pref" | "default";

export interface ZoneInput {
  /** `prefs.timezoneMode` — "pinned" or anything else (auto). */
  mode?: string | null;
  /** `prefs.timezone` — the saved/pinned zone. */
  pref?: string | null;
  /** The device zone the client reported. */
  device?: string | null;
  /** The active trip's zone, when there is one and it is known. */
  trip?: string | null;
  fallback?: string;
}

export const DEFAULT_ZONE = "America/Chicago";

/** Resolve the effective zone and say where it came from. */
export function resolveZone(i: ZoneInput): { zone: string; source: ZoneSource } {
  const ok = (z: string | null | undefined): z is string => typeof z === "string" && z.length > 0 && isValidTz(z);
  const fallback = i.fallback && ok(i.fallback) ? i.fallback : DEFAULT_ZONE;
  if (i.mode === "pinned") {
    if (ok(i.pref)) return { zone: i.pref, source: "pinned" };
    if (ok(i.device)) return { zone: i.device, source: "device" };
    return { zone: fallback, source: "default" };
  }
  if (ok(i.trip)) return { zone: i.trip, source: "trip" };
  if (ok(i.device)) return { zone: i.device, source: "device" };
  if (ok(i.pref)) return { zone: i.pref, source: "pref" };
  return { zone: fallback, source: "default" };
}

/** Short zone name for an instant: "EDT", "GMT+3", "UTC". Never throws. */
export function zoneLabel(zone: string, atMs: number = Date.now()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
      .formatToParts(new Date(atMs)).find((p) => p.type === "timeZoneName");
    return part?.value ?? zone;
  } catch { return zone; }
}

/** The calendar date (YYYY-MM-DD) of an instant in a zone. */
export function ymdInZone(ms: number, zone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** YYYY-MM-DD plus n days, as calendar arithmetic (no zone needed). */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, (m || 1) - 1, (d || 1) + n);
  return new Date(t).toISOString().slice(0, 10);
}

/** The instant (ms) at which `ymd` begins in `zone`. Two passes so a DST
 *  change on that very day resolves to the right offset. */
export function zoneDayStartMs(ymd: string, zone: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  let off: number;
  try { off = utcOffsetMinutes(new Date(guess), zone); } catch { return guess; }
  let start = guess - off * 60_000;
  const off2 = utcOffsetMinutes(new Date(start), zone);
  if (off2 !== off) start = guess - off2 * 60_000;
  return start;
}

/** The last ms of `ymd` in `zone`. */
export function zoneDayEndMs(ymd: string, zone: string): number {
  return zoneDayStartMs(addDays(ymd, 1), zone) - 1;
}

/** "h:mm AM" for an instant in a zone. */
export function timeInZone(ms: number, zone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(ms));
  } catch { return ""; }
}
