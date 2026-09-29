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
  resolveActors, actorProblem, movesFor, rankMoves, evidenceByInstrument, instrumentState,
  counterPressureState, observation, instrumentForRegulatoryClass, econProblemId, ageDaysOf,
  INSTRUMENTS, INSTRUMENT_META, COUNTER_PRESSURE_ID, MAX_ACTORS,
  type Actor, type CoercionMove, type ActorText, type Instrument, type GradedEvidence,
} from "./economicWarfare";
import { chokepointState } from "./warningRules";
import { recordWarningDay, getWarningBaseline, getWarningAnomalyHistory } from "./warningStore";
import { getChokepointReads, type ChokepointRead } from "./chokepointReads";
import { getRegulatoryDocs } from "./federalRegister";
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
}

export interface ActorBoard {
  actor: { id: string; label: string; kind: Actor["kind"]; aor: Actor["aor"]; reason: string; chokepointIds: string[] };
  assessment: WarningAssessment;
  instruments: InstrumentSummary[];
  counterPressure: { state: InstrumentSummary["state"]; why: string; count14d: number };
  /** Instrument-level corroboration, so the tile can say "AIS suppressed" or "Brent +4%". */
  corroboration: string[];
  sensorHealth: { sensor: string; live: boolean; note?: string }[];
}

export interface EconomicWarfareBody {
  actors: ActorBoard[];
  /** The coercion board — every actor's moves (by and against), ranked. */
  moves: (CoercionMove & { corroboration: string[]; affects: string })[];
  energy: { symbol: string; label: string; changePct: number | null; price: number | null }[];
  generatedAt: string;
  windowDays: number;
  sources: { gdelt: boolean; ownSources: string[]; federalRegister: boolean; chokepoints: boolean; energy: boolean };
  note: string;
}

const TTL = 10 * 60 * 1000;
let cache: { at: number; body: EconomicWarfareBody } | null = null;
let inflight: Promise<EconomicWarfareBody> | null = null;

export function resetEconomicWarfareCache(): void { cache = null; }

export async function getEconomicWarfare(): Promise<EconomicWarfareBody> {
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  if (inflight) return inflight;
  inflight = compute().then((b) => { cache = { at: Date.now(), body: b }; return b; }).finally(() => { inflight = null; });
  return inflight;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const to = new Promise<null>((res) => { timer = setTimeout(() => res(null), ms); });
  return Promise.race([p.catch(() => null), to]).finally(() => clearTimeout(timer)) as Promise<T | null>;
}

// The tracking picture, in priority order: Mission Profile AOI countries
// (declaration order), then watched countries, then base host nations.
async function trackedCountries(): Promise<string[]> {
  const out: string[] = [];
  const profile = await withTimeout(getMissionProfile(), 5000);
  for (const aoi of profile?.aois ?? []) for (const c of aoi.countries) out.push(c);
  const prefs = await withTimeout(getUserPrefs(), 5000);
  for (const c of prefs?.countriesOfInterest ?? []) out.push(c.country);
  for (const l of prefs?.forceLocations ?? []) if (l.country) out.push(l.country);
  return out.map((s) => (s || "").trim()).filter(Boolean);
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

  const tracked = await trackedCountries();
  const actors = resolveActors(tracked).slice(0, MAX_ACTORS);

  const cpIds = [...new Set(actors.flatMap((a) => a.chokepointIds))];
  const [reg, energy, cps] = await Promise.all([
    withTimeout(getRegulatoryDocs(), 15_000),
    withTimeout(getEnergyQuotes(), 12_000),
    cpIds.length ? withTimeout(getChokepointReads(cpIds), 20_000) : Promise.resolve(null),
  ]);

  const watched = [...new Set(actors.flatMap((a) => a.countries))];
  const actions: RegulatoryAction[] = reg ? enrich(reg.docs, watched, day) : [];
  const cpById = new Map<string, ChokepointRead>((cps?.signals ?? []).map((s) => [s.id, s]));
  const energyLines = (energy ?? []).map(quoteLine).filter((s): s is string => !!s);
  const brent = (energy ?? []).find((q) => q.symbol === "brent");

  const ownSources = new Set<string>();
  let gdeltLive = false;

  const boards: ActorBoard[] = [];
  const allMoves: EconomicWarfareBody["moves"] = [];

  // Actors are read sequentially: GDELT enforces 1 request / 5 s and each
  // query is cached 60 min, so after the first pass this loop is free; on the
  // first pass a burst would only earn 429s.
  for (const actor of actors) {
    const news = await withTimeout(gdeltSearch(actorQuery(actor), { cacheKey: `econ:${actor.id}`, timespan: "7d", maxrecords: 40, keep: 30, source: "wire", category: "econ" }), 15_000);
    if (news && news.length) gdeltLive = true;
    const own = await gatherUserSourceNews({ terms: actor.terms }).catch(() => ({ items: [] as NewsItem[], sources: new Set<string>() }));
    for (const s of own.sources) ownSources.add(s);

    const texts: ActorText[] = [
      ...(news ?? []).map((n) => ({ title: n.title, summary: n.summary, link: n.link, source: n.source, pubDate: n.pubDate, own: false })),
      ...own.items.map((n) => ({ title: n.title, summary: n.summary, link: n.link, source: n.source, pubDate: n.pubDate, own: true })),
    ];
    const moves = movesFor(actor, texts, todayMs);
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
      instruments.push({ instrument: inst, state: s.state, confidence: s.confidence, why: s.why, moves: moves.filter((m) => m.direction === "by" && m.instrument === inst).length });
    }

    const naming = actions.filter((a) => a.countries.some((c) => actor.countries.includes(c)));
    const cp = counterPressureState(naming.map((a) => a.ageDays));
    observations.push(observation(COUNTER_PRESSURE_ID, "federalRegister", cp, observedAt, "Federal Register", naming.length));
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

    boards.push({
      actor: { id: actor.id, label: actor.label, kind: actor.kind, aor: actor.aor, reason: actor.reason, chokepointIds: actor.chokepointIds },
      assessment, instruments,
      counterPressure: { state: cp.state, why: cp.why, count14d: naming.filter((a) => a.ageDays <= 14).length },
      corroboration,
      sensorHealth: [
        { sensor: "GDELT", live: !!news },
        { sensor: "own sources", live: own.items.length > 0, note: own.items.length ? [...own.sources].join(", ") : "nothing relevant" },
        ...(actor.chokepointIds.length ? [{ sensor: "chokepoint read", live: cpReads.length > 0 }] : []),
        { sensor: "Federal Register", live: !!reg?.live },
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

  return {
    actors: boards,
    moves: rankMoves(allMoves).map((m) => allMoves.find((x) => x.id === m.id)!).slice(0, 40),
    energy: (energy ?? []).map((q) => ({ symbol: q.symbol, label: q.label, changePct: q.changePct, price: q.price })),
    generatedAt: observedAt,
    windowDays: 14,
    sources: { gdelt: gdeltLive, ownSources: [...ownSources], federalRegister: !!reg?.live, chokepoints: !!cps, energy: energyLines.length > 0 },
    note: actors.length === 0
      ? "No tracked countries — declare AOIs or watched countries in Preferences → Mission Profile to populate the actor register."
      : "Graded, not counted; attribution by/against is heuristic (the evidence is shown); a strait act is credited to its presumed coercer by geography; a fresh actor is held at Watch until its baseline forms.",
  };
}

const rankState = (s: string): number => ({ dormant: 0, watching: 1, active: 2, confirmed: 3 } as Record<string, number>)[s] ?? 0;
