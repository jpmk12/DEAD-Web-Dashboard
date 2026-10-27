// Cloudflare Radar — the NetFlows traffic timeseries per country (PURE,
// client-safe, tested in tests/radarNetflows.test.ts). The outage
// annotations are CURATED (a human at Cloudflare wrote them up); this is
// the raw signal underneath — total traffic Cloudflare sees from a country,
// hour by hour. It answers "is the country's internet carrying its usual
// traffic right now" without waiting for a write-up, and corroborates an
// annotation with a second kind of evidence.
//
// The read is the HOUR-MATCHED ratio: the median of the last RECENT_HOURS
// hourly samples against the median of the SAME hours of the day on the
// prior days in the window (a diurnal curve compared to itself — Monday
// 0300 is compared with 0300, never with the daytime mean). Median
// everywhere, never mean (the household rule). Thresholds are deliberate:
// `TRAFFIC_DOWN` ≤ 0.6 is well outside ordinary day-to-day variance on a
// national series; `TRAFFIC_COLLAPSED` ≤ 0.25 is a shutdown-class drop.
//
// Values: the request asks `normalization=PERCENTAGE_CHANGE`, under which
// every value is a percentage change against ONE reference constant, so
// v = c·(1 + p/100) and the ratio of two samples is (1+p₁/100)/(1+p₂/100)
// with c cancelling. MIN0_MAX would NOT do: it subtracts the window's
// minimum (the nightly trough) and turns a modest daytime dip into a near-
// zero ratio. The value shape is UNVERIFIED from the sandbox; the diag row
// prints the first values so a different definition is caught on the first
// paste. A value below −100 cannot be a percentage change and is dropped.
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
  /** Relative level: 1 + p/100 (≥ 0). */
  values: number[];
  aggInterval: string;
  normalization: string;
  lastUpdatedMs: number | null;
}

export type TrafficState = "normal" | "down" | "collapsed" | "learning" | "unknown";

export interface TrafficRead {
  state: TrafficState;
  /** median(recent) / median(hour-matched prior days); null when unknown / learning. */
  ratio: number | null;
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

const num = (v: unknown): number | null => { const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN; return Number.isFinite(n) ? n : null; };
const ms = (s: unknown): number | null => { if (typeof s !== "string" || !s) return null; const t = Date.parse(s); return Number.isFinite(t) ? t : null; };

/** `result.serie_0` (or the first `serie_*` / named series) → a TrafficSeries,
 *  or null when nothing series-shaped is there. Pairs with a non-finite
 *  value, a value below −100 or an unparseable timestamp are dropped. */
export function parseNetflows(json: unknown): TrafficSeries | null {
  const result = (json as { result?: Record<string, unknown> } | null)?.result;
  if (!result || typeof result !== "object") return null;
  const meta = (result.meta ?? {}) as Record<string, unknown>;
  const serie = (result.serie_0 ?? Object.entries(result).find(([k, v]) => k !== "meta" && v && typeof v === "object" && Array.isArray((v as { timestamps?: unknown }).timestamps))?.[1]) as { timestamps?: unknown; values?: unknown } | undefined;
  if (!serie || !Array.isArray(serie.timestamps) || !Array.isArray(serie.values)) return null;
  const n = Math.min(serie.timestamps.length, serie.values.length);
  const pairs: { t: number; v: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = ms(serie.timestamps[i]);
    const p = num(serie.values[i]);
    if (t == null || p == null || p < -100) continue;
    pairs.push({ t, v: 1 + p / 100 });
  }
  pairs.sort((a, b) => a.t - b.t);
  const normalization = typeof meta.normalization === "string" ? meta.normalization : "";
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
  const empty = (why: string, state: TrafficState = "unknown"): TrafficRead => ({ state, ratio: null, recentHours, baselineDays: 0, lastSampleMs: series?.timestamps.at(-1) ?? null, why });
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
  if (baselineDays < minDays) return { state: "learning", ratio: null, recentHours, baselineDays, lastSampleMs: last, why: `learning — ${baselineDays} of ${minDays} prior days matched for every recent hour` };
  const mb = median(base);
  if (mb <= 0) return { state: "unknown", ratio: null, recentHours, baselineDays, lastSampleMs: last, why: "baseline is zero — the reference cannot be read" };
  const ratio = median(recent) / mb;
  const pct = Math.round(ratio * 100);
  const state: TrafficState = ratio <= TRAFFIC_COLLAPSED ? "collapsed" : ratio <= TRAFFIC_DOWN ? "down" : "normal";
  const why = state === "normal"
    ? `traffic ${pct}% of the same hours on the prior ${baselineDays} days (last ${recentHours} h)`
    : `traffic ${state.toUpperCase()} — ${pct}% of the same hours on the prior ${baselineDays} days (last ${recentHours} h, Cloudflare NetFlows)`;
  return { state, ratio, recentHours, baselineDays, lastSampleMs: last, why };
}
