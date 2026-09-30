// Lead indicators — PURE, client-safe, unit-tested (PLAN §5 C1).
//
// warning_daily keeps one composite row per board per day; indicator_daily
// (new) keeps each indicator's state per day. With both, the board can
// answer Grabo's question: which indicator MOVES FIRST before the board's
// level changes? For every level-up in the board's history, an indicator
// "led" it if its own state stepped up inside the prior LEAD_WINDOW
// observed days (same day counts). Three level-ups before any claim; below
// that the board says how few it has.
//
// Also the per-indicator run length ("watching · 9 obs days") and a compact
// 14-cell sparkline model for the row, hollow where the sensor was dead.

import type { ObservedState, WarningLevel } from "./warning";
import { precedes, LEAD_MIN_EVENTS, type LeadResult } from "./series";

export const STATE_ORDER: readonly ObservedState[] = ["dormant", "watching", "active", "confirmed"];
export const LEVEL_ORDER: readonly WarningLevel[] = ["calm", "watch", "warning", "alert"];
export const LEAD_WINDOW_DAYS = 5;

export interface IndicatorDay { day: string; state: ObservedState; live: boolean }
export interface LevelDay { day: string; level: WarningLevel }

const stateOrd = (s: string) => STATE_ORDER.indexOf(s as ObservedState);
const levelOrd = (l: string) => LEVEL_ORDER.indexOf(l as WarningLevel);

function sortedByDay<T extends { day: string }>(xs: T[]): T[] {
  return xs.slice().sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** Days on which the value stepped UP from the previous OBSERVED day. */
export function stepUpDays<T extends { day: string }>(series: T[], ord: (x: T) => number): string[] {
  const s = sortedByDay(series);
  const out: string[] = [];
  for (let i = 1; i < s.length; i++) if (ord(s[i]) > ord(s[i - 1])) out.push(s[i].day);
  return out;
}

export interface IndicatorLead { indicatorId: string; result: LeadResult }

export interface LeadRead {
  levelUps: number;
  /** Indicators that led at least one level-up, best first. */
  leads: IndicatorLead[];
  label: string;
}

export function leadIndicators(
  levels: LevelDay[],
  indicators: Record<string, IndicatorDay[]>,
  windowDays = LEAD_WINDOW_DAYS,
): LeadRead {
  const ups = stepUpDays(levels, (l) => levelOrd(l.level));
  if (ups.length < LEAD_MIN_EVENTS) {
    return { levelUps: ups.length, leads: [], label: `${ups.length} level change${ups.length === 1 ? "" : "s"} on record — ${LEAD_MIN_EVENTS} needed before lead indicators are read` };
  }
  const leads: IndicatorLead[] = [];
  for (const [id, days] of Object.entries(indicators)) {
    const live = days.filter((d) => d.live);
    const hits = stepUpDays(live, (d) => stateOrd(d.state));
    const r = precedes(hits, ups, windowDays);
    if (r && r.hits > 0) leads.push({ indicatorId: id, result: r });
  }
  leads.sort((a, b) => b.result.hits - a.result.hits || (a.result.medianLeadDays ?? 99) - (b.result.medianLeadDays ?? 99));
  const label = leads.length
    ? `${ups.length} level-ups · ${leads.slice(0, 3).map((l) => `${l.indicatorId} ${l.result.hits}/${l.result.events}${l.result.medianLeadDays != null && l.result.medianLeadDays > 0 ? ` (${l.result.medianLeadDays} d ahead)` : ""}`).join(" · ")}`
    : `${ups.length} level-ups, no indicator stepped up inside the ${windowDays}-day window before them`;
  return { levelUps: ups.length, leads, label };
}

/** Consecutive observed days (newest back) the indicator has held its current state. */
export function stateRun(days: IndicatorDay[]): { state: ObservedState | null; run: number } {
  const s = sortedByDay(days).filter((d) => d.live);
  if (!s.length) return { state: null, run: 0 };
  const cur = s[s.length - 1].state;
  let run = 0;
  for (let i = s.length - 1; i >= 0 && s[i].state === cur; i--) run++;
  return { state: cur, run };
}

export interface SparkCell { day: string; ord: number; live: boolean }

/** The last `n` observed days as cells (ord −1 when the sensor was dead). */
export function sparkCells(days: IndicatorDay[], n = 14): SparkCell[] {
  return sortedByDay(days).slice(-n).map((d) => ({ day: d.day, ord: d.live ? stateOrd(d.state) : -1, live: d.live }));
}
