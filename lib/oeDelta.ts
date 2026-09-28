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
const LED_RANK: Record<string, number> = { g: 0, u: 1, a: 2, r: 3 };
const IW_RANK: Record<string, number> = { calm: 0, watch: 1, warning: 2, alert: 3 };

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
