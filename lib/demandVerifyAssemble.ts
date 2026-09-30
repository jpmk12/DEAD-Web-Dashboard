// Scores the recorded demand outlooks whose 7-day window has closed —
// server-only, 30-min cache. The judgement is in lib/demandVerify.ts (pure).
//
// Proxies come from series the app already keeps: AOR lift = the max of the
// day-peak mobility counts across the I&W boards in that AOR (each board's
// count is already AOR-scoped), posture = force_posture_daily composites by
// combatant command. A window with neither observed is AMBIGUOUS, never wrong.

import { getDemandOutlookHistory, getMobilityHistory } from "./demandStore";
import { getPostureHistory } from "./forcePostureHistory";
import { activeWarningProblems } from "./warningProblems";
import { aorFromCoords } from "./aor";
import { SEVERITY_RANK } from "./severity";
import { HORIZON_DAYS } from "./demandHorizon";
import { dayDiff } from "./series";
import { scoreOutlook, demandSkill, type DemandSkill, type ObservedWindow, type ScoredOutlook } from "./demandVerify";

export interface DemandSkillBody extends DemandSkill {
  generatedAt: string;
  /** The most recent scored outlooks, newest first (for a footer or diag). */
  recent: ScoredOutlook[];
}

const TTL = 30 * 60_000;
let cache: { at: number; body: DemandSkillBody } | null = null;
let inflight: Promise<DemandSkillBody> | null = null;

export async function getDemandSkill(): Promise<DemandSkillBody> {
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  if (inflight) return inflight;
  inflight = compute().then((body) => { cache = { at: Date.now(), body }; return body; }).finally(() => { inflight = null; });
  return inflight;
}

export function resetDemandSkillCache(): void { cache = null; }

async function compute(): Promise<DemandSkillBody> {
  const today = new Date().toISOString().slice(0, 10);
  const [history, mobility, posture, problems] = await Promise.all([
    getDemandOutlookHistory(45).catch(() => []),
    getMobilityHistory(60).catch(() => []),
    getPostureHistory(60).catch(() => ({})),
    activeWarningProblems().catch(() => []),
  ]);

  // Board → AOR, then AOR lift per day = max across its boards.
  const aorOfProblem = new Map<string, string>();
  for (const p of problems) {
    const { bbox } = p.geo;
    aorOfProblem.set(p.def.id, aorFromCoords((bbox.latMin + bbox.latMax) / 2, (bbox.lonMin + bbox.lonMax) / 2));
  }
  const liftByAorDay = new Map<string, Map<string, number>>();
  for (const m of mobility) {
    const aor = aorOfProblem.get(m.problemId);
    if (!aor) continue;
    const days = liftByAorDay.get(aor) ?? new Map<string, number>();
    days.set(m.day, Math.max(days.get(m.day) ?? 0, m.count));
    liftByAorDay.set(aor, days);
  }

  const scored: ScoredOutlook[] = [];
  for (const o of history) {
    const age = dayDiff(o.day, today);
    if (!Number.isFinite(age) || age < HORIZON_DAYS + 1) continue;   // window (day, day+7] must be fully past
    scored.push(scoreOutlook(o, windowFor(o.aor, o.day, liftByAorDay, posture)));
  }
  scored.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  const skill = demandSkill(scored);
  return { ...skill, generatedAt: new Date().toISOString(), recent: scored.slice(0, 12) };
}

function windowFor(
  aor: string,
  day: string,
  lift: Map<string, Map<string, number>>,
  posture: Record<string, { day: string; composite: string; cocom: string }[]>,
): ObservedWindow {
  const inWindow = (d: string) => { const k = dayDiff(day, d); return k >= 1 && k <= HORIZON_DAYS; };
  const before = (d: string) => { const k = dayDiff(day, d); return k <= 0 && k > -14; };

  const days = lift.get(aor) ?? new Map<string, number>();
  const bVals: number[] = [], aVals: number[] = [];
  for (const [d, v] of days) { if (before(d)) bVals.push(v); else if (inWindow(d)) aVals.push(v); }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  let ups = 0, downs = 0;
  const observedDays = new Set<string>();
  for (const series of Object.values(posture)) {
    const rows = series.filter((r) => r.cocom === aor);
    if (!rows.length) continue;
    const base = rows.filter((r) => r.day <= day).at(-1);
    const win = rows.filter((r) => inWindow(r.day));
    for (const r of win) observedDays.add(r.day);
    if (!base || !win.length) continue;
    const b = SEVERITY_RANK[base.composite as keyof typeof SEVERITY_RANK] ?? -1;
    const e = SEVERITY_RANK[win[win.length - 1].composite as keyof typeof SEVERITY_RANK] ?? -1;
    if (b < 0 || e < 0) continue;
    if (e > b) ups++; else if (e < b) downs++;
  }
  return {
    mobilityBefore: mean(bVals), mobilityBeforeDays: bVals.length,
    mobilityAfter: mean(aVals), mobilityAfterDays: aVals.length,
    postureUps: ups, postureDowns: downs, postureObservedDays: observedDays.size,
  };
}
