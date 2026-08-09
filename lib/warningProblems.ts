// Active warning-problem resolution — server-only (reads the Mission Profile).
// A primary AOI with the I&W toggle yields a templated problem (problemFromSeed);
// with no profile-declared boards the hand-built CENTCOM·Iran problem stays
// active, so pre-profile installs behave exactly as before. Each templated
// problem id is the AOI id, so its warning_daily history/baseline is its own —
// a fresh board starts in learning mode until a real baseline forms.

import type { WarningProblemDef } from "./warning";
import { CENTCOM_IRAN, CENTCOM_GEO, problemFromSeed, type ProblemGeo } from "./warningTaxonomy";
import { deriveTracking } from "./missionProfile";
import { getMissionProfile } from "./missionProfileApply";

export interface ActiveProblem { def: WarningProblemDef; geo: ProblemGeo }

const FALLBACK: ActiveProblem[] = [{ def: CENTCOM_IRAN, geo: CENTCOM_GEO }];

export async function activeWarningProblems(): Promise<ActiveProblem[]> {
  try {
    const profile = await getMissionProfile();
    const seeds = deriveTracking(profile).warningProblems;
    if (seeds.length) return seeds.map(problemFromSeed);
  } catch { /* no DB / no profile → fallback */ }
  return FALLBACK;
}

export async function resolveWarningProblem(problemId: string): Promise<ActiveProblem | null> {
  const all = await activeWarningProblems();
  return all.find((p) => p.def.id === problemId) ?? null;
}
