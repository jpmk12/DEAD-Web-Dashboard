// Builds the level series the OE delta is computed over — server-only.
//
// Extracted from /api/oe-delta so the assistant's OE context can compute the
// same "what changed since your last look" WITHOUT bumping the user's
// last-seen (the assistant reading the picture is not the user looking at it;
// only the Glance card visit moves the baseline). One join over three daily
// history tables the app already writes; no upstream fetch.

import { getPostureHistory } from "./forcePostureHistory";
import { getAllSitrepHistory } from "./sitrepHistory";
import { getWarningLevelHistory } from "./warningStore";
import { activeWarningProblems } from "./warningProblems";
import type { LevelSeries } from "./oeDelta";

export const OE_WINDOW_DAYS = 14;

export async function buildOeSeries(windowDays = OE_WINDOW_DAYS): Promise<LevelSeries[]> {
  const [posture, sitrep, warning, problems] = await Promise.all([
    getPostureHistory(windowDays).catch(() => ({})),
    getAllSitrepHistory(windowDays).catch(() => ({})),
    getWarningLevelHistory(windowDays).catch(() => ({})),
    activeWarningProblems().catch(() => []),
  ]);

  const series: LevelSeries[] = [];

  for (const [key, rows] of Object.entries(posture)) {
    if (rows.length === 0) continue;
    series.push({
      kind: "posture", id: key,
      label: rows[rows.length - 1].label || key.replace(/^[cb]:/, ""),
      points: rows.map((r) => ({ day: r.day, level: r.composite })),
    });
  }

  // One series per LED, not per base — the axis is the subject that moved.
  for (const [icao, rows] of Object.entries(sitrep)) {
    for (const axis of ["wx", "ops", "threat"] as const) {
      series.push({
        kind: "sitrep", id: `${icao}:${axis}`, label: icao, axis,
        points: rows.map((r) => ({ day: r.day, level: r[axis] })),
      });
    }
  }

  const labelFor = new Map<string, string>();
  for (const p of problems) {
    const def = (p as { def?: { id?: string; label?: string } }).def;
    if (def?.id) labelFor.set(def.id, def.label ?? def.id);
  }
  for (const [problemId, rows] of Object.entries(warning)) {
    series.push({
      kind: "iw", id: problemId, label: labelFor.get(problemId) ?? problemId,
      points: rows.map((r) => ({ day: r.day, level: r.level })),
    });
  }

  return series;
}
