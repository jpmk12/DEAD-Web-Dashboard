// The daily heartbeat — server-only (docs/PLAN-TREND-LEARNING.md §3 A4).
//
// Every daily series in this app is written lazily, inside an assembler, on
// the days that assembler runs. The capture extension already polls
// /api/alerts/check every 15 minutes whether or not the dashboard is open,
// and that route runs force protection + I&W, so warning_daily and
// force_posture_daily accrue on unopened days. Demand horizon, SITREP, crew,
// energy and spectrum do NOT run from it, so their series would have a gap
// on every day the dashboard stayed closed — and "of observed days" ratios
// are only as good as the days observed.
//
// touchDailySeries() runs those assemblers in the background, once per
// INTERVAL per process, each bounded and individually fail-safe. Every one
// is already cached and deterministic: this spends no model tokens and makes
// no fetch a page open would not make. It records nothing itself — the
// recorders live inside the assemblers, so a series added later is picked up
// by adding nothing here.

import { getUserPrefs } from "./userPrefs";
import { getDemandHorizon } from "./demandAssemble";
import { assembleSitrep, sitrepSummary } from "./sitrep";
import { getEnergyQuotes } from "./energyPrices";
import { getSpectrumSummary } from "./spectrum";

export const HEARTBEAT_INTERVAL_MS = 6 * 60 * 60_000;
const STEP_TIMEOUT_MS = 60_000;

let lastRunAt = 0;
let running: Promise<void> | null = null;

function bounded<T>(p: Promise<T>, ms = STEP_TIMEOUT_MS): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}

/** Fire-and-forget. Returns true when a pass was started this call. */
export function touchDailySeries(nowMs = Date.now()): boolean {
  if (running || nowMs - lastRunAt < HEARTBEAT_INTERVAL_MS) return false;
  lastRunAt = nowMs;
  running = runPass().finally(() => { running = null; });
  running.catch(() => {});
  return true;
}

/** For tests and the diag route: forget the last run. */
export function resetHeartbeat(): void { lastRunAt = 0; }

async function runPass(): Promise<void> {
  const prefs = await bounded(getUserPrefs(), 10_000);
  await Promise.all([
    bounded(getDemandHorizon()),
    bounded(getEnergyQuotes()),
    bounded(getSpectrumSummary({ maxWaitMs: 8_000 })),
    ...((prefs?.sitrepBases ?? []).map((b) => bounded(assembleSitrep(b).then(sitrepSummary)))),
  ]);
}
