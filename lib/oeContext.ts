// The assistant's OE snapshot — server-only gather. The format is in
// lib/oeContextFormat.ts (pure, tested).
//
// LATENCY DISCIPLINE. The chat turn must not wait on fifteen upstream feeds.
// Every source here is one the dashboard already caches in-process (force
// protection 5-min via its route… but the LIB fans out, so it is cached HERE
// too; SITREP 10-min; I&W 10-min; alerts 5-min), so a warm server answers in
// milliseconds. When cold, the gather runs in the background and the turn
// takes whatever is ready within `maxWaitMs`, marking the rest UNAVAILABLE
// (never silently omitted) and the snapshot STALE if an older one is served.
// A user asking a scheduling question pays nothing for the OE picture beyond
// the tokens; a user asking about posture on a cold server gets an honest
// "unavailable this turn", and the next turn has it.

import { getUserPrefs } from "./userPrefs";
import { getForceProtectionCached as getForceProtection } from "./forceProtectionCached";
import { getDemandHorizon } from "./demandAssemble";
import { getDemandSkill } from "./demandVerifyAssemble";
import { listCrewRows } from "./crewStore";
import { deriveAvailability, postureAgainstDemand } from "./crewState";
import { AOR_LABELS } from "./aor";
import { assembleSitrep, sitrepSummary } from "./sitrep";
import { activeWarningProblems } from "./warningProblems";
import { assessWarning } from "./warningAssess";
import { computeAlerts } from "./alerts";
import { getAllLastSeen } from "./surfaceState";
import { computeDelta, type Transition } from "./oeDelta";
import { buildOeSeries } from "./oeDeltaAssemble";
import { listDueDecisions } from "./decisionStore";
import type { OeSnapshot, OeForceRow, OeSitrepRow, OeBoardRow, OeAlertRow, OeDecisionRow } from "./oeContextFormat";

const FRESH_MS = 5 * 60 * 1000;

interface Cached { at: number; snap: OeSnapshot }
let cache: Cached | null = null;
let inflight: Promise<OeSnapshot> | null = null;

const settle = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

/** Resolve to `null` if `p` has not settled within `ms`. */
function within<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}

async function gather(): Promise<OeSnapshot> {
  const prefs = await getUserPrefs().catch(() => null);

  const forceP = settle(getForceProtection(prefs?.countriesOfInterest ?? [], prefs?.forceLocations ?? []).then((fp): OeForceRow[] =>
    fp.assessments.map((a) => ({
      label: a.label,
      composite: a.composite,
      topDriver: a.topDriver,
      cocom: a.cocom,
      chronicity: a.chronicity && a.chronicity.state !== "quiet"
        ? `${a.chronicity.state} ${a.chronicity.daysElevated}/${a.chronicity.daysObserved}d`
        : null,
      escalated: !!a.previousComposite,
    })),
  ));

  const bases = prefs?.sitrepBases ?? [];
  const sitrepP = settle(Promise.all(bases.map((b) => assembleSitrep(b).then(sitrepSummary).catch(() => null))).then((rows): OeSitrepRow[] =>
    rows.map((s, i) => s
      ? { icao: s.icao, label: s.label, status: s.status, driver: s.driver, worse: s.worse }
      : { icao: bases[i].icao, label: bases[i].label, status: { wx: "u", ops: "u", threat: "u", infra: "u", spectrum: "u" }, driver: "assembly failed — UNKNOWN", worse: [] }),
  ));

  const boardsP = settle(activeWarningProblems().then(async (ps): Promise<OeBoardRow[]> => {
    const out: OeBoardRow[] = [];
    for (const p of ps) {
      const a = await assessWarning(p.def.id).catch(() => null);
      if (!a) continue;
      out.push({
        problemId: a.problemId,
        label: a.label, level: a.level, anomaly: a.anomaly, trajectory: a.trajectory, learning: a.learning,
        drivers: (a.drivers ?? []).map((d) => d.description),
      });
    }
    return out;
  }));

  const alertsP = settle(computeAlerts().then((c): OeAlertRow[] => c.alerts.map((a) => ({ severity: a.severity, title: a.title, sub: a.sub }))));

  const decisionsP = settle(listDueDecisions(6).then((ds): OeDecisionRow[] => ds.map((d) => ({
    problem: d.problemId, call: d.call, expectation: d.expectation, dueISO: d.dueAt,
  }))));

  const demandP = settle(getDemandHorizon().then((d) => d.outlooks.map((o) => ({
    aor: o.aor, direction: o.direction, score: o.score, confidence: o.confidence, line: o.line,
  }))));

  const crewP = settle(Promise.all([listCrewRows(), getDemandHorizon().catch(() => null)]).then(([rows, d]) => {
    const summary = deriveAvailability(rows);
    const posture = postureAgainstDemand(summary, (d?.outlooks ?? []).map((o) => ({ aor: o.aor, direction: o.direction, score: o.score })), AOR_LABELS as Record<string, string>);
    return {
      headline: posture.headline, line: summary.line, stale: summary.stale, declared: summary.total > 0,
      mismatches: posture.lines.filter((l) => l.mismatch).map((l) => l.line),
    };
  }));

  const skillP = within(settle(getDemandSkill().then((s) => s.line)), 4_000);

  const [force, sitrep, boards, alerts, decisionsDue, demand, crew, demandSkill] = await Promise.all([forceP, sitrepP, boardsP, alertsP, decisionsP, demandP, crewP, skillP]);
  return { atISO: new Date().toISOString(), force, sitrep, boards, alerts, delta: null, decisionsDue, demand, crew, demandSkill };
}

/**
 * The shared snapshot (not per-user: posture/bases/boards/alerts are team
 * surfaces), fresh within FRESH_MS, else refreshed in the background. The
 * per-user "what changed since YOUR last look" delta is layered on by
 * `getOeSnapshotFor`.
 */
export async function getOeSnapshot(maxWaitMs = 2500): Promise<OeSnapshot | null> {
  if (cache && Date.now() - cache.at < FRESH_MS) return cache.snap;
  if (!inflight) {
    inflight = gather().then((snap) => { cache = { at: Date.now(), snap }; return snap; }).finally(() => { inflight = null; });
  }
  const fresh = await within(inflight, maxWaitMs);
  if (fresh) return fresh;
  return cache ? { ...cache.snap, stale: true } : null;
}

export async function getOeSnapshotFor(email: string, maxWaitMs = 2500): Promise<OeSnapshot | null> {
  const [snap, lastSeen, series] = await Promise.all([
    getOeSnapshot(maxWaitMs),
    within(settle(getAllLastSeen(email)), maxWaitMs),
    within(settle(buildOeSeries()), maxWaitMs),
  ]);
  if (!snap) return null;
  if (!series) return snap;
  const d = computeDelta(series, (lastSeen as Record<string, number> | null)?.oe);
  const name = (t: Transition) => `${t.label}${t.axis ? ` ${t.axis}` : ""}${t.from ? ` ${t.from}→${t.to}` : ` →${t.to}`}`;
  return {
    ...snap,
    delta: {
      line: d.line,
      worse: d.worse.map(name),
      better: d.better.map(name),
      fresh: d.fresh.map(name),
    },
  };
}

/** For tests / after config changes. */
export function resetOeContextCache(): void { cache = null; }
