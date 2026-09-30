// TAF verification — PURE, client-safe, unit-tested (PLAN §4 B2).
//
// The SITREP records, per base per UTC day, the worst TAF category it saw
// forecast (`taf:<icao>`) and the worst METAR category it observed
// (`fc:<icao>`), both as ordinals (VFR 0 · MVFR 1 · IFR 2 · LIFR 3), day-
// peak. Paired days say how the field's TAF behaves: HIT (same category),
// OVER-forecast (TAF worse than observed — costs a plan), UNDER-forecast
// (observed worse than the TAF — the dangerous one, it costs a divert).
//
// Planning-grade and honest about its limits: day-worst against day-worst,
// and the observed side needs the app or the heartbeat to have run after
// the forecast hour. Below TAF_MIN_PAIRED days it is a tally.

import type { FlightCategory } from "./types";
import type { SeriesPoint } from "./series";
import { verdict } from "./series";

export const CAT_ORDINAL: Record<FlightCategory, number> = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3, UNKNOWN: -1 };
const CAT_BY_ORDINAL: FlightCategory[] = ["VFR", "MVFR", "IFR", "LIFR"];

export function catOrdinal(cat: FlightCategory | string | null | undefined): number | null {
  if (!cat) return null;
  const o = CAT_ORDINAL[cat as FlightCategory];
  return o == null || o < 0 ? null : o;
}

export function catFromOrdinal(o: number): FlightCategory | null {
  return CAT_BY_ORDINAL[Math.round(o)] ?? null;
}

export const TAF_MIN_PAIRED = 10;
export const TAF_UNDER_WARN = 0.2;

export interface TafSkill {
  paired: number;
  hit: number;
  over: number;
  under: number;
  /** under / paired, or null below TAF_MIN_PAIRED. */
  underRate: number | null;
  /** Under-forecast rate at or above TAF_UNDER_WARN with enough pairs. */
  warn: boolean;
  label: string;
}

export function tafVerification(fc: SeriesPoint[], taf: SeriesPoint[]): TafSkill {
  const obs = new Map(fc.map((p) => [p.day, p.value]));
  let paired = 0, hit = 0, over = 0, under = 0;
  for (const t of taf) {
    const o = obs.get(t.day);
    if (o == null || !Number.isFinite(o) || !Number.isFinite(t.value)) continue;
    paired++;
    const f = Math.round(t.value), a = Math.round(o);
    if (f === a) hit++;
    else if (f > a) over++;
    else under++;
  }
  if (paired < TAF_MIN_PAIRED) {
    return { paired, hit, over, under, underRate: null, warn: false, label: paired === 0 ? "TAF vs observed: no paired days yet" : `TAF vs observed: ${paired} of ${TAF_MIN_PAIRED} days paired so far` };
  }
  const underRate = under / paired;
  const hitV = verdict(hit, paired, TAF_MIN_PAIRED);
  const warn = underRate >= TAF_UNDER_WARN;
  return {
    paired, hit, over, under, underRate, warn,
    label: `TAF hit ${hitV.label} · over-forecast ${over} · under-forecast ${under}${warn ? " — under-forecasts here, plan the alternate" : ""}`,
  };
}
