// Economic-warfare assembler — server-only. Resolves the actor register from
// the tracking picture, gathers the evidence each actor's board needs from
// feeds THIS REPO ALREADY HAS, grades it through the pure grammar
// (lib/economicWarfare), folds each actor through the existing I&W engine
// (lib/warning) against that actor's own trailing baseline in warning_daily
// (problem ids `econ-<actor>`), and returns actor tiles + the coercion board.
// Lazy-on-request, 10-min in-process cache, no model call, no cron — the
// codebase-native pattern (lib/warningAssess).
//
// Sensors, all fail-safe and time-bounded (an unreachable feed degrades to
// UNKNOWN, never a hang, never a false calm):
//   · GDELT DOC — one topical query per actor (actor terms × instrument
//     vocabulary, 7 days), cached 60 min in lib/localNews.
//   · The user's own sources (X captures, newsletters, captured articles,
//     OSINT feeds) through the SAME gatherer the I&W boards use, gated by the
//     actor's mention terms. Own-source-only caps at watching.
//   · The chokepoint board's graded reads + AIS transits, for the shipping
//     instrument at the straits an actor is the presumed coercer of.
//   · The Federal Register (OFAC / BIS / USTR) for the counter-pressure
//     indicator and the U.S. side of the coercion board.
//   · Energy quotes, as CORROBORATION on the board — a price move is never
//     attributed to an actor.

import { deriveWarning, scoreIndicators, type WarningAssessment } from "./warning";
import {
  resolveActorRegister, actorProblem, movesForAll, rankMoves, evidenceByInstrument, instrumentState, targetOf, TEXT_WINDOW_DAYS, NOTICE_HOSTS,
  counterPressureState, observation, instrumentForRegulatoryClass, econProblemId, ageDaysOf,
  INSTRUMENTS, INSTRUMENT_META, COUNTER_PRESSURE_ID, MAX_ACTORS,
  type Actor, type CoercionMove, type ActorText, type Instrument, type GradedEvidence, type TrackedName, type SkippedActor,
} from "./economicWarfare";
import type { Modality } from "./chokepointSignals";
import { EMPTY_ECONOMY, type EconomyEdits } from "./missionProfile";
import { chokepointState } from "./warningRules";
import { recordWarningDay, getWarningBaseline, getWarningAnomalyHistory } from "./warningStore";
import { getChokepointReads, type ChokepointRead } from "./chokepointReads";
import { getRegulatoryDocs } from "./federalRegister";
import { getForeignSanctions } from "./foreignSanctions";
import { getCisaAdvisories } from "./cyberSources";
import { advisoriesNaming } from "./cyberSignals";
import { designationWaves, type DesignationWave } from "./foreignSanctionsParse";
import { buildTimeline, type TimelineDot, type Sequence, type ShippingIncident } from "./economicTimeline";
import { getSensorSeries } from "./sensorStore";
import { sensorKey } from "./sensorKeys";
import { precedes, type LeadResult } from "./series";
import { leverageFor, type LeverageEntry } from "./leverage";
import { getCapturedNotices } from "./noticeStore";
import { actorForNoticeHost, readOfficialNotice } from "./economicWarfare";
import { enrich, CLASS_LABEL, type RegulatoryAction } from "./regulatorySignals";
import { getEnergyQuotes, type EnergyQuote } from "./energyPrices";
import { gdeltSearch } from "./localNews";
import { gatherUserSourceNews } from "./warningSensors";
import { getUserPrefs } from "./userPrefs";
import { getMissionProfile } from "./missionProfileApply";
import type { NewsItem } from "./types";

export interface InstrumentSummary {
  instrument: Instrument;
  state: WarningAssessment["indicators"][number]["state"];
  confidence: number;
  why: string;
  /** Number of the actor's own moves on this instrument in the window. */
  moves: number;
  /** The strongest of the actor's own moves on this instrument — the
   *  headline the driver line quotes (REVIEW-2026-10 §10 E7). */
  lead?: { title: string; modality: Modality; link?: string; source?: string };
}

export interface ActorBoard {
  actor: { id: string; label: string; kind: Actor["kind"]; aor: Actor["aor"]; reason: string; chokepointIds: string[] };
  assessment: WarningAssessment;
  /** Daily samples behind the baseline — "day N of 14" while learning. */
  baselineSamples: number;
  /** Headlines in the window that NAME the actor (authored or not), so a
   *  quiet tile can say "named in 12 headlines, authored none". */
  mentions: number;
  instruments: InstrumentSummary[];
  counterPressure: { state: InstrumentSummary["state"]; why: string; count14d: number };
  /** Instrument-level corroboration, so the tile can say "AIS suppressed" or "Brent +4%". */
  corroboration: string[];
  sensorHealth: { sensor: string; live: boolean; note?: string }[];
}

export interface EconomicWarfareBody {
  actors: ActorBoard[];
  /** Tracked names that did NOT become actors, each with its fix (§10 E1). */
  skipped: SkippedActor[];
  /** The operator's register overlay, echoed so the editor renders from one fetch. */
  edits: EconomyEdits;
  /** The coercion board — every actor's moves (by and against), ranked. */
  moves: (CoercionMove & { corroboration: string[]; affects: string })[];
  energy: { symbol: string; label: string; changePct: number | null; price: number | null }[];
  /** Moves & counter-moves over the last 30 days, and the sequences found. */
  timeline: {
    days: string[]; dots: TimelineDot[]; sequences: Sequence[];
    /** Did a reported act at Hormuz / Bab-el-Mandeb precede the Brent day-moves plotted here (≤3 d)? Null below three moves. */
    lag?: LeadResult | null;
  };
  /** Structural, not warning — curated capacity per actor, never coloured. */
  leverage: Record<string, LeverageEntry>;
  /** EU / UK designation waves in the window (the foreign half of the record). */
  foreign: { waves: DesignationWave[]; live: { EU: boolean; UK: boolean }; failed: string[] };
  generatedAt: string;
  windowDays: number;
  sources: { gdelt: boolean; ownSources: string[]; federalRegister: boolean; foreign: boolean; chokepoints: boolean; energy: boolean };
  note: string;
  /** True when the assembly is still running and this body is a stub or a
   *  stale previous pass — the client should ask again. */
  pending?: boolean;
}

const TTL = 10 * 60 * 1000;
let cache: { at: number; body: EconomicWarfareBody } | null = null;
let inflight: Promise<EconomicWarfareBody> | null = null;

export function resetEconomicWarfareCache(): void { cache = null; }

/**
 * Latency rule (the SITREP-read 502 lesson, same as getOeSnapshot): a warm
 * cache answers instantly; a cold one STARTS the assembly in the background
 * and this call returns whatever settles within `maxWaitMs`. If nothing
 * does, it returns a `pending` stub — the caller shows "assembling" and asks
 * again — rather than idling the request past the platform gateway timeout,
 * which surfaces to the user as an HTML 502 that no JSON parser survives.
 */
export async function getEconomicWarfare(opts: { maxWaitMs?: number } = {}): Promise<EconomicWarfareBody> {
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  if (!inflight) {
    inflight = compute()
      .then((b) => { cache = { at: Date.now(), body: b }; lastFailure = null; return b; })
      .catch((e) => { lastFailure = { at: Date.now(), message: e instanceof Error ? e.message : String(e) }; throw e; })
      .finally(() => { inflight = null; });
  }
  // 8 s, not 20: the platform gateway cuts a request well before 20 s and
  // answers the browser with an HTML 502 — which the board can only report as
  // "unavailable". The board polls while `pending`, so a short wait costs
  // nothing but one more round trip.
  const maxWait = opts.maxWaitMs ?? DEFAULT_WAIT_MS;
  const settled = await withTimeout(inflight, maxWait);
  if (settled) return settled;
  // The assembly THREW (not merely slow): say so, and stop the client
  // polling — a failed pass is a finding ("UNKNOWN, not calm"), not a wait.
  if (!inflight && lastFailure && Date.now() - lastFailure.at < FAILURE_HOLD_MS) return failedStub(lastFailure.message);
  // Still assembling. Serve the last body if there is one (stale beats
  // nothing), else an honest stub.
  if (cache) return { ...cache.body, pending: true };
  return pendingStub();
}

export const DEFAULT_WAIT_MS = 8_000;
/** How long a thrown assembly is reported before the next call retries it. */
const FAILURE_HOLD_MS = 60_000;
let lastFailure: { at: number; message: string } | null = null;

function emptyBody(note: string, pending: boolean): EconomicWarfareBody {
  const now = new Date().toISOString();
  return {
    actors: [], skipped: [], edits: { ...EMPTY_ECONOMY }, moves: [], energy: [],
    timeline: { days: [], dots: [], sequences: [] }, leverage: {},
    foreign: { waves: [], live: { EU: false, UK: false }, failed: ["EU", "UK"] },
    generatedAt: now, windowDays: 14,
    sources: { gdelt: false, ownSources: [], federalRegister: false, foreign: false, chokepoints: false, energy: false },
    note,
    ...(pending ? { pending: true } : {}),
  };
}

function pendingStub(): EconomicWarfareBody {
  return emptyBody("Assembling the actor register — the first pass after a deploy reads every feed cold and can take a minute. Ask again shortly.", true);
}

function failedStub(message: string): EconomicWarfareBody {
  return emptyBody(`Actor register assembly failed (${message.slice(0, 160)}). Every actor is UNKNOWN, not calm — the next open retries.`, false);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const to = new Promise<null>((res) => { timer = setTimeout(() => res(null), ms); });
  return Promise.race([p.catch(() => null), to]).finally(() => clearTimeout(timer)) as Promise<T | null>;
}

// The tracking picture, in priority order: Mission Profile AOI countries
// (declaration order), then watched countries, then base host nations —
// each with WHERE it is tracked, so a tile and a skipped row can say so.
async function trackedCountries(): Promise<{ tracked: TrackedName[]; edits: EconomyEdits }> {
  const out: TrackedName[] = [];
  const profile = await withTimeout(getMissionProfile(), 5000);
  for (const aoi of profile?.aois ?? []) for (const c of aoi.countries) out.push({ name: c, reason: `AOI “${aoi.name}”` });
  const prefs = await withTimeout(getUserPrefs(), 5000);
  for (const c of prefs?.countriesOfInterest ?? []) out.push({ name: c.country, reason: "watched country" });
  for (const l of prefs?.forceLocations ?? []) if (l.country) out.push({ name: l.country, reason: `host of ${l.label || l.icao || "a tracked base"}` });
  return {
    tracked: out.map((t) => ({ ...t, name: (t.name || "").trim() })).filter((t) => t.name),
    edits: profile?.economy ?? { ...EMPTY_ECONOMY },
  };
}

// Instrument vocabulary for the GDELT query — broad on purpose; the grammar
// does the grading afterwards, so a wide net costs nothing but bandwidth.
const INSTRUMENT_QUERY = '(sanctions OR tariffs OR "export controls" OR "rare earth" OR tanker OR "oil exports" OR "gas supplies" OR pipeline OR embargo OR SWIFT OR "airspace" OR overflight OR seized OR blockade)';

function actorQuery(actor: Actor): string {
  const names = actor.countries.map((c) => `"${c}"`);
  if (actor.kind === "nonstate") names.unshift(`"${actor.label.split(" (")[0]}"`);
  return `(${[...new Set(names)].join(" OR ")}) ${INSTRUMENT_QUERY} sourcelang:english`;
}

const quoteLine = (q: EnergyQuote): string | null =>
  q.changePct == null ? null : `${q.label.replace(/ \(.*\)$/, "")} ${q.changePct >= 0 ? "+" : ""}${q.changePct}%`;

async function compute(): Promise<EconomicWarfareBody> {
  const observedAt = new Date().toISOString();
  const day = observedAt.slice(0, 10);
  const todayMs = Date.parse(`${day}T00:00:00Z`);

  const { tracked, edits } = await trackedCountries();
  const register = resolveActorRegister(tracked, edits);
  const actors = register.actors.slice(0, MAX_ACTORS);

  const cpIds = [...new Set(actors.flatMap((a) => a.chokepointIds))];
  const [reg, energy, cps, foreign, cisa] = await Promise.all([
    withTimeout(getRegulatoryDocs(), 15_000),
    withTimeout(getEnergyQuotes(), 12_000),
    cpIds.length ? withTimeout(getChokepointReads(cpIds), 15_000) : Promise.resolve(null),
    // The EU list is tens of MB. Its fetch keeps running (and caches 24 h in
    // its own lib) if this pass gives up on it; the next pass gets it warm.
    withTimeout(getForeignSanctions(), 8_000),
    // CISA / JCDC advisories: a state-attributed advisory is a `by` cyber act.
    withTimeout(getCisaAdvisories(), 8_000),
  ]);
  const waves = foreign ? designationWaves(foreign.rows, day, 45) : [];
  const notices = (await withTimeout(getCapturedNotices(300), 6000)) ?? [];

  const watched = [...new Set(actors.flatMap((a) => a.countries))];
  const actions: RegulatoryAction[] = reg ? enrich(reg.docs, watched, day) : [];
  const cpById = new Map<string, ChokepointRead>((cps?.signals ?? []).map((s) => [s.id, s]));
  const energyLines = (energy ?? []).map(quoteLine).filter((s): s is string => !!s);
  const brent = (energy ?? []).find((q) => q.symbol === "brent");

  const ownSources = new Set<string>();
  let gdeltLive = false;

  // The user's own sources are gathered ONCE (match-all gate) and filtered
  // per actor below — before this, the X/newsletter/captured-article/OSINT-
  // feed fan-out ran once PER ACTOR, eight times over on a cold start.
  const ownAll = actors.length
    ? await gatherUserSourceNews({ terms: /./ }).catch(() => ({ items: [] as NewsItem[], sources: new Set<string>() }))
    : { items: [] as NewsItem[], sources: new Set<string>() };
  const ownSourceOf = (n: NewsItem): string =>
    n.source.startsWith("𝕏") ? "X" : n.source.startsWith("✉") ? "newsletters" : n.source.startsWith("📄") ? "analysis" : "OSINT feeds";

  const boards: ActorBoard[] = [];
  const allMoves: EconomicWarfareBody["moves"] = [];
  const incidents: ShippingIncident[] = [];
  const leverage: Record<string, LeverageEntry> = {};

  // Phase 1 — gather. Actors are read sequentially: GDELT enforces
  // 1 request / 5 s and each query is cached 60 min, so after the first pass
  // this loop is free; on the first pass a burst would only earn 429s.
  const gathered = new Map<string, { news: NewsItem[] | null; own: { items: NewsItem[]; sources: Set<string> } }>();
  const pool: ActorText[] = [];
  const pooled = new Set<string>();
  const addText = (n: NewsItem, own: boolean) => {
    const key = (n.link || n.title).trim().toLowerCase();
    if (!key || pooled.has(key)) return;
    pooled.add(key);
    pool.push({ title: n.title, summary: n.summary, link: n.link, source: n.source, pubDate: n.pubDate, own });
  };
  for (const actor of actors) {
    const news = await withTimeout(gdeltSearch(actorQuery(actor), { cacheKey: `econ:${actor.id}`, timespan: "7d", maxrecords: 40, keep: 30, source: "wire", category: "econ" }), 8_000);
    if (news && news.length) gdeltLive = true;
    const ownItems = ownAll.items.filter((n) => actor.terms.test(`${n.title} ${n.summary ?? ""}`));
    const own = { items: ownItems, sources: new Set(ownItems.map(ownSourceOf)) };
    for (const s of own.sources) ownSources.add(s);
    gathered.set(actor.id, { news, own });
    for (const n of news ?? []) addText(n, false);
    for (const n of ownItems) addText(n, true);
  }

  // Phase 2 — ONE pass over the pooled texts for the whole register, so a
  // headline naming several tracked actors is credited to its one author
  // and merely NAMES the rest (REVIEW-2026-10 §10 E2 — before this, each
  // actor graded its own copy of the same headline and four boards lit).
  const pooledMoves = movesForAll(actors, pool, todayMs);
  const mentionsOf = (actor: Actor): number => pool.filter((t) => {
    const age = ageDaysOf(t.pubDate, todayMs);
    return (age == null || age <= TEXT_WINDOW_DAYS) && actor.terms.test(`${t.title} ${t.summary ?? ""}`);
  }).length;

  // Phase 3 — per actor: the official records, the strait credit, the
  // ladder, the engine.
  for (const actor of actors) {
    const { news, own } = gathered.get(actor.id)!;
    const moves = pooledMoves.filter((m) => m.actorId === actor.id);

    // The actor's OWN official record (browser-captured ministry notices —
    // MOFCOM for China): a published notice is a reported act BY the actor,
    // the same standing a Federal Register document has on the U.S. side.
    const own_notices = notices.filter((n) => actorForNoticeHost(n.host)?.actorId === actor.id);
    for (const n of own_notices) {
      const age = ageDaysOf(n.publishedOn ?? undefined, todayMs);
      if (age != null && age > TEXT_WINDOW_DAYS) continue;
      const r = readOfficialNotice(`${n.title} ${n.body ?? ""}`);
      if (!r) continue;
      const label = actorForNoticeHost(n.host)?.label ?? "official notice";
      moves.push({
        id: `${actor.id}:notice:${n.id}`, actorId: actor.id, actorLabel: actor.label, direction: "by",
        target: targetOf(`${n.title} ${n.body ?? ""}`, r.instrument, actor), instrument: r.instrument, cls: r.cls, modality: r.modality, weight: r.weight,
        title: n.title, link: n.url, source: label, pubDate: n.publishedOn ?? undefined, ageDays: age, own: false, phrase: r.phrase,
      });
    }
    // CISA / JCDC advisories naming this actor's state: a primary record of
    // a cyber act BY the actor (the standing a Federal Register document
    // has on the U.S. side). Wire-grade, so it can confirm.
    const named = cisa?.live ? advisoriesNaming(cisa.items, actor.countries, todayMs, TEXT_WINDOW_DAYS) : [];
    for (const a of named) {
      const key = (a.link ?? a.title).toLowerCase();
      if (moves.some((m) => (m.link ?? m.title).toLowerCase() === key)) continue;
      moves.push({
        id: `${actor.id}:cisa:${key.slice(0, 80)}`, actorId: actor.id, actorLabel: actor.label, direction: "by",
        target: "United States", instrument: "cyber", cls: "state-attributed advisory", modality: "act", weight: 80,
        title: a.title, link: a.link, source: "CISA advisory", pubDate: a.pubDate, ageDays: a.ageDays, own: false, phrase: a.actors.join("/"),
      });
    }
    const evidence = evidenceByInstrument(moves);

    // Shipping by geography: a graded act at a strait this actor is the
    // presumed coercer of counts as their shipping evidence, and the
    // chokepoint indicator's own ladder (with AIS) sets a floor on the state.
    const cpReads = actor.chokepointIds.map((id) => cpById.get(id)).filter((r): r is ChokepointRead => !!r);
    const corroboration: string[] = [];
    let shippingFloor: ReturnType<typeof chokepointState> | null = null;
    for (const r of cpReads) {
      const s = chokepointState({ acts: r.acts, threats: r.threats, analysis: r.analysis, events: r.totalEvents, score: r.score, transit: r.transit?.state }, 0);
      if (!shippingFloor || rankState(s.state) > rankState(shippingFloor.state)) shippingFloor = { ...s, why: `${r.name}: ${s.why}` };
      if (r.transit && (r.transit.state === "suppressed" || r.transit.state === "elevated")) corroboration.push(`AIS ${r.name}: ${r.transit.line}`);
      if (r.lead) {
        const ev: GradedEvidence = { modality: r.lead.modality, own: false, source: `chokepoint:${r.id}` };
        evidence.shipping.push(ev);
        const key = `${actor.id}:shipping:cp:${r.id}`;
        if (!moves.some((m) => m.link && m.link === r.lead?.link)) {
          moves.push({
            id: key, actorId: actor.id, actorLabel: actor.label, direction: "by", target: "commercial shipping",
            instrument: "shipping", cls: r.lead.cls, modality: r.lead.modality, weight: r.lead.weight,
            title: r.lead.title, link: r.lead.link, source: r.lead.source ? `${r.lead.source} · ${r.name}` : r.name, pubDate: r.lead.pubDate,
            ageDays: ageDaysOf(r.lead.pubDate, todayMs), own: false, phrase: r.lead.phrase,
          });
        }
      }
    }

    // Observations: one per instrument from the graded evidence, the
    // shipping floor from the strait ladder, counter-pressure from the
    // Federal Register.
    const observations = [];
    const instruments: InstrumentSummary[] = [];
    for (const inst of INSTRUMENTS) {
      let s = instrumentState(evidence[inst]);
      if (inst === "shipping" && shippingFloor && rankState(shippingFloor.state) > rankState(s.state)) s = shippingFloor;
      const prov = inst === "shipping" && cpReads.length ? `GDELT + own sources + chokepoint read (${cpReads.map((r) => r.name).join(", ")})` : "GDELT + own sources";
      observations.push(observation(inst, `econ:${inst}`, s, observedAt, prov, evidence[inst].length));
      const ownMoves = rankMoves(moves.filter((m) => m.direction === "by" && m.instrument === inst));
      const lead = ownMoves[0];
      instruments.push({
        instrument: inst, state: s.state, confidence: s.confidence, why: s.why, moves: ownMoves.length,
        ...(lead ? { lead: { title: lead.title, modality: lead.modality, link: lead.link, source: lead.source } } : {}),
      });
    }

    const naming = actions.filter((a) => a.countries.some((c) => actor.countries.includes(c)));
    const actorWaves = waves.filter((w) => w.country && actor.countries.includes(w.country));
    const waveAges = actorWaves.map((w) => Math.max(0, Math.round((todayMs - Date.parse(`${w.day}T00:00:00Z`)) / 86_400_000)));
    const cp = counterPressureState([...naming.map((a) => a.ageDays), ...waveAges]);
    observations.push(observation(COUNTER_PRESSURE_ID, "federalRegister", cp, observedAt, `Federal Register${actorWaves.length ? " + EU/UK lists" : ""}`, naming.length + actorWaves.length));
    for (const w of actorWaves) {
      const age = Math.max(0, Math.round((todayMs - Date.parse(`${w.day}T00:00:00Z`)) / 86_400_000));
      if (age > 14) continue;
      moves.push({
        id: `${actor.id}:${w.source.toLowerCase()}:${w.programme}:${w.day}`, actorId: actor.id, actorLabel: actor.label, direction: "against", target: actor.label,
        instrument: "sanctions", cls: `${w.source} designations · ${w.programme}`, modality: "act", weight: 65,
        title: `${w.count} new ${w.source} listing${w.count === 1 ? "" : "s"} under ${w.programme}`,
        link: w.source === "EU" ? "https://www.sanctionsmap.eu/" : "https://www.gov.uk/government/publications/the-uk-sanctions-list",
        source: w.source === "EU" ? "EU consolidated list" : "UK sanctions list", pubDate: w.day, ageDays: age, own: false, phrase: `${w.source} ${w.programme}`,
      });
    }
    for (const r of cpReads) for (const e of r.events) incidents.push({ date: e.date, title: e.title, chokepointName: r.name, actorId: actor.id, actorLabel: actor.label });
    const lev = leverageFor(actor.id);
    if (lev) leverage[actor.id] = lev;
    for (const a of naming.filter((x) => x.ageDays <= 14)) {
      moves.push({
        id: `${actor.id}:fr:${a.documentNumber}`, actorId: actor.id, actorLabel: actor.label, direction: "against", target: actor.label,
        instrument: instrumentForRegulatoryClass(a.cls), cls: `U.S. ${CLASS_LABEL[a.cls].toLowerCase()}${a.instrument ? ` · ${a.instrument}` : ""}`,
        modality: "act", weight: 70, title: a.title, link: a.url, source: "Federal Register", pubDate: a.publicationDate,
        ageDays: a.ageDays, own: false, phrase: a.instrument ?? CLASS_LABEL[a.cls],
      });
    }

    // Through the engine against this actor's own history.
    const problemId = econProblemId(actor.id);
    const def = actorProblem(actor);
    const { baseline, samples } = await getWarningBaseline(problemId, day, 30).catch(() => ({ baseline: null as number | null, samples: 0 }));
    const prior = await getWarningAnomalyHistory(problemId, day, 10).catch(() => [] as number[]);
    const rawScore = scoreIndicators(def.indicators, observations).reduce((s, i) => s + i.contribution, 0);
    const assessment = deriveWarning(def, observations, {
      baseline: baseline ?? undefined, baselineSamples: samples,
      anomalyHistory: [...prior, rawScore - (baseline ?? 0)], observedAt,
    });
    recordWarningDay(problemId, day, assessment.rawScore, assessment.anomaly, assessment.level, null).catch(() => {});

    if (brent?.changePct != null && Math.abs(brent.changePct) >= 2 && instruments.some((i) => (i.instrument === "energy" || i.instrument === "shipping") && i.state !== "dormant")) {
      corroboration.push(`Brent ${brent.changePct >= 0 ? "+" : ""}${brent.changePct}% on the session`);
    }
    if (naming.length) corroboration.push(`${naming.length} U.S. action${naming.length === 1 ? "" : "s"} naming ${actor.label} in 45d`);
    if (actorWaves.length) corroboration.push(`${actorWaves.reduce((n, w) => n + w.count, 0)} EU/UK listings in 45d`);

    boards.push({
      actor: { id: actor.id, label: actor.label, kind: actor.kind, aor: actor.aor, reason: actor.reason, chokepointIds: actor.chokepointIds },
      assessment, baselineSamples: samples, mentions: mentionsOf(actor), instruments,
      counterPressure: { state: cp.state, why: cp.why, count14d: naming.filter((a) => a.ageDays <= 14).length },
      corroboration,
      sensorHealth: [
        { sensor: "GDELT", live: !!news },
        { sensor: "own sources", live: own.items.length > 0, note: own.items.length ? [...own.sources].join(", ") : "nothing relevant" },
        ...(actor.chokepointIds.length ? [{ sensor: "chokepoint read", live: cpReads.length > 0 }] : []),
        { sensor: "Federal Register", live: !!reg?.live },
        { sensor: "CISA advisories", live: !!cisa?.live, note: named.length ? `${named.length} naming the actor (14d)` : undefined },
        { sensor: "EU/UK lists", live: !!(foreign && (foreign.live.EU || foreign.live.UK)), note: foreign?.failed.length ? `${foreign.failed.join("/")} unavailable` : undefined },
        ...(noticeHostFor(actor.id) ? [{ sensor: `${noticeHostFor(actor.id)} notices`, live: own_notices.some((n) => (ageDaysOf(n.capturedAt, todayMs) ?? 999) <= 30), note: own_notices.length ? `${own_notices.length} captured` : "capture the announcements page with the extension" }] : []),
      ],
    });

    for (const m of rankMoves(moves)) {
      const corr: string[] = [];
      if (m.instrument === "shipping") for (const r of cpReads) if (r.transit && r.transit.state !== "unconfigured" && r.transit.state !== "unknown") corr.push(`AIS ${r.name}: ${r.transit.state}`);
      if ((m.instrument === "energy" || m.instrument === "shipping") && brent?.changePct != null) corr.push(`Brent ${brent.changePct >= 0 ? "+" : ""}${brent.changePct}%`);
      if (m.direction === "by" && (m.instrument === "sanctions" || m.instrument === "trade" || m.instrument === "finance") && naming.length) corr.push(`${naming.length} U.S. action${naming.length === 1 ? "" : "s"} naming ${actor.label}`);
      allMoves.push({ ...m, corroboration: corr, affects: INSTRUMENT_META[m.instrument].affects });
    }
  }

  // Board order: level, then anomaly — the same rule as the I&W strip.
  const LEVEL: Record<string, number> = { alert: 3, warning: 2, watch: 1, calm: 0 };
  boards.sort((a, b) => LEVEL[b.assessment.level] - LEVEL[a.assessment.level] || b.assessment.anomaly - a.assessment.anomaly || a.actor.label.localeCompare(b.actor.label));

  const rankedMoves = rankMoves(allMoves).map((m) => allMoves.find((x) => x.id === m.id)!);
  const built = buildTimeline({ moves: rankedMoves, incidents, brent: brent?.series, today: day });
  // Strait → price lag (PLAN §7 E2): the cpact: series (phase C) against
  // the Brent day-moves already plotted. Anecdotes stay null.
  let lag: LeadResult | null = null;
  try {
    const acts = (await Promise.all(["hormuz", "bab-el-mandeb"].map((id) => getSensorSeries(sensorKey("cpact", id), 90).catch(() => []))))
      .flat().filter((p) => p.value >= 1).map((p) => p.day);
    lag = precedes(acts, built.dots.filter((d) => d.kind === "market").map((d) => d.day), 3);
  } catch { lag = null; }
  const timeline = { ...built, lag };

  return {
    actors: boards,
    skipped: register.skipped,
    edits,
    moves: rankedMoves.slice(0, 40),
    energy: (energy ?? []).map((q) => ({ symbol: q.symbol, label: q.label, changePct: q.changePct, price: q.price })),
    timeline,
    leverage,
    foreign: { waves, live: foreign?.live ?? { EU: false, UK: false }, failed: foreign?.failed ?? ["EU", "UK"] },
    generatedAt: observedAt,
    windowDays: 14,
    sources: { gdelt: gdeltLive, ownSources: [...ownSources], federalRegister: !!reg?.live, foreign: !!(foreign && (foreign.live.EU || foreign.live.UK)), chokepoints: !!cps, energy: energyLines.length > 0 },
    note: actors.length === 0
      ? (register.skipped.length
        ? `No actor could be placed: ${register.skipped.slice(0, 4).map((s) => `“${s.name}” (${s.fix === "excluded" ? "excluded" : s.suggestion ? `did you mean ${s.suggestion}?` : "not a country"})`).join(", ")}${register.skipped.length > 4 ? "…" : ""}. Fix the names in Preferences → Mission Profile or add an actor by country name.`
        : "No tracked countries — declare AOIs or watched countries in Preferences → Mission Profile to populate the actor register.")
      : "Graded, not counted; one author per headline (the others are listed as named); a strait act is credited to its presumed coercer by geography; a reversal (measure lifted) is shown, never scored; a fresh actor is held at Watch until its baseline forms.",
  };
}

const noticeHostFor = (actorId: string): string | null => NOTICE_HOSTS.find((n) => n.actorId === actorId)?.label.replace(/ notice$/, "") ?? null;
const rankState = (s: string): number => ({ dormant: 0, watching: 1, active: 2, confirmed: 3 } as Record<string, number>)[s] ?? 0;
