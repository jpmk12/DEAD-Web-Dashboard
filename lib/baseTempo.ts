// Per-base operating tempo — PURE, client-safe, unit-tested (PLAN §6 D1).
//
// The SITREP records four series per base per UTC day (lib/sensorKeys):
// fc: (observed flight-category ordinal), notam: (active NOTAM count),
// rwyclose: (1 on a day with a runway-closure window), xwind: (max
// crosswind kt). This reads them ALONG the series: IFR days this month vs
// last, NOTAM count direction, runway-closure share, crosswind days —
// construction season and a bad-weather month read here before they read
// as a LIMFAC. Every line is of OBSERVED days and says so; below four
// observed points a part says nothing.

import { direction, shareOfObserved, type SeriesPoint } from "./series";

export const TEMPO_MIN_POINTS = 4;
export const CROSSWIND_DAY_KT = 20;
/** fc ordinal at or above this is instrument conditions (IFR 2, LIFR 3). */
const IFR_ORDINAL = 2;

export interface TempoSeries { fc: SeriesPoint[]; notam: SeriesPoint[]; rwyclose: SeriesPoint[]; xwind: SeriesPoint[] }

export interface BaseTempo {
  ifrThisMonth: { hits: number; observed: number } | null;
  ifrLastMonth: { hits: number; observed: number } | null;
  notamDirection: "rising" | "falling" | "flat" | null;
  notamNow: number | null;
  rwyClosed: { hits: number; observed: number } | null;
  crosswind: { hits: number; observed: number } | null;
  /** Short evidence lines for the strip; empty when nothing has earned a claim. */
  lines: string[];
}

const dayMinus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

export function baseTempo(s: TempoSeries, today: string): BaseTempo {
  const lines: string[] = [];

  // IFR days: trailing 30 vs the 30 before.
  const fcRecent = s.fc.filter((p) => p.day > dayMinus(today, 30));
  const fcPrior = s.fc.filter((p) => p.day <= dayMinus(today, 30) && p.day > dayMinus(today, 60));
  const ifrThisMonth = fcRecent.length >= TEMPO_MIN_POINTS ? shareOfObserved(fcRecent, (v) => v >= IFR_ORDINAL, today, 30) : null;
  const ifrLastMonth = fcPrior.length >= TEMPO_MIN_POINTS ? shareOfObserved(fcPrior, (v) => v >= IFR_ORDINAL, dayMinus(today, 30), 30) : null;
  if (ifrThisMonth) {
    lines.push(`IFR ${ifrThisMonth.hits} of ${ifrThisMonth.observed} obs days (30 d)${ifrLastMonth ? ` vs ${ifrLastMonth.hits} of ${ifrLastMonth.observed} the month before` : ""}`);
  }

  // NOTAM tempo: direction of the count over the last fortnight of observations.
  const notamDirection = direction(s.notam, 14);
  const notamNow = s.notam.length ? s.notam[s.notam.length - 1].value : null;
  if (notamDirection && notamDirection !== "flat") lines.push(`NOTAM count ${notamDirection} (${s.notam.slice(-14).length} obs days)`);

  // Runway closures: share of observed days with a closure window.
  const rwyClosed = s.rwyclose.length >= TEMPO_MIN_POINTS ? shareOfObserved(s.rwyclose, (v) => v >= 1, today, 30) : null;
  if (rwyClosed && rwyClosed.hits > 0) lines.push(`RWY closure window ${rwyClosed.hits} of ${rwyClosed.observed} obs days (30 d)`);

  // Crosswind days at or above the advisory bar.
  const crosswind = s.xwind.length >= TEMPO_MIN_POINTS ? shareOfObserved(s.xwind, (v) => v >= CROSSWIND_DAY_KT, today, 30) : null;
  if (crosswind && crosswind.hits > 0) lines.push(`crosswind ≥${CROSSWIND_DAY_KT} kt ${crosswind.hits} of ${crosswind.observed} obs days`);

  return {
    ifrThisMonth: ifrThisMonth ? { hits: ifrThisMonth.hits, observed: ifrThisMonth.observed } : null,
    ifrLastMonth: ifrLastMonth ? { hits: ifrLastMonth.hits, observed: ifrLastMonth.observed } : null,
    notamDirection, notamNow,
    rwyClosed: rwyClosed ? { hits: rwyClosed.hits, observed: rwyClosed.observed } : null,
    crosswind: crosswind ? { hits: crosswind.hits, observed: crosswind.observed } : null,
    lines,
  };
}
