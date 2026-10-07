// Gathers the OSINT command board's inputs — server-only. The join is in
// lib/commandBoard.ts and the ranking in lib/primer.ts (both pure, tested).
//
// Every source here is one the dashboard already caches in-process (force
// protection 10 min via forceProtectionCached, SITREP 10 min per base, I&W
// 10 min per board, demand 10 min, alerts 5 min, convergence 5 min), so a
// warm server answers in milliseconds. LATENCY RULE (the SITREP-read 502,
// the economy board, the demand tile): a request handler never awaits the
// bare assembly — `getCommandBoardBounded` serves a warm cache instantly,
// STARTS a cold assembly in the background and returns what settled within
// the wait, else the last body flagged `pending`, else a `pending` stub the
// client polls. The shared part (team surfaces) is cached once; the per-user
// part (the delta since YOUR last look) is layered on per request from the
// cheap history series.

import { getUserPrefs } from "./userPrefs";
import { getMissionProfile } from "./missionProfileApply";
import { getForceProtectionCached } from "./forceProtectionCached";
import { assembleSitrep, sitrepSummary, sitrepStub, type SitrepSummary } from "./sitrep";
import { activeWarningProblems } from "./warningProblems";
import { assessWarning } from "./warningAssess";
import { getDemandHorizon } from "./demandAssemble";
import { computeAlerts } from "./alerts";
import { getWeatherThreats, type NamedPoint } from "./severeWeather";
import { getAllStateAdvisories } from "./stateAdvisories";
import { getConflictPoints } from "./conflictEvents";
import { getConvergence } from "./convergenceAssemble";
import { listDueDecisions } from "./decisionStore";
import { listCrewRows } from "./crewStore";
import { deriveAvailability, postureAgainstDemand } from "./crewState";
import { getAllLastSeen } from "./surfaceState";
import { buildOeSeries } from "./oeDeltaAssemble";
import { computeDelta } from "./oeDelta";
import { aorFromCoords, aorFromCountry, classifyAor, AOR_LABELS, type Aor } from "./aor";
import { ALL_AIRFIELDS } from "./airfields";
import { normalizeCountryName } from "./countryNames";
import { EMPTY_MUST_TRACK, type MissionProfile, type MustTrack } from "./missionProfile";
import {
  commandBoard, type CommandBoard, type CommandInput, type CbPosture, type CbBoard, type CbSitrep, type CbDemand,
  type CbEvent, type CbDelta, type CbAlert, type CbOwnField,
} from "./commandBoard";
import { primer, type Primer, type PrimerConvergence, type PrimerDecision } from "./primer";

export interface CommandsBody {
  generatedAt: string;
  /** The user's last look at the OSINT tab (ms) the delta is anchored on; 0 = none. */
  sinceMs: number;
  board: CommandBoard;
  primer: Primer;
  mustTrack: MustTrack;
  ownFields: CbOwnField[];
  pending?: boolean;
  /** Set when the shared assembly threw — the board is a stub and says so. */
  error?: string;
}

const TTL = 5 * 60 * 1000;
export const DEFAULT_WAIT_MS = 8_000;

interface Shared {
  at: number;
  profile: MissionProfile;
  input: Omit<CommandInput, "sinceMs" | "delta">;
  convergence: PrimerConvergence[] | null;
  decisionsDue: PrimerDecision[] | null;
  sourcesDown: string[];
  alertsRaw: CbAlert[] | null;
}

let cache: Shared | null = null;
let inflight: Promise<Shared> | null = null;
let lastFailure: { at: number; message: string } | null = null;

const isAor = (s: string | null | undefined): s is Aor => !!s && s in AOR_LABELS && s !== "UNKNOWN";
const settle = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}

export function resetCommandsCache(): void { cache = null; lastFailure = null; }

// Country strings reach the board from four stores (posture rows, SITREP
// bases, the profile's hub/spokes, the resolver) and older rows carry ISO2
// codes ("DE", "IQ") from before `normalizeCountryName` existed. The board
// keys countries by name, so "DE" and "Germany" became two rows and "IQ"
// (Erbil) fell under the wrong command (REVIEW-2026-10 §11 R4). Normalise at
// THIS boundary — the one place every store meets — and classify the command
// from coordinates when they exist, else from the normalised name.
const country = (raw: string | null | undefined): string => normalizeCountryName(raw);
/** The command: the country decides when known (`classifyAor` is country-first),
 *  else the coordinates; a declared command is trusted only if it names one. */
function aorOf(lat: number | null | undefined, lon: number | null | undefined, name: string, declared?: string | null): Aor {
  const byCountry = aorFromCountry(name);
  if (byCountry !== "UNKNOWN") return byCountry;
  if (isAor(declared)) return declared;
  return classifyAor({ lat, lon, name });
}

function ownFieldsOf(profile: MissionProfile): CbOwnField[] {
  const out: CbOwnField[] = [];
  const hub = profile.home ?? (profile.homeIcao ? (() => {
    const a = ALL_AIRFIELDS.find((x) => x.icao === profile.homeIcao);
    return a ? { icao: a.icao, label: a.name, lat: a.lat, lon: a.lon, country: a.country ?? "United States" } : null;
  })() : null);
  if (hub) out.push({ icao: hub.icao, label: hub.label, role: "hub", country: country(hub.country) || "United States", lat: hub.lat, lon: hub.lon });
  for (const s of profile.spokes) if (!out.some((o) => o.icao === s.icao)) out.push({ icao: s.icao, label: s.label, role: "spoke", country: country(s.country) || "United States", lat: s.lat, lon: s.lon });
  return out;
}

async function gatherShared(): Promise<Shared> {
  const [prefs, profile] = await Promise.all([getUserPrefs().catch(() => null), getMissionProfile().catch(() => null)]);
  const mt = profile?.mustTrack ?? EMPTY_MUST_TRACK;
  const ownFields = profile ? ownFieldsOf(profile) : [];
  const countries = prefs?.countriesOfInterest ?? [];
  const bases = prefs?.forceLocations ?? [];
  const sourcesDown: string[] = [];

  // Posture.
  const postureP = settle(getForceProtectionCached(countries, bases).then((fp): CbPosture[] => fp.assessments.map((a) => ({
    id: a.id, label: a.label, kind: a.kind, country: country(a.country) || (a.kind === "country" ? country(a.label) : ""), aor: aorOf(a.lat, a.lon, country(a.country) || a.label, a.cocom),
    icao: a.icao, lat: a.lat, lon: a.lon, composite: a.composite, previousComposite: a.previousComposite ?? null,
    chronicity: a.chronicity?.state ?? null, topDriver: a.topDriver,
  }))));

  // SITREP summaries — every configured base, stubbed when its assembly fails.
  const sitrepBases = prefs?.sitrepBases ?? [];
  const sitrepP = settle(Promise.all(sitrepBases.map((b) => assembleSitrep(b).then(sitrepSummary).catch(() => sitrepStub(b)))).then((rows: SitrepSummary[]): CbSitrep[] =>
    rows.map((s) => ({ icao: s.icao, label: s.label, country: country(s.country), aor: isAor(s.aor) ? s.aor : aorOf(null, null, country(s.country)), status: s.status, driver: s.driver, worse: s.worse }))));

  // Boards — the declared command from ProblemGeo.aor.
  const boardsP = settle(activeWarningProblems().then(async (ps): Promise<CbBoard[]> => {
    const out: CbBoard[] = [];
    for (const p of ps) {
      const a = await assessWarning(p.def.id).catch(() => null);
      if (!a) continue;
      out.push({ problemId: a.problemId, label: a.label, aor: p.geo.aor, level: a.level, anomaly: a.anomaly, trajectory: a.trajectory, learning: a.learning, drivers: (a.drivers ?? []).map((d) => d.description) });
    }
    return out;
  }));

  // Demand (unbounded here — this runs in the background).
  const demandP = settle(getDemandHorizon().then((d): CbDemand[] => d.outlooks.map((o) => ({ aor: o.aor, direction: o.direction, score: o.score, confidence: o.confidence, line: o.line }))));

  // Events — significant disasters, departure advisories, kinetic events.
  const points: NamedPoint[] = [
    ...bases.map((b) => ({ label: b.label, lat: b.lat, lon: b.lon })),
    ...(prefs?.trackedLocations ?? []).map((t) => ({ label: t.label, lat: t.lat, lon: t.lon })),
  ];
  const eventsP = (async (): Promise<CbEvent[] | null> => {
    const [wx, adv, conflict] = await Promise.all([settle(getWeatherThreats(points)), settle(getAllStateAdvisories()), settle(getConflictPoints())]);
    if (!wx && !adv && !conflict) return null;
    if (!wx) sourcesDown.push("disasters"); if (!adv) sourcesDown.push("State advisories"); if (!conflict) sourcesDown.push("conflict events");
    const out: CbEvent[] = [];
    for (const d of wx?.disasters ?? []) {
      if (!(d.severity === "red" || d.nearLocations.length > 0 || d.hadrScore >= 55)) continue;
      out.push({ id: `d-${d.id}`, kind: "disaster", title: d.title, aor: d.aor, country: d.country, severity: d.severity === "red" || d.hadrScore >= 60 ? "red" : "amber", timeISO: d.time || null, lat: d.lat, lon: d.lon });
    }
    for (const z of wx?.hazards ?? []) {
      if (z.severity !== "severe") continue;
      out.push({ id: `hz-${z.label}`, kind: "weather", title: `${z.label}: ${z.flags.slice(0, 2).join(" · ")}`, aor: aorFromCoords(z.lat, z.lon), severity: "red", timeISO: null, lat: z.lat, lon: z.lon });
    }
    for (const a of adv ?? []) {
      if (!a.orderedDeparture && !a.authorizedDeparture) continue;
      out.push({ id: `neo-${a.country}`, kind: "neo", title: `${a.country} — ${a.orderedDeparture ? "ordered" : "authorized"} departure`, aor: isAor(a.aor) ? a.aor : classifyAor({ name: a.country }), country: a.country, severity: a.orderedDeparture ? "red" : "amber", timeISO: a.pubDate || null });
    }
    const top = (conflict ?? []).slice().sort((a, b) => b.count - a.count).slice(0, 24);
    for (const c of top) {
      out.push({ id: `k-${c.lat.toFixed(2)}-${c.lon.toFixed(2)}`, kind: "kinetic", title: c.title || c.name || "Kinetic activity", aor: aorFromCoords(c.lat, c.lon), country: c.country, severity: "red", timeISO: c.date ? `${c.date}T00:00:00Z` : null, lat: c.lat, lon: c.lon });
    }
    return out;
  })();

  // Convergence (the former "Forming" fold) and calls due.
  const convP = settle(getConvergence().then((c): PrimerConvergence[] => c.items.map((it) => {
    const aor = classifyAor({ name: it.subject });
    return { subject: it.subject, breadth: it.breadth, kinds: it.signals.map((s) => s.kind), aor: aor === "UNKNOWN" ? null : aor, country: aor === "UNKNOWN" ? null : it.subject };
  })));
  const dueP = settle(listDueDecisions(12));

  const [posture, sitreps, boards, demand, events, conv, due] = await Promise.all([postureP, sitrepP, boardsP, demandP, eventsP, convP, dueP]);
  if (!posture) sourcesDown.push("force posture"); if (!boards) sourcesDown.push("I&W"); if (!demand) sourcesDown.push("demand horizon");

  // Alerts, given an AOR by their subject.
  const alertsRaw = await settle(computeAlerts().then((c): CbAlert[] => c.alerts.map((a) => {
    let aor: Aor | null = null;
    if (a.id.startsWith("force-")) aor = posture?.find((p) => a.id === `force-${p.label}-red`)?.aor ?? null;
    else if (a.id.startsWith("neo-")) { const c = a.id.slice(4).replace(/-ordered$/, ""); aor = classifyAor({ name: c }); }
    else if (a.id.startsWith("iw-")) aor = boards?.find((b) => a.id.startsWith(`iw-${b.problemId}-`))?.aor ?? null;
    else if (a.id.startsWith("outage-")) aor = classifyAor({ name: a.id.slice(7) });
    return { id: a.id, severity: a.severity, kind: a.kind, title: a.title, sub: a.sub, aor: aor === "UNKNOWN" ? null : aor };
  })));

  // Crew mismatch per command.
  const crewMismatchAors: Aor[] = [];
  try {
    const rows = await listCrewRows();
    const summary = deriveAvailability(rows);
    const p = postureAgainstDemand(summary, (demand ?? []).map((o) => ({ aor: o.aor, direction: o.direction, score: o.score })), AOR_LABELS as Record<string, string>);
    for (const l of p.lines) if (l.mismatch && isAor(l.aor)) crewMismatchAors.push(l.aor);
  } catch { /* no crew state → no mismatch claim */ }

  const countryAors: Record<string, Aor> = {};
  for (const c of mt.countries) countryAors[c.trim().toLowerCase()] = classifyAor({ name: c });

  const dueRows: PrimerDecision[] | null = due
    ? due.map((d) => {
        const b = boards?.find((x) => x.problemId === d.problemId);
        return { problemId: d.problemId, label: b?.label ?? d.problemId, aor: b?.aor ?? null, call: d.call, dueISO: d.dueAt };
      })
    : null;

  return {
    at: Date.now(),
    profile: profile ?? ({ mustTrack: mt } as MissionProfile),
    input: { nowMs: Date.now(), mustTrack: mt, ownFields, posture, boards, sitreps, demand, events, alerts: alertsRaw, crewMismatchAors, countryAors },
    convergence: conv, decisionsDue: dueRows, sourcesDown, alertsRaw,
  };
}

function getShared(): Promise<Shared> {
  if (!inflight) {
    inflight = gatherShared()
      .then((s) => { cache = s; lastFailure = null; return s; })
      .catch((e) => { lastFailure = { at: Date.now(), message: e instanceof Error ? e.message : String(e) }; throw e; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** The per-user delta since the OSINT tab was last looked at. `sinceMs`
 *  overrides the stored last look so a poll mid-session keeps the same anchor. */
async function userDelta(email: string, sinceOverride?: number): Promise<{ sinceMs: number; delta: CbDelta[] | null; shared: Shared | null }> {
  const [lastSeen, series] = await Promise.all([
    sinceOverride != null ? Promise.resolve(null) : settle(getAllLastSeen(email)),
    settle(buildOeSeries()),
  ]);
  const sinceMs = sinceOverride ?? ((lastSeen as Record<string, number> | null)?.osint ?? 0);
  if (!series) return { sinceMs, delta: null, shared: null };
  const d = computeDelta(series, sinceMs, Date.now(), { max: 40 });
  return { sinceMs, delta: [...d.worse, ...d.better, ...d.fresh].map((t) => ({
    kind: t.kind, id: t.id, label: t.label, axis: t.axis, from: t.from, to: t.to, direction: t.direction, aor: null,
  })), shared: null };
}

function placeDeltas(deltas: CbDelta[] | null, shared: Shared): CbDelta[] | null {
  if (!deltas) return null;
  const posture = shared.input.posture ?? [];
  const sitreps = shared.input.sitreps ?? [];
  const boards = shared.input.boards ?? [];
  const lc = (s: string) => s.trim().toLowerCase();
  return deltas.map((d) => {
    if (d.kind === "posture") {
      const key = d.id.replace(/^[cb]:/, "");
      const p = posture.find((x) => lc(x.label) === key || lc(x.country) === key || lc(x.label) === lc(d.label));
      return { ...d, aor: p?.aor ?? null, country: p?.country ?? null, icao: p?.icao ?? null };
    }
    if (d.kind === "sitrep") {
      const icao = d.id.split(":")[0];
      const s = sitreps.find((x) => x.icao === icao) ?? null;
      const p = posture.find((x) => x.icao === icao) ?? null;
      return { ...d, aor: s?.aor ?? p?.aor ?? null, country: s?.country ?? p?.country ?? null, icao };
    }
    const b = boards.find((x) => x.problemId === d.id);
    return { ...d, aor: b?.aor ?? null };
  });
}

function bodyFrom(shared: Shared, sinceMs: number, delta: CbDelta[] | null, pending = false): CommandsBody {
  const placed = placeDeltas(delta, shared);
  const input: CommandInput = { ...shared.input, nowMs: Date.now(), sinceMs, delta: placed };
  const board = commandBoard(input);
  const pr = primer({ ...input, convergence: shared.convergence, decisionsDue: shared.decisionsDue, sourcesDown: shared.sourcesDown });
  return { generatedAt: new Date(shared.at).toISOString(), sinceMs, board, primer: pr, mustTrack: shared.input.mustTrack, ownFields: shared.input.ownFields, ...(pending ? { pending: true } : {}) };
}

function stub(sinceMs: number, note: string, error?: string): CommandsBody {
  const input: CommandInput = { nowMs: Date.now(), sinceMs, mustTrack: EMPTY_MUST_TRACK, ownFields: [], posture: null, boards: null, sitreps: null, demand: null, events: null, delta: null, alerts: null, crewMismatchAors: [] };
  const board = commandBoard(input);
  const pr = primer({ ...input, convergence: null, decisionsDue: null, sourcesDown: [note] });
  return { generatedAt: new Date().toISOString(), sinceMs, board, primer: pr, mustTrack: EMPTY_MUST_TRACK, ownFields: [], pending: !error, ...(error ? { error } : {}) };
}

/** Bounded: a warm shared cache + this user's delta instantly; a cold shared
 *  assembly is started and whatever settles within `maxWaitMs` is returned;
 *  else the last body flagged `pending`; else a pending stub. */
export async function getCommandBoardBounded(email: string, opts: { maxWaitMs?: number; since?: number } = {}): Promise<CommandsBody> {
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_WAIT_MS;
  const deltaP = userDelta(email, opts.since);
  if (cache && Date.now() - cache.at < TTL) {
    const u = await deltaP;
    return bodyFrom(cache, u.sinceMs, u.delta);
  }
  if (lastFailure && Date.now() - lastFailure.at < 60_000 && !inflight) {
    const u = await deltaP;
    return cache ? bodyFrom(cache, u.sinceMs, u.delta) : stub(u.sinceMs, `assembly failed: ${lastFailure.message}`, lastFailure.message);
  }
  const shared = await within(getShared(), maxWaitMs);
  const u = await deltaP;
  if (shared) return bodyFrom(shared, u.sinceMs, u.delta);
  if (cache) return bodyFrom(cache, u.sinceMs, u.delta, true);
  if (lastFailure && Date.now() - lastFailure.at < 60_000) return stub(u.sinceMs, `assembly failed: ${lastFailure.message}`, lastFailure.message);
  return stub(u.sinceMs, "assembling the command picture — first load takes a moment");
}

/** The whole board, however long it takes — exports and the AI read use this. */
export async function getCommandBoard(email: string, since?: number): Promise<CommandsBody> {
  const shared = cache && Date.now() - cache.at < TTL ? cache : await getShared();
  const u = await userDelta(email, since);
  return bodyFrom(shared, u.sinceMs, u.delta);
}
