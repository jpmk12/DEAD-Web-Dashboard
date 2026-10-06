// Gathers the demand-horizon inputs from sensors the app already runs —
// server-only. The judgement is in lib/demandHorizon.ts (pure, tested).
//
// Every source here is cached upstream (force protection 10 min via
// forceProtectionCached, I&W 10 min, advisories 30 min, chokepoints 15 min)
// except getWeatherThreats, whose disaster fan-out this module memoises
// itself. The assembled outlook is cached 10 min; a source that fails is
// simply absent from the inputs — the outlook's confidence, being a count of
// sources, drops accordingly, and the response lists which sources answered
// so an all-HOLD board is never mistaken for a quiet world.

import { getUserPrefs } from "./userPrefs";
import { getForceProtectionCached } from "./forceProtectionCached";
import { getWeatherThreats, type NamedPoint } from "./severeWeather";
import { getAllStateAdvisories } from "./stateAdvisories";
import { activeWarningProblems } from "./warningProblems";
import { assessWarning } from "./warningAssess";
import { getChokepointReads } from "./chokepointReads";
import { aorFromCoords, AOR_LABELS, type Aor } from "./aor";
import { demandHorizon, HORIZON_DAYS, type DemandInput, type DemandOutlook } from "./demandHorizon";
import { recordDemandOutlooks } from "./demandStore";
import { getPostureMovesFull } from "./postureMovesAssemble";

export interface DemandHorizonBody {
  horizonDays: number;
  generatedAt: string;
  outlooks: DemandOutlook[];
  /** Which sensor families answered this pass. */
  sources: Record<"iw" | "disaster" | "neo" | "posture" | "chokepoint" | "move", boolean>;
}

const TTL = 10 * 60 * 1000;
let cache: { at: number; body: DemandHorizonBody } | null = null;
let inflight: Promise<DemandHorizonBody> | null = null;

const isAor = (s: string): s is Aor => s in AOR_LABELS;

/** The whole outlook, however long the cold assembly takes. Heartbeat and
 *  exports use this; a REQUEST HANDLER must use the bounded form. */
export async function getDemandHorizon(): Promise<DemandHorizonBody> {
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  if (inflight) return inflight;
  inflight = assemble().then((body) => { cache = { at: Date.now(), body }; return body; }).finally(() => { inflight = null; });
  return inflight;
}

/** Bounded: a warm cache instantly; a cold assembly is STARTED and whatever
 *  settles within `maxWaitMs` is returned — else the last body flagged
 *  `pending`, else a pending stub. The Glance Demand tile sat on "loading"
 *  (2026-10-05) because the route awaited the bare assembly and the gateway
 *  answered 502 first. Same contract as spectrum and the economy board. */
export async function getDemandHorizonBounded(maxWaitMs = 8_000): Promise<DemandHorizonBody & { pending?: boolean }> {
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  const p = getDemandHorizon();
  const settled = await new Promise<DemandHorizonBody | null>((resolve) => {
    const t = setTimeout(() => resolve(null), maxWaitMs);
    p.then((b) => { clearTimeout(t); resolve(b); }, () => { clearTimeout(t); resolve(null); });
  });
  if (settled) return settled;
  if (cache) return { ...cache.body, pending: true };
  return { horizonDays: HORIZON_DAYS, generatedAt: new Date().toISOString(), outlooks: [], sources: { iw: false, disaster: false, neo: false, posture: false, chokepoint: false, move: false }, pending: true };
}

export function resetDemandHorizonCache(): void { cache = null; }

async function assemble(): Promise<DemandHorizonBody> {
  const prefs = await getUserPrefs().catch(() => null);
  const countries = prefs?.countriesOfInterest ?? [];
  const bases = prefs?.forceLocations ?? [];
  const points: NamedPoint[] = [
    ...bases.map((b) => ({ label: b.label, lat: b.lat, lon: b.lon })),
    ...(prefs?.trackedLocations ?? []).map((t) => ({ label: t.label, lat: t.lat, lon: t.lon })),
  ];

  const sources: DemandHorizonBody["sources"] = { iw: false, disaster: false, neo: false, posture: false, chokepoint: false, move: false };
  const input: DemandInput = {
    today: new Date().toISOString().slice(0, 10),
    watchedAors: [], boards: [], disasters: [], advisories: [], posture: [], chokepoints: [], moves: [],
  };

  await Promise.all([
    // Posture — also defines the watched AORs.
    getForceProtectionCached(countries, bases).then((fp) => {
      sources.posture = true;
      for (const a of fp.assessments) {
        const aor = isAor(a.cocom) ? a.cocom : "UNKNOWN";
        if (aor !== "UNKNOWN" && !input.watchedAors.includes(aor)) input.watchedAors.push(aor);
        input.posture.push({
          label: a.label, aor, composite: a.composite, escalated: !!a.previousComposite,
          chronic: a.chronicity?.state === "chronic",
        });
      }
    }).catch(() => {}),

    // I&W boards — the AOR is the board's DECLARED command (ProblemGeo.aor),
    // not the bbox centre, so the horizon and the command board agree.
    activeWarningProblems().then(async (ps) => {
      sources.iw = true;
      for (const p of ps) {
        const a = await assessWarning(p.def.id).catch(() => null);
        if (!a) continue;
        input.boards.push({ label: a.label, aor: p.geo.aor, level: a.level, trajectory: a.trajectory, learning: a.learning });
      }
    }).catch(() => {}),

    // Disasters — the shared feed, with near-base flags from the same call.
    getWeatherThreats(points).then((wx) => {
      sources.disaster = true;
      for (const d of wx.disasters) {
        input.disasters.push({
          title: d.title, aor: d.aor, severity: d.severity, hadrScore: d.hadrScore, timeISO: d.time,
          nearBase: d.nearLocations.length > 0,
        });
      }
    }).catch(() => {}),

    // NEO posture.
    getAllStateAdvisories().then((adv) => {
      sources.neo = true;
      for (const a of adv) {
        if (!a.orderedDeparture && !a.authorizedDeparture) continue;
        input.advisories.push({
          country: a.country, aor: isAor(a.aor) ? a.aor : "UNKNOWN",
          ordered: a.orderedDeparture, authorized: a.authorizedDeparture, pubDate: a.pubDate,
        });
      }
    }).catch(() => {}),

    // Posture moves in the reporting (lib/postureMoves over the defense
    // feeds). The sweep's own cache is 15 min; here it rides the 10-min one.
    getPostureMovesFull().then((pm) => {
      if (pm.pending) return;
      sources.move = true;
      for (const m of pm.moves) {
        input.moves!.push({ headline: m.headline, aor: m.aor, kind: m.kind, actor: m.actor, side: m.side, pubDate: m.pubDate, sources: m.sources });
      }
    }).catch(() => {}),

    // Chokepoints.
    getChokepointReads().then((cp) => {
      sources.chokepoint = true;
      for (const s of cp.signals) {
        input.chokepoints.push({ name: s.name, aor: aorFromCoords(s.lat, s.lon), score: s.score, acts: s.acts, threats: s.threats, transit: s.transit?.state });
      }
    }).catch(() => {}),
  ]);

  const outlooks = demandHorizon(input);
  // The forecast of record for today (LAST policy: a later pass supersedes).
  // Scored 7 days later by lib/demandVerifyAssemble. Fire-and-forget.
  recordDemandOutlooks(input.today, outlooks).catch(() => {});
  return {
    horizonDays: HORIZON_DAYS,
    generatedAt: new Date().toISOString(),
    outlooks,
    sources,
  };
}
