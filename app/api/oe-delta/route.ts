import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { getAllLastSeen, bumpLastSeen } from "@/lib/surfaceState";
import { getPostureHistory } from "@/lib/forcePostureHistory";
import { getAllSitrepHistory } from "@/lib/sitrepHistory";
import { getWarningLevelHistory } from "@/lib/warningStore";
import { activeWarningProblems } from "@/lib/warningProblems";
import { computeDelta, type LevelSeries } from "@/lib/oeDelta";

export const dynamic = "force-dynamic";

// What changed in the operational environment since you last looked.
//
// A join over three daily history tables the app already writes — force
// posture, base SITREP LEDs, I&W levels — anchored on the surface_state
// last-seen primitive. No model call, no upstream fetch: every read here is one
// indexed query on data already stored, so this is cheap enough to sit on the
// front door.
//
// The "oe" surface is bumped AFTER the delta is computed, so this visit becomes
// the baseline for the next one. Bumping first would compare now with now.

const WINDOW_DAYS = 14;

export async function GET() {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [lastSeen, posture, sitrep, warning, problems] = await Promise.all([
    getAllLastSeen(email).catch(() => ({} as Record<string, number>)),
    getPostureHistory(WINDOW_DAYS).catch(() => ({})),
    getAllSitrepHistory(WINDOW_DAYS).catch(() => ({})),
    getWarningLevelHistory(WINDOW_DAYS).catch(() => ({})),
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

  const delta = computeDelta(series, (lastSeen as Record<string, number>).oe);

  // This look becomes the next baseline. Fire-and-forget — a failed bump must
  // not fail the read.
  bumpLastSeen(email, "oe").catch(() => {});

  return NextResponse.json({ ...delta, scanned: { series: series.length, windowDays: WINDOW_DAYS } });
}
