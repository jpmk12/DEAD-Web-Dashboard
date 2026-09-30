// LIMFAC recurrence and time-to-resolve — PURE, client-safe, unit-tested
// (PLAN §6 D3). The SITREP records limfac:<icao>:<fn> = 1 on days a mission
// function read PMC/NMC (auto or manual), so the auto-derived LIMFACs
// finally have a memory without being stored as rows; lib/chronicity reads
// that series exactly as it reads Force posture. Time-to-resolve comes from
// the manual register's timestamps — median days from creation to
// resolution per function, three resolved before a number.

import { classifyChronicity, type ChronicityResult } from "./chronicity";
import type { SeriesPoint } from "./series";

export const RESOLVE_MIN_N = 3;

export function functionChronicity(series: SeriesPoint[], todayElevated: boolean, today: string): ChronicityResult {
  return classifyChronicity(series.map((p) => ({ day: p.day, elevated: p.value >= 1 })), todayElevated, today);
}

export interface ResolveInput { fn: string; status: string; createdAt: string; updatedAt?: string | null }
export interface ResolveRead { fn: string; n: number; medianDays: number | null; label: string }

/** Median days to resolution per function over resolved manual LIMFACs. */
export function timeToResolve(rows: ResolveInput[]): ResolveRead[] {
  const byFn = new Map<string, number[]>();
  for (const r of rows) {
    if (r.status !== "resolved" || !r.updatedAt) continue;
    const a = Date.parse(r.createdAt), b = Date.parse(r.updatedAt);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
    (byFn.get(r.fn) ?? byFn.set(r.fn, []).get(r.fn)!).push((b - a) / 86_400_000);
  }
  const out: ResolveRead[] = [];
  for (const [fn, days] of byFn) {
    days.sort((x, y) => x - y);
    const n = days.length;
    if (n < RESOLVE_MIN_N) { out.push({ fn, n, medianDays: null, label: `${n} resolved — ${RESOLVE_MIN_N} needed for a typical time` }); continue; }
    const median = days[Math.floor((n - 1) / 2)];
    out.push({ fn, n, medianDays: median, label: `resolves in ~${median < 1 ? "<1" : Math.round(median)} d here (median of ${n})` });
  }
  return out.sort((a, b) => b.n - a.n);
}
