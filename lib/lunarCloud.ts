// Cloud over the dark hours — PURE, client-safe, tested in tests/lunarCloud.test.ts.
//
// The lunar budget (lib/moon.ts) says how much moonlight is ABOVE the sky;
// cloud says how much reaches the ground. The two are kept separate on
// purpose: the budget is astronomy (good for a month, computed), cloud is a
// model forecast (good for a week, fetched). A night is never re-banded by
// cloud — a 97 % moon behind overcast is still a HIGH-illumination night on
// the calendar; the overlay says "moonlight attenuated", and the planner
// decides. Classes follow the aviation sky-cover ladder so the line reads
// like a METAR: CLR < 6 % · FEW < 31 % · SCT < 56 % · BKN < 88 % · OVC.

import { zoneDayStartMs } from "./effectiveZone";
import type { LunarNight } from "./moon";

export interface HourlyCloud { time: string; pct: number | null }

export type SkyCover = "CLR" | "FEW" | "SCT" | "BKN" | "OVC";

export interface NightCloud {
  meanPct: number;
  minPct: number;
  maxPct: number;
  /** Hourly samples that fell inside the dark interval. */
  samples: number;
  cover: SkyCover;
  /** Hours (of the dark interval) the model has ≥ OVC_PCT cloud. */
  overcastH: number;
  /** Hours the model has < SCT_PCT cloud — where the moon (or its absence) counts. */
  clearH: number;
}

export const OVC_PCT = 88;
export const SCT_PCT = 31;

export function skyCover(pct: number): SkyCover {
  if (pct < 6) return "CLR";
  if (pct < 31) return "FEW";
  if (pct < 56) return "SCT";
  if (pct < OVC_PCT) return "BKN";
  return "OVC";
}

/** Open-Meteo hourly `cloud_cover` → rows. Local times ("2026-10-26T18:00")
 *  are kept as strings; a missing or non-finite value reads null. */
export function parseHourlyCloud(json: unknown): HourlyCloud[] {
  const h = (json as { hourly?: { time?: unknown; cloud_cover?: unknown } })?.hourly;
  if (!h || !Array.isArray(h.time)) return [];
  const pct = Array.isArray(h.cloud_cover) ? h.cloud_cover : [];
  return (h.time as unknown[]).map((t, i) => {
    const v = Number(pct[i]);
    return { time: String(t), pct: Number.isFinite(v) && pct[i] != null ? Math.max(0, Math.min(100, Math.round(v))) : null };
  });
}

/** A local ISO hour in `zone` → ms. Planning-grade: a DST step at midnight
 *  shifts that night's hours by one, which a cloud mean survives. */
export function localIsoToMs(iso: string, zone: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  try { return zoneDayStartMs(m[1], zone) + Number(m[2]) * 3_600_000 + Number(m[3]) * 60_000; } catch { return null; }
}

/** Cloud over the night's dark interval (EENT → BMNT). null when the night
 *  has no darkness or the forecast does not cover it — a missing forecast
 *  is UNKNOWN, never clear. Each hourly sample stands for the hour that
 *  begins at its stamp. */
export function nightCloud(night: LunarNight, hourly: HourlyCloud[], zone: string): NightCloud | null {
  if (night.polar || night.eent == null || night.bmnt == null || night.bmnt <= night.eent) return null;
  const vals: number[] = [];
  for (const h of hourly) {
    if (h.pct == null) continue;
    const ms = localIsoToMs(h.time, zone);
    if (ms == null) continue;
    // Count the hour when it overlaps the dark interval.
    if (ms + 3_600_000 > night.eent && ms < night.bmnt) vals.push(h.pct);
  }
  if (vals.length === 0) return null;
  const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    meanPct: Math.round(mean),
    minPct: Math.min(...vals),
    maxPct: Math.max(...vals),
    samples: vals.length,
    cover: skyCover(mean),
    overcastH: r1(vals.filter((v) => v >= OVC_PCT).length),
    clearH: r1(vals.filter((v) => v < SCT_PCT).length),
  };
}

/** One clause for the tonight sentence. */
export function nightCloudClause(c: NightCloud | null): string {
  if (!c) return "cloud: no forecast for the dark hours";
  const span = c.minPct === c.maxPct ? `${c.meanPct}%` : `${c.meanPct}% (${c.minPct}–${c.maxPct}%)`;
  const read = c.cover === "OVC" ? "moonlight attenuated — plan darker than the budget"
    : c.cover === "BKN" ? "moonlight patchy"
    : c.cover === "CLR" || c.cover === "FEW" ? "moonlight reaches the ground"
    : "mostly reaches the ground";
  return `cloud ${span} ${c.cover} over the dark hours (model) — ${read}`;
}
