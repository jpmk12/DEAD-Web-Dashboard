// Gathers the convergence signals — server-only. Extracted from
// /api/osint/convergence so the OSINT command board's primer can read the same
// join without an HTTP hop (the "Forming" fold retired into the primer,
// REVIEW-2026-10 §6). The judgement is in lib/convergence.ts (pure, tested).
//
// Every source here is ALREADY CACHED and already fetched by panes the user
// opens anyway — trend movers are one indexed aggregate, assessWarning is
// 10-min cached per problem, getDisasters and the force-protection memo are
// the shared feeds the map pulls. No model call, no new upstream.

import { getTrendMovers, getNewPairs } from "./trends";
import { activeWarningProblems } from "./warningProblems";
import { assessWarning } from "./warningAssess";
import { getDisasters } from "./disasters";
import { getForceProtectionCached } from "./forceProtectionCached";
import { getUserPrefs } from "./userPrefs";
import { findConvergence, type Convergence, type ConvergenceSignal } from "./convergence";

// Weights are tie-breakers WITHIN equal breadth only (see lib/convergence) —
// the ranking claim is "how many independent surfaces agree", so a loud single
// source must not outrank a broad quiet one.
const W = {
  iwAlert: 100, iwWarning: 80, iwWatch: 60,
  postureRed: 70, postureAmber: 45,
  sitrepRed: 65, sitrepAmber: 40,
  disasterRed: 60, disasterOrange: 35, disasterOther: 15,
  moverNew: 40, moverRising: 25,
} as const;

export interface ConvergenceBody { items: Convergence[]; scanned: number }

const TTL = 5 * 60 * 1000;
let cache: { at: number; email: string; body: ConvergenceBody } | null = null;

export async function getConvergence(email?: string): Promise<ConvergenceBody> {
  const key = email ?? "";
  if (cache && cache.email === key && Date.now() - cache.at < TTL) return cache.body;
  const body = await gather(email);
  cache = { at: Date.now(), email: key, body };
  return body;
}

export function resetConvergenceCache(): void { cache = null; }

async function gather(email?: string): Promise<ConvergenceBody> {
  const signals: ConvergenceSignal[] = [];

  // The watch list is per-user config, so posture needs the prefs first. Its
  // own assessment is memoised, so this is not an extra fan-out.
  const prefs = await getUserPrefs(email).catch(() => null);

  const [movers, problems, disasters, fp, pairs] = await Promise.all([
    getTrendMovers({ kinds: ["topic", "region", "aor", "watch"], limit: 40 }).catch(() => []),
    activeWarningProblems().catch(() => []),
    getDisasters().catch(() => []),
    getForceProtectionCached(prefs?.countriesOfInterest ?? [], prefs?.forceLocations ?? []).catch(() => null),
    getNewPairs().catch(() => []),
  ]);

  // 0. New pairings — a watch/region term seen with a topic for the first
  //    time in 60 days (PLAN §7 E3). One distinct kind: it can join a row,
  //    never make one on its own (MIN_BREADTH).
  for (const p of pairs.slice(0, 8)) {
    const subject = p.a.split("|")[1];
    if (!subject) continue;
    signals.push({ subject, kind: "pair", detail: `first paired with "${p.b.split("|")[1] ?? p.b}" this week (${p.thisWeek}×)`, weight: 30 });
  }

  // 1. Feeds — what is surging in the user's own sources.
  for (const m of movers) {
    if (m.state !== "new" && m.state !== "rising") continue;
    signals.push({
      subject: m.term,
      kind: "feed",
      detail: m.state === "new"
        ? `newly active — ${m.cur} mentions this week`
        : `rising — ${m.cur} this week vs ${m.prev}`,
      weight: m.state === "new" ? W.moverNew : W.moverRising,
    });
  }

  // 2. I&W — the subject of the board, not the COCOM prefix.
  const assessed = await Promise.all(problems.map((p) => assessWarning(p.def.id).catch(() => null)));
  for (const a of assessed) {
    if (!a || a.level === "calm") continue;
    const subject = String(a.label ?? "").split("·").pop()?.trim();
    if (!subject) continue;
    signals.push({
      subject,
      kind: "iw",
      detail: `${a.level.toUpperCase()} · anomaly ${a.anomaly >= 0 ? "+" : ""}${Math.round(a.anomaly)}`,
      weight: a.level === "alert" ? W.iwAlert : a.level === "warning" ? W.iwWarning : W.iwWatch,
    });
  }

  // 3. Disasters, by country.
  for (const d of disasters) {
    if (!d.country || d.severity === "unknown") continue;
    signals.push({
      subject: d.country,
      kind: "disaster",
      detail: `${d.severity} ${d.type} (${d.source})`,
      weight: d.severity === "red" ? W.disasterRed : d.severity === "orange" ? W.disasterOrange : W.disasterOther,
    });
  }

  // 4. Force posture — elevated watch entries, by country. UNKNOWN is excluded
  //    on purpose: a dead feed must not be counted as a surface that agrees.
  for (const a of fp?.assessments ?? []) {
    if (a.composite !== "red" && a.composite !== "amber") continue;
    if (!a.country) continue;
    signals.push({
      subject: a.country,
      kind: "posture",
      detail: `${a.composite.toUpperCase()} — ${a.topDriver}`.slice(0, 120),
      weight: a.composite === "red" ? W.postureRed : W.postureAmber,
    });
  }

  // 5. Base SITREPs ride the SAME force-protection feed rather than a second
  //    fan-out: a pinned base in an elevated country is that country's own
  //    airfield reporting, which is a distinct surface from the country read.
  for (const a of fp?.assessments ?? []) {
    if (a.kind !== "base" || !a.country) continue;
    if (a.composite !== "red" && a.composite !== "amber") continue;
    signals.push({
      subject: a.country,
      kind: "sitrep",
      detail: `${a.label}${a.icao ? ` (${a.icao})` : ""} at ${a.composite.toUpperCase()}`,
      weight: a.composite === "red" ? W.sitrepRed : W.sitrepAmber,
    });
  }

  return { items: findConvergence(signals), scanned: signals.length };
}
