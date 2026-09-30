// Spectrum inputs along the series — PURE, client-safe, unit-tested (PLAN
// §7 E1). The spectrum summary records the day's peak NOAA scale (swx:G/R/S),
// KEVs added per declared vendor (kev:<vendor>) and the worst IODA alert per
// tracked country (outage:<country>); this reads them: G-scale share of
// observed days, KEV cadence per vendor against its own normal, and one
// direction for the Glance tile. Environment and exposure stay environment
// and exposure — nothing here raises an I&W level.

import { direction, shareOfObserved, type SeriesPoint } from "./series";

export const KEV_CADENCE_MIN_PRIOR_DAYS = 14;
export const SCALE_SHARE_MIN_POINTS = 4;

export interface KevCadence {
  vendor: string;
  /** KEVs added in the last 7 calendar days. */
  thisWeek: number;
  /** Mean per observed prior day × 7; null below KEV_CADENCE_MIN_PRIOR_DAYS. */
  normalPerWeek: number | null;
  priorDays: number;
  label: string;
}

const dayMinus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

export function kevCadence(byVendor: Record<string, SeriesPoint[]>, today: string): KevCadence[] {
  const weekStart = dayMinus(today, 6);
  const out: KevCadence[] = [];
  for (const [vendor, series] of Object.entries(byVendor)) {
    const thisWeek = series.filter((p) => p.day >= weekStart && p.day <= today).reduce((s, p) => s + p.value, 0);
    const prior = series.filter((p) => p.day < weekStart);
    const normalPerWeek = prior.length >= KEV_CADENCE_MIN_PRIOR_DAYS ? (prior.reduce((s, p) => s + p.value, 0) / prior.length) * 7 : null;
    const label = normalPerWeek == null
      ? `${vendor}: ${thisWeek} this week · normal forming (${prior.length} of ${KEV_CADENCE_MIN_PRIOR_DAYS} prior days)`
      : `${vendor}: ${thisWeek} this week vs ~${normalPerWeek.toFixed(1)}/wk normal`;
    out.push({ vendor, thisWeek, normalPerWeek, priorDays: prior.length, label });
  }
  return out.sort((a, b) => b.thisWeek - a.thisWeek || a.vendor.localeCompare(b.vendor));
}

/** Share of observed days at or above `level` in the trailing 30; null below four points. */
export function scaleShare(series: SeriesPoint[], today: string, level = 1): { hits: number; observed: number; label: string } | null {
  if (series.length < SCALE_SHARE_MIN_POINTS) return null;
  const s = shareOfObserved(series, (v) => v >= level, today, 30);
  return { hits: s.hits, observed: s.observed, label: `G≥${level} on ${s.hits} of ${s.observed} obs days (30 d)` };
}

export interface SpectrumTrend {
  gShare: { hits: number; observed: number; label: string } | null;
  kev: KevCadence[];
  /** Direction of whichever series is driving: G when any storm day is on record, else KEV total. */
  direction: "rising" | "falling" | "flat" | null;
  line: string | null;
}

export function spectrumTrend(g: SeriesPoint[], kevByVendor: Record<string, SeriesPoint[]>, today: string): SpectrumTrend {
  const gShare = scaleShare(g, today, 1);
  const kev = kevCadence(kevByVendor, today);
  const kevTotal = new Map<string, number>();
  for (const s of Object.values(kevByVendor)) for (const p of s) kevTotal.set(p.day, (kevTotal.get(p.day) ?? 0) + p.value);
  const kevSeries = Array.from(kevTotal.entries()).map(([day, value]) => ({ day, value })).sort((a, b) => (a.day < b.day ? -1 : 1));
  const dir = gShare && gShare.hits > 0 ? direction(g, 14) : direction(kevSeries, 14);
  const parts: string[] = [];
  if (gShare) parts.push(gShare.label);
  for (const k of kev.filter((x) => x.normalPerWeek != null && (x.thisWeek > 0 || x.normalPerWeek! > 0)).slice(0, 2)) parts.push(k.label);
  return { gShare, kev, direction: dir, line: parts.length ? parts.join(" · ") : null };
}
