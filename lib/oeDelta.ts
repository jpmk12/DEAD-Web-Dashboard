// The OE delta: what changed in the operational environment since you last looked.
//
// PURE, client-safe, unit-tested. No model call, no new fetch — a join over the
// daily history the app already writes (force posture, base SITREP LEDs, I&W
// levels) anchored on the `surface_state` last-seen primitive.
//
// ── Why it exists ─────────────────────────────────────────────────────────
// Four daily history tables accumulate state and each was read only by the
// feature that writes it. Nothing answered the north star's own verb — "see
// CHANGES in the operational environment" — across all of them at once. This
// is that answer, and it is arithmetic over data already stored.
//
// It is also the first surface in the app where an IMPROVEMENT is first-class.
// Every other signal is a degradation; "postured to take advantage" needs a
// vocabulary for an opening, and a base going amber→green is one.
//
// ── Discipline ────────────────────────────────────────────────────────────
// NET CHANGE, NOT A LOG. One row per subject: the level at your last look
// versus the level now. If it went red and back to amber while you were away,
// you see "amber → amber"? No — you see nothing, because nothing changed net;
// the chronicity chip on the row itself carries the recurrence story.
//
// NO BASELINE, NO DIRECTION. A series that only began after your last look
// has nothing to compare against. It is reported as NEW — never as "worse",
// which would be a claim about a past the app never observed. Same rule as
// classifyChronicity's MIN_OBSERVED and amountDelta's sample floor.
//
// THE PREVIOUS LOOK IS THE LAST OBSERVED DAY ON OR BEFORE IT. These tables are
// written lazily, only on days the app ran, so "the level when you last
// looked" means the nearest recorded day at or before that moment — a
// recording gap must not be read as a level.

import { SEVERITY_RANK, type Severity } from "./severity";
import { LED_SEVERITY, IW_LEVEL_RANK } from "./levelTokens";

export type DeltaKind = "posture" | "sitrep" | "iw";

export interface LevelPoint {
  /** UTC yyyy-mm-dd. */
  day: string;
  /** Kind-specific level string — see rankFor. */
  level: string;
}

export interface LevelSeries {
  kind: DeltaKind;
  /** Stable id (posture key, ICAO, problem id). */
  id: string;
  label: string;
  /** SITREP axis (wx / ops / threat) — the LED, not the base, is the subject. */
  axis?: string;
  points: LevelPoint[];
}

export type Direction = "worse" | "better" | "new";

export interface Transition {
  kind: DeltaKind;
  id: string;
  label: string;
  axis?: string;
  /** Level at the last look, null when there was no baseline. */
  from: string | null;
  to: string;
  direction: Direction;
  /** Day the current level was recorded. */
  day: string;
  /** Rank of `to` — ranking key across kinds. */
  toRank: number;
  /** One clause, always safe to render. */
  reason: string;
}

// ── Per-kind level ordinals (higher = worse), aligned to each surface's own
// vocabulary. Posture reuses lib/severity so there is still one home for it.
const LED_RANK: Record<string, number> = LED_SEVERITY;
const IW_RANK: Record<string, number> = IW_LEVEL_RANK;

export function rankFor(kind: DeltaKind, level: string): number | null {
  const table: Record<string, number> =
    kind === "posture" ? (SEVERITY_RANK as Record<string, number>)
    : kind === "sitrep" ? LED_RANK
    : IW_RANK;
  return level in table ? table[level] : null;
}

const LED_NAME: Record<string, string> = { g: "green", a: "amber", r: "red", u: "unknown" };

/** Human form of a level for a sentence. */
export function levelName(kind: DeltaKind, level: string): string {
  return kind === "sitrep" ? (LED_NAME[level] ?? level) : level;
}

/** Whether a level is worth reporting as NEW when it has no baseline. Green,
 *  calm and "unknown" arriving fresh are not news; an elevated level is. */
function isElevated(kind: DeltaKind, level: string): boolean {
  const r = rankFor(kind, level);
  return r !== null && r >= 2;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** UTC day for an epoch ms. */
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The single net transition for one series since `sinceDay`, or null.
 *
 * Points may arrive unordered and with gaps; they are sorted here so callers
 * can hand over raw rows.
 */
export function transitionSince(series: LevelSeries, sinceDay: string): Transition | null {
  const pts = series.points
    .filter((p) => p && ISO.test(p.day) && typeof p.level === "string")
    .slice()
    .sort((a, b) => a.day.localeCompare(b.day));
  if (pts.length === 0) return null;

  const latest = pts[pts.length - 1];
  const toRank = rankFor(series.kind, latest.level);
  if (toRank === null) return null;                      // a level we cannot place is not a delta

  // Baseline = last observed day AT OR BEFORE the last look. A gap is not a level.
  let base: LevelPoint | null = null;
  for (const p of pts) { if (p.day <= sinceDay) base = p; else break; }

  const what = series.axis ? `${series.label} ${series.axis}` : series.label;

  if (!base) {
    // Nothing observed before the last look: no baseline, so no direction.
    if (latest.day <= sinceDay) return null;             // nothing since, either
    if (!isElevated(series.kind, latest.level)) return null;
    return {
      kind: series.kind, id: series.id, label: series.label, axis: series.axis,
      from: null, to: latest.level, direction: "new", day: latest.day, toRank,
      reason: `${what} first seen at ${levelName(series.kind, latest.level)} — no earlier record to compare`,
    };
  }

  if (latest.day <= sinceDay) return null;               // nothing recorded since the last look
  const fromRank = rankFor(series.kind, base.level);
  if (fromRank === null || fromRank === toRank) return null;   // no net change (or unplaceable baseline)

  const direction: Direction = toRank > fromRank ? "worse" : "better";
  return {
    kind: series.kind, id: series.id, label: series.label, axis: series.axis,
    from: base.level, to: latest.level, direction, day: latest.day, toRank,
    reason: `${what}: ${levelName(series.kind, base.level)} → ${levelName(series.kind, latest.level)}`,
  };
}

export interface OeDelta {
  /** Day the comparison is anchored on. */
  sinceDay: string;
  /** True when there was no recorded last look and yesterday was used instead. */
  firstLook: boolean;
  worse: Transition[];
  better: Transition[];
  fresh: Transition[];
  /** One sentence, or null when nothing moved. */
  line: string | null;
}

/**
 * `sinceMs` = the user's last look at this surface, or 0/undefined when none is
 * recorded — in which case yesterday is used and `firstLook` says so, because
 * a delta against an unstated baseline is a delta the user cannot evaluate.
 */
export function computeDelta(
  series: LevelSeries[],
  sinceMs: number | undefined,
  nowMs = Date.now(),
  opts: { max?: number } = {},
): OeDelta {
  const firstLook = !sinceMs || sinceMs <= 0 || !Number.isFinite(sinceMs);
  const sinceDay = firstLook ? dayOf(nowMs - 86_400_000) : dayOf(sinceMs!);
  const max = opts.max ?? 6;

  const all: Transition[] = [];
  for (const s of series) {
    const t = transitionSince(s, sinceDay);
    if (t) all.push(t);
  }

  // Worse first by how bad it got, then improvements by how far they came,
  // then fresh elevated entries. Within a band, the more severe new level leads.
  const worse = all.filter((t) => t.direction === "worse").sort((a, b) => b.toRank - a.toRank || a.label.localeCompare(b.label)).slice(0, max);
  const better = all.filter((t) => t.direction === "better").sort((a, b) => a.toRank - b.toRank || a.label.localeCompare(b.label)).slice(0, max);
  const fresh = all.filter((t) => t.direction === "new").sort((a, b) => b.toRank - a.toRank || a.label.localeCompare(b.label)).slice(0, max);

  const parts: string[] = [];
  if (worse.length) parts.push(`${worse.length} worse`);
  if (better.length) parts.push(`${better.length} improved`);
  if (fresh.length) parts.push(`${fresh.length} new`);
  const line = parts.length ? `${parts.join(" · ")} since ${firstLook ? "yesterday" : "your last look"}` : null;

  return { sinceDay, firstLook, worse, better, fresh, line };
}

// ── Look snapshots (2026-11-25, "the posture / SITREP / I&W change line
// doesn't seem to be doing much") ─────────────────────────────────────────
// computeDelta compares DAYS: a series moves only when a row exists for a day
// AFTER the day of the last look. Every Glance visit moved the look to now, so
// a second visit the same day compared today with today (nothing, ever), and
// the first visit of the day usually ran before today's rows were written. The
// card said "nothing changed" almost every time.
//
// The fix stores the LEVELS the user saw. A look saves every series' current
// level; the next look compares the current levels with that snapshot. A look
// less than SESSION_GAP_MS after the previous one belongs to the same visit and
// keeps the visit's baseline, so a reload (or a board polling all morning)
// does not wipe what moved. No stored look yet → computeDelta's "yesterday".

/** Gap that starts a new visit. */
export const SESSION_GAP_MS = 60 * 60_000;

export type LevelSnapshot = Record<string, { level: string; day: string }>;

export function seriesKey(s: Pick<LevelSeries, "kind" | "id" | "axis">): string {
  return `${s.kind}|${s.id}|${s.axis ?? ""}`;
}

/** The latest recorded level of every series — what the user is looking at. */
export function levelSnapshot(series: LevelSeries[]): LevelSnapshot {
  const out: LevelSnapshot = {};
  for (const s of series) {
    let latest: LevelPoint | null = null;
    for (const p of s.points) {
      if (!p || !ISO.test(p.day) || typeof p.level !== "string") continue;
      if (!latest || p.day >= latest.day) latest = p;
    }
    if (latest && rankFor(s.kind, latest.level) !== null) out[seriesKey(s)] = { level: latest.level, day: latest.day };
  }
  return out;
}

export interface LookState {
  lastLookAt: number;
  lastLevels: LevelSnapshot;
  baselineAt: number | null;
  baseline: LevelSnapshot | null;
}

/** Given the stored look and the levels now, the baseline to compare with and
 *  the state to store. PURE. */
export function rollLook(state: LookState | null, current: LevelSnapshot, nowMs: number): { compareWith: { at: number; levels: LevelSnapshot } | null; next: LookState } {
  if (!state) return { compareWith: null, next: { lastLookAt: nowMs, lastLevels: current, baselineAt: null, baseline: null } };
  if (nowMs - state.lastLookAt >= SESSION_GAP_MS) {
    return {
      compareWith: { at: state.lastLookAt, levels: state.lastLevels },
      next: { lastLookAt: nowMs, lastLevels: current, baselineAt: state.lastLookAt, baseline: state.lastLevels },
    };
  }
  return {
    compareWith: state.baseline && state.baselineAt ? { at: state.baselineAt, levels: state.baseline } : null,
    next: { ...state, lastLookAt: nowMs, lastLevels: current },
  };
}

/** The delta against a stored look; falls back to computeDelta (yesterday)
 *  when there is none. `sinceMs` is the look compared with. */
export function deltaAgainstLook(
  series: LevelSeries[],
  compareWith: { at: number; levels: LevelSnapshot } | null,
  nowMs = Date.now(),
  opts: { max?: number } = {},
): OeDelta & { sinceMs: number | null } {
  if (!compareWith) return { ...computeDelta(series, undefined, nowMs, opts), sinceMs: null };
  const max = opts.max ?? 6;
  const now = levelSnapshot(series);
  const all: Transition[] = [];
  for (const s of series) {
    const key = seriesKey(s);
    const cur = now[key];
    if (!cur) continue;
    const toRank = rankFor(s.kind, cur.level)!;
    const what = s.axis ? `${s.label} ${s.axis}` : s.label;
    const base = compareWith.levels[key];
    if (!base) {
      if (!isElevated(s.kind, cur.level)) continue;
      all.push({ kind: s.kind, id: s.id, label: s.label, axis: s.axis, from: null, to: cur.level, direction: "new", day: cur.day, toRank,
        reason: `${what} first seen at ${levelName(s.kind, cur.level)} — not on the board at your last look` });
      continue;
    }
    const fromRank = rankFor(s.kind, base.level);
    if (fromRank === null || fromRank === toRank) continue;
    all.push({ kind: s.kind, id: s.id, label: s.label, axis: s.axis, from: base.level, to: cur.level,
      direction: toRank > fromRank ? "worse" : "better", day: cur.day, toRank,
      reason: `${what}: ${levelName(s.kind, base.level)} → ${levelName(s.kind, cur.level)}` });
  }
  const worse = all.filter((t) => t.direction === "worse").sort((a, b) => b.toRank - a.toRank || a.label.localeCompare(b.label)).slice(0, max);
  const better = all.filter((t) => t.direction === "better").sort((a, b) => a.toRank - b.toRank || a.label.localeCompare(b.label)).slice(0, max);
  const fresh = all.filter((t) => t.direction === "new").sort((a, b) => b.toRank - a.toRank || a.label.localeCompare(b.label)).slice(0, max);
  const parts: string[] = [];
  if (worse.length) parts.push(`${worse.length} worse`);
  if (better.length) parts.push(`${better.length} improved`);
  if (fresh.length) parts.push(`${fresh.length} new`);
  return {
    sinceDay: dayOf(compareWith.at), firstLook: false, worse, better, fresh,
    line: parts.length ? `${parts.join(" · ")} since your last look` : null,
    sinceMs: compareWith.at,
  };
}
