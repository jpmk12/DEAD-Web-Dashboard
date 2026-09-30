// Crew availability along the series — PURE, client-safe, unit-tested
// (PLAN §6 D2). crew_state was overwritten in place; crew_state_daily keeps a
// LAST-policy snapshot per qual per UTC day, and this reads it: the
// squadron-wide availability series, its direction, and the join to the
// recorded demand outlooks — "demand rose against thin crews N of the last
// 30 observed days". Counts only, no names, same as the live table.

import { postureOf } from "./crewState";
import { direction, runLength, shareOfObserved, type SeriesPoint } from "./series";

export interface CrewDayRow { day: string; qual: string; total: number; crewRest: number; onMission: number; dnif: number; other: number }
export interface DemandDayRow { day: string; aor: string; direction: "rise" | "hold" | "fall" }

export interface CrewTrend {
  /** Squadron-wide availability per observed day (available / total). */
  series: { day: string; available: number; total: number; fraction: number | null }[];
  direction: "rising" | "falling" | "flat" | null;
  /** Consecutive observed days at thin or critical, newest back. */
  thinRun: number;
  /** Days demand was RISING somewhere while availability was thin/critical. */
  mismatch: { hits: number; observed: number } | null;
  line: string | null;
}

export const CREW_TREND_MIN_DAYS = 4;

export function crewTrend(rows: CrewDayRow[], demand: DemandDayRow[], today: string): CrewTrend {
  const byDay = new Map<string, { available: number; total: number }>();
  for (const r of rows) {
    const outs = r.crewRest + r.onMission + r.dnif + r.other;
    const available = outs > r.total ? 0 : r.total - outs;
    const e = byDay.get(r.day) ?? { available: 0, total: 0 };
    e.available += available; e.total += r.total;
    byDay.set(r.day, e);
  }
  const series = Array.from(byDay.entries())
    .map(([day, e]) => ({ day, ...e, fraction: e.total > 0 ? e.available / e.total : null }))
    .filter((p) => p.total > 0)
    .sort((a, b) => (a.day < b.day ? -1 : 1));
  if (series.length < CREW_TREND_MIN_DAYS) {
    return { series, direction: null, thinRun: 0, mismatch: null, line: series.length ? `${series.length} observed day${series.length === 1 ? "" : "s"} of crew history — trend forms at ${CREW_TREND_MIN_DAYS}` : null };
  }
  const frac: SeriesPoint[] = series.map((p) => ({ day: p.day, value: p.fraction ?? 0 }));
  const dir = direction(frac, 14);
  const thinRun = runLength(frac, (v) => postureOf(v) === "thin" || postureOf(v) === "critical");

  const risingDays = new Set(demand.filter((d) => d.direction === "rise").map((d) => d.day));
  const joined = frac.filter((p) => risingDays.has(p.day) || demand.some((d) => d.day === p.day));
  const mismatchShare = joined.length ? shareOfObserved(joined, (v) => false, today, 30) : null;
  const mismatchHits = joined.filter((p) => risingDays.has(p.day) && (postureOf(p.value) === "thin" || postureOf(p.value) === "critical") && p.day > new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10)).length;
  const mismatch = mismatchShare ? { hits: mismatchHits, observed: mismatchShare.observed } : null;

  const parts: string[] = [];
  const last = series[series.length - 1];
  parts.push(`availability ${last.available} of ${last.total}${dir && dir !== "flat" ? `, ${dir} over the last fortnight` : ""}`);
  if (thinRun >= 2) parts.push(`thin/critical ${thinRun} observed days running`);
  if (mismatch && mismatch.observed > 0) parts.push(`demand rose against thin crews ${mismatch.hits} of ${mismatch.observed} obs days (30 d)`);
  return { series, direction: dir, thinRun, mismatch, line: parts.join(" · ") };
}
