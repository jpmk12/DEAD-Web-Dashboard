// Cloudflare Radar — the NetFlows traffic timeseries per country (PURE,
// client-safe, tested in tests/radarNetflows.test.ts). The outage
// annotations are CURATED (a human at Cloudflare wrote them up); this is
// the raw signal underneath — total traffic Cloudflare sees from a country,
// hour by hour. It answers "is the country's internet carrying its usual
// traffic right now" without waiting for a write-up, and corroborates an
// annotation with a second kind of evidence.
//
// The read is HOUR-MATCHED: the last RECENT_HOURS hourly samples against
// the SAME hours of the day on the prior days in the window (a diurnal
// curve compared to itself — Monday 0300 is compared with 0300, never with
// the daytime mean). Median everywhere, never mean (the household rule).
//
// Normalization — what the values MEAN depends on what the API agreed to
// send, and the read branches on `series.normalization`:
//   - RAW_VALUES (the fallback — production REFUSED it, 2026-10-27): a ratio
//     read. `TRAFFIC_DOWN` ≤ 0.6 is well outside ordinary day-to-day
//     variance on a national series; `TRAFFIC_COLLAPSED` ≤ 0.25 is a
//     shutdown-class drop.
//   - MIN0_MAX / MIN_MAX (asked first — the one production ACCEPTS): every value is
//     (v − min) / (max − min) over the window, so the nightly trough reads 0
//     and a RATIO of two values is amplified (a 20 % daytime dip can read
//     60 %). A ratio is therefore never claimed; the read is the DROP in
//     range units — median(matched prior hours) − median(recent) —
//     `NORM_DROP_DOWN` ≥ 0.35 of the window's whole range below the same
//     hours is a real abnormal drop, `NORM_DROP_COLLAPSED` ≥ 0.7 with the
//     recent level itself near the floor is a collapse. `ratio` is null and
//     the why says "range units".
//   - PERCENTAGE_CHANGE was the first attempt and the API REFUSED it (2001
//     "Must have 1 comparison series to compare against", 2026-10-27): it
//     compares two series, it is not a reference-constant normalization.
//     Kept parseable (p → 1 + p/100) for a body that carries it anyway.
//
// Disciplines: below MIN_BASELINE_DAYS matched days the read is `learning`
// (a tally, never a ratio); a last sample older than STALE_HOURS is
// `unknown` ("series stale"); a feed that did not answer is the CALLER's
// UNKNOWN. A traffic drop never re-levels an outage annotation — it is a
// second kind of evidence, said beside it.
//
// Data © Cloudflare, CC BY-NC 4.0 — attribution is rendered wherever shown.

export interface TrafficSeries {
  /** Epoch ms, ascending. */
  timestamps: number[];
  /** The level per sample — raw, normalized 0..1, or 1 + p/100 by `normalization`. */
  values: number[];
  aggInterval: string;
  /** Upper-cased as the API reported it ("" when the body did not say). */
  normalization: string;
  lastUpdatedMs: number | null;
}

export type TrafficState = "normal" | "down" | "collapsed" | "learning" | "unknown";

export interface TrafficRead {
  state: TrafficState;
  /** median(recent) / median(hour-matched prior days); null for a normalized series, or when unknown / learning. */
  ratio: number | null;
  /** For a MIN0_MAX series: median(matched) − median(recent) in range units; null otherwise. */
  drop: number | null;
  recentHours: number;
  /** How many prior days every recent hour could be matched against. */
  baselineDays: number;
  lastSampleMs: number | null;
  why: string;
}

export const RECENT_HOURS = 6;
export const MIN_BASELINE_DAYS = 3;
export const STALE_HOURS = 4;
export const TRAFFIC_DOWN = 0.6;
export const TRAFFIC_COLLAPSED = 0.25;
export const NORM_DROP_DOWN = 0.35;
export const NORM_DROP_COLLAPSED = 0.7;
export const NORM_FLOOR = 0.1;

/** The normalizations the fetcher asks for, in order of preference.
 *  MIN0_MAX leads because production ACCEPTED it and REFUSED RAW_VALUES
 *  (2026-10-27, second diag) — asking RAW_VALUES first spent one refused
 *  request per country on every fresh process. RAW_VALUES stays as the
 *  fallback in case the API's acceptance changes; the read branches on
 *  what the body says, not on what was asked. */
export const NETFLOWS_NORMALIZATIONS = ["MIN0_MAX", "RAW_VALUES"] as const;

const num = (v: unknown): number | null => { const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN; return Number.isFinite(n) ? n : null; };
/** A Radar timestamp → epoch ms. The BGP rows arrived ZONE-LESS in
 *  production ("2026-10-27T07:15:30.048"); JavaScript reads such a stamp as
 *  LOCAL time, so a date-time with no Z / offset is pinned to UTC here (Radar
 *  reports in UTC). A date-only string and a stamped one are left as-is. */
export function parseUtc(s: unknown): number | null {
  if (typeof s !== "string" || !s) return null;
  const v = s.trim();
  const t = Date.parse(/T\d{2}:\d{2}/.test(v) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(v) ? `${v}Z` : v);
  return Number.isFinite(t) ? t : null;
}
const ms = parseUtc;

export const isNormalizedRange = (normalization: string) => /^MIN0?_MAX$/.test(normalization);

/** `result.serie_0` (or the first `serie_*` / named series) → a TrafficSeries,
 *  or null when nothing series-shaped is there. Pairs with a non-finite
 *  value or an unparseable timestamp are dropped; under PERCENTAGE_CHANGE a
 *  value below −100 is dropped and the rest become 1 + p/100; under any
 *  other normalization a negative value is dropped (traffic is not). */
export function parseNetflows(json: unknown): TrafficSeries | null {
  const result = (json as { result?: Record<string, unknown> } | null)?.result;
  if (!result || typeof result !== "object") return null;
  const meta = (result.meta ?? {}) as Record<string, unknown>;
  const serie = (result.serie_0 ?? Object.entries(result).find(([k, v]) => k !== "meta" && v && typeof v === "object" && Array.isArray((v as { timestamps?: unknown }).timestamps))?.[1]) as { timestamps?: unknown; values?: unknown } | undefined;
  if (!serie || !Array.isArray(serie.timestamps) || !Array.isArray(serie.values)) return null;
  const normalization = typeof meta.normalization === "string" ? meta.normalization.trim().toUpperCase() : "";
  const pct = normalization === "PERCENTAGE_CHANGE";
  const n = Math.min(serie.timestamps.length, serie.values.length);
  const pairs: { t: number; v: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = ms(serie.timestamps[i]);
    const p = num(serie.values[i]);
    if (t == null || p == null) continue;
    if (pct) { if (p < -100) continue; pairs.push({ t, v: 1 + p / 100 }); }
    else { if (p < 0) continue; pairs.push({ t, v: p }); }
  }
  pairs.sort((a, b) => a.t - b.t);
  return {
    timestamps: pairs.map((p) => p.t),
    values: pairs.map((p) => p.v),
    aggInterval: typeof meta.aggInterval === "string" ? meta.aggInterval : "",
    normalization,
    lastUpdatedMs: ms(meta.lastUpdated),
  };
}

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** The hour-matched read at `nowMs`. */
export function trafficRead(series: TrafficSeries | null, nowMs: number, opts: { recentHours?: number; minBaselineDays?: number } = {}): TrafficRead {
  const recentHours = opts.recentHours ?? RECENT_HOURS;
  const minDays = opts.minBaselineDays ?? MIN_BASELINE_DAYS;
  const empty = (why: string, state: TrafficState = "unknown"): TrafficRead => ({ state, ratio: null, drop: null, recentHours, baselineDays: 0, lastSampleMs: series?.timestamps.at(-1) ?? null, why });
  if (!series || !series.timestamps.length) return empty("no traffic series");
  const last = series.timestamps[series.timestamps.length - 1];
  if (nowMs - last > STALE_HOURS * 3_600_000) return empty(`series stale — last sample ${Math.round((nowMs - last) / 3_600_000)} h ago`);
  const at = new Map<number, number>();
  for (let i = 0; i < series.timestamps.length; i++) at.set(series.timestamps[i], series.values[i]);
  const recent: number[] = [];
  const base: number[] = [];
  let minMatched = Infinity;
  for (let k = 0; k < recentHours; k++) {
    const t = last - k * 3_600_000;
    const v = at.get(t);
    if (v == null) continue;
    recent.push(v);
    const matched: number[] = [];
    for (let d = 1; d <= 14; d++) { const b = at.get(t - d * 86_400_000); if (b != null) matched.push(b); }
    minMatched = Math.min(minMatched, matched.length);
    base.push(...matched);
  }
  if (!recent.length) return empty("no sample in the recent window");
  const baselineDays = Number.isFinite(minMatched) ? minMatched : 0;
  if (baselineDays < minDays) return { state: "learning", ratio: null, drop: null, recentHours, baselineDays, lastSampleMs: last, why: `learning — ${baselineDays} of ${minDays} prior days matched for every recent hour` };
  const mr = median(recent);
  const mb = median(base);
  const span = `the same hours on the prior ${baselineDays} days (last ${recentHours} h, Cloudflare NetFlows)`;
  if (isNormalizedRange(series.normalization)) {
    // Range units: the drop below the matched hours as a fraction of the
    // window's whole range. A ratio would be amplified by the subtracted
    // minimum, so none is claimed.
    const drop = mb - mr;
    const state: TrafficState = drop >= NORM_DROP_COLLAPSED && mr <= NORM_FLOOR ? "collapsed" : drop >= NORM_DROP_DOWN ? "down" : "normal";
    const pct = Math.round(drop * 100);
    const why = state === "normal"
      ? `traffic in its usual band against ${span}${pct > 0 ? ` — ${pct}% of the week's range below` : ""}`
      : `traffic ${state.toUpperCase()} — ${pct}% of the week's range below ${span}; normalized series, range units not a ratio`;
    return { state, ratio: null, drop, recentHours, baselineDays, lastSampleMs: last, why };
  }
  if (mb <= 0) return { state: "unknown", ratio: null, drop: null, recentHours, baselineDays, lastSampleMs: last, why: "baseline is zero — the reference cannot be read" };
  const ratio = mr / mb;
  const pct = Math.round(ratio * 100);
  const state: TrafficState = ratio <= TRAFFIC_COLLAPSED ? "collapsed" : ratio <= TRAFFIC_DOWN ? "down" : "normal";
  const why = state === "normal"
    ? `traffic ${pct}% of ${span}`
    : `traffic ${state.toUpperCase()} — ${pct}% of ${span}`;
  return { state, ratio, drop: null, recentHours, baselineDays, lastSampleMs: last, why };
}
