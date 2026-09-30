// Chokepoint AIS transit signal — PURE, client-safe, unit-tested.
// lib/chokepointAis.ts counts; this file judges.
//
// The interdiction read (lib/chokepointSignals) is built from what people
// SAY — reported acts, declared threats. AIS is what ships DO. When a strait
// is being interdicted, the first thing that happens is that traffic thins:
// operators hold at anchor, reroute, or go dark. So the signal here is a
// DROP against this chokepoint's own normal — not an absolute count, which
// means nothing without a baseline (Hormuz sees ~100 transits a day, the
// Bosphorus ~120, Panama ~35).
//
// Discipline, same as every baseline in the app:
// • UNKNOWN before NORMAL. Fewer than MIN_OBSERVED_MINUTES of coverage today
//   means we have not been listening long enough to say anything — the
//   bridge only runs while the server process is alive, and a fresh deploy
//   restarts the count. A low number from a short listen is not low traffic.
// • LEARNING until the baseline has MIN_BASELINE_DAYS of OBSERVED days
//   (days with enough coverage), never calendar days.
// • The ratio compares like with like: today's distinct vessels per observed
//   hour against the baseline's distinct vessels per observed hour.

export type TransitState = "unconfigured" | "unknown" | "learning" | "normal" | "suppressed" | "elevated";

export interface TransitInput {
  configured: boolean;          // AIS key present and the bridge is up
  distinctToday: number;        // distinct MMSI seen in the box today (UTC)
  observedMinutesToday: number; // minutes the bridge was listening today
  lastHour: number;             // distinct MMSI in the trailing 60 min
  /** Baseline: mean distinct-per-observed-hour over prior qualifying days, and how many such days. */
  baselinePerHour: number | null;
  baselineDays: number;
}

export interface TransitSignal {
  state: TransitState;
  /** today's per-hour rate ÷ baseline per-hour rate; null when not computable. */
  ratio: number | null;
  perHourToday: number | null;
  line: string;
}

export const MIN_OBSERVED_MINUTES = 45;
export const MIN_BASELINE_DAYS = 5;
export const SUPPRESSED_BELOW = 0.6;
export const ELEVATED_ABOVE = 1.6;

export function transitSignal(i: TransitInput): TransitSignal {
  if (!i.configured) return { state: "unconfigured", ratio: null, perHourToday: null, line: "AIS not configured" };
  if (i.observedMinutesToday < MIN_OBSERVED_MINUTES) {
    return { state: "unknown", ratio: null, perHourToday: null, line: `AIS listening ${Math.round(i.observedMinutesToday)} min today — not enough to judge traffic` };
  }
  const perHourToday = i.distinctToday / (i.observedMinutesToday / 60);
  if (i.baselinePerHour === null || i.baselineDays < MIN_BASELINE_DAYS) {
    return {
      state: "learning", ratio: null, perHourToday,
      line: `${perHourToday.toFixed(1)} vessels/h today (${i.lastHour} in the last hour) — baseline forming, ${i.baselineDays}/${MIN_BASELINE_DAYS} observed days`,
    };
  }
  if (i.baselinePerHour <= 0) {
    return { state: "learning", ratio: null, perHourToday, line: `${perHourToday.toFixed(1)} vessels/h today — baseline empty` };
  }
  const ratio = perHourToday / i.baselinePerHour;
  const pct = Math.round((ratio - 1) * 100);
  const base = `${perHourToday.toFixed(1)} vessels/h vs ${i.baselinePerHour.toFixed(1)} normal (${pct >= 0 ? "+" : ""}${pct}%)`;
  if (ratio <= SUPPRESSED_BELOW) return { state: "suppressed", ratio, perHourToday, line: `traffic SUPPRESSED — ${base}` };
  if (ratio >= ELEVATED_ABOVE) return { state: "elevated", ratio, perHourToday, line: `traffic elevated — ${base}` };
  return { state: "normal", ratio, perHourToday, line: `traffic normal — ${base}` };
}

/** Per-day rate series from daily rows (qualifying days only), oldest first —
 *  the sparkline and slope on the board tile. */
export function transitDaySeries(rows: { day: string; distinct: number; observedMinutes: number }[]): { day: string; value: number }[] {
  return rows
    .filter((r) => r.observedMinutes >= MIN_OBSERVED_MINUTES * 4)
    .map((r) => ({ day: r.day, value: r.distinct / (r.observedMinutes / 60) }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** Days whose rate was SUPPRESSED against the given normal — the lead series
 *  for "do ships thin out before an act is reported?". Empty without a normal. */
export function suppressedDays(series: { day: string; value: number }[], perHourNormal: number | null): string[] {
  if (perHourNormal == null || perHourNormal <= 0) return [];
  return series.filter((p) => p.value / perHourNormal <= SUPPRESSED_BELOW).map((p) => p.day);
}

/** Baseline from daily rows: mean distinct-per-observed-hour over days that
 *  had enough coverage. Days with thin coverage are not "quiet", they are
 *  unobserved, and are excluded from the denominator. */
export function transitBaseline(rows: { distinct: number; observedMinutes: number }[]): { perHour: number | null; days: number } {
  const ok = rows.filter((r) => r.observedMinutes >= MIN_OBSERVED_MINUTES * 4);
  if (ok.length === 0) return { perHour: null, days: 0 };
  const rates = ok.map((r) => r.distinct / (r.observedMinutes / 60));
  return { perHour: rates.reduce((s, x) => s + x, 0) / rates.length, days: ok.length };
}
