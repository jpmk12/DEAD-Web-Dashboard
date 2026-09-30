// Attention versus signal — PURE, client-safe, unit-tested (PLAN §8 F).
//
// surface_opens records which SITREP bases, I&W boards and Regional countries
// each user opens; the OE delta's level series record which of them moved.
// Held side by side they answer the one trend that is about the reader:
// "you have not opened the Iran board in nine days while it worsened".
//
// A gap is a subject whose series stepped UP inside the window and is still
// at (or above) that level, and whose last open by THIS user is older than
// the step-up day — or absent. Improvements never produce a gap (they are
// openings, not omissions). Capped, worst first; a subject the user opens
// after the change drops out on its own. Per user, never pushed, never in
// the shared brief export.

import type { LevelSeries } from "./oeDelta";
import { rankFor } from "./oeDelta";
import type { OpenRow, OpenSurface } from "./openSignal";

export const GAP_WINDOW_DAYS = 14;
export const GAP_MAX = 3;

export interface AttentionGap {
  surface: OpenSurface;
  id: string;
  label: string;
  /** Day of the most recent step-up still in effect. */
  worsenedDay: string;
  level: string;
  lastOpenAt: number | null;
  /** Whole days since the last open, null when never opened. */
  daysSinceOpen: number | null;
  line: string;
}

/** Which open-tracking row a series keys to; null for series nobody "opens"
 *  (a posture BASE entry is keyed by label, not ICAO — the SITREP series
 *  carries that base instead). */
export function openKeyFor(s: LevelSeries): { surface: OpenSurface; id: string } | null {
  if (s.kind === "iw") return { surface: "board", id: s.id };
  if (s.kind === "sitrep") return { surface: "base", id: s.id.split(":")[0] };
  if (s.kind === "posture" && s.id.startsWith("c:")) return { surface: "country", id: s.label };
  return null;
}

const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

export function attentionGaps(opens: OpenRow[], series: LevelSeries[], nowMs = Date.now(), opts: { windowDays?: number; max?: number } = {}): AttentionGap[] {
  const windowDays = opts.windowDays ?? GAP_WINDOW_DAYS;
  const max = opts.max ?? GAP_MAX;
  const cutoff = nowMs - windowDays * 86_400_000;

  const lastOpen = new Map<string, number>();
  for (const o of opens) {
    const k = `${o.surface}:${o.id.toLowerCase()}`;
    lastOpen.set(k, Math.max(lastOpen.get(k) ?? 0, o.lastOpenAt));
  }

  const found = new Map<string, AttentionGap & { rank: number }>();
  for (const s of series) {
    const key = openKeyFor(s);
    if (!key) continue;
    const pts = s.points.filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.day)).slice().sort((a, b) => a.day.localeCompare(b.day));
    if (pts.length < 2) continue;
    // The latest step-up inside the window whose level still holds.
    let up: { day: string; rank: number; level: string } | null = null;
    for (let i = 1; i < pts.length; i++) {
      const r0 = rankFor(s.kind, pts[i - 1].level), r1 = rankFor(s.kind, pts[i].level);
      if (r0 == null || r1 == null) continue;
      if (r1 > r0 && r1 >= 2 && dayMs(pts[i].day) >= cutoff) up = { day: pts[i].day, rank: r1, level: pts[i].level };
    }
    if (!up) continue;
    const latestRank = rankFor(s.kind, pts[pts.length - 1].level);
    if (latestRank == null || latestRank < up.rank) continue;          // recovered since — no gap

    const opened = lastOpen.get(`${key.surface}:${key.id.toLowerCase()}`) ?? null;
    if (opened != null && opened >= dayMs(up.day)) continue;           // looked after it moved
    const daysSince = opened != null ? Math.floor((nowMs - opened) / 86_400_000) : null;
    const what = s.axis ? `${s.label} ${s.axis}` : s.label;
    const line = `${what} — worse since ${up.day.slice(5)}, ${opened == null ? "never opened" : `not opened for ${daysSince} d`}`;
    const gap = { surface: key.surface, id: key.id, label: s.label, worsenedDay: up.day, level: up.level, lastOpenAt: opened, daysSinceOpen: daysSince, line, rank: latestRank };
    // One row per subject (a base has several LEDs): keep the worst.
    const k = `${key.surface}:${key.id.toLowerCase()}`;
    const prev = found.get(k);
    if (!prev || gap.rank > prev.rank || (gap.rank === prev.rank && gap.worsenedDay > prev.worsenedDay)) found.set(k, gap);
  }
  return Array.from(found.values())
    .sort((a, b) => b.rank - a.rank || (b.daysSinceOpen ?? 999) - (a.daysSinceOpen ?? 999) || a.label.localeCompare(b.label))
    .slice(0, max)
    .map(({ rank: _rank, ...g }) => g);
}
