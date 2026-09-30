// The Spectrum summary — server-only, deterministic, no model call. One
// rollup for the Glance tile and the alert predicates: the worst PNT /
// cyber / space-activity indicator state across the active I&W boards
// (read from the same 10-min-cached assessments the I&W pane shows), the
// space-weather ops impact (environment — its own LED, never a level), and
// KEV × declared vendors. Latency rule as everywhere: bounded wait, a
// `pending` stub on a cold start, the client asks again.

import type { ObservedState, WarningAssessment } from "./warning";
import { activeWarningProblems } from "./warningProblems";
import { assessWarning } from "./warningAssess";
import { getNoaaScales } from "./spaceSources";
import { getKev } from "./cyberSources";
import { getMissionProfile } from "./missionProfileApply";
import { spaceWeatherImpacts, spaceWxLed, severeScales, type SpaceWxImpact, type ScaleDay } from "./spaceWeatherOps";
import { kevHits } from "./cyberSignals";
import { edgeExposureLed, stateLed, worstLed } from "./spectrumRules";
import { PNT_ID, CYBER_ID, SPACE_ID } from "./warningTaxonomy";
import type { Led } from "./sitrepSignals";

export interface SpectrumIndicatorRead {
  state: ObservedState;
  confidence: number;
  led: Led;
  board: string;         // problem label
  problemId: string;
  why: string;           // observed provenance
  live: boolean;
}

export interface SpectrumSummary {
  generatedAt: string;
  pending?: boolean;
  boards: { problemId: string; label: string; level: string; pnt: ObservedState | null; cyber: ObservedState | null; space: ObservedState | null }[];
  /** Worst read per kind across boards; null when no board carries it or every sensor was dead. */
  pnt: SpectrumIndicatorRead | null;
  cyber: SpectrumIndicatorRead | null;
  space: SpectrumIndicatorRead | null;
  spaceWx: { live: boolean; led: Led; now: ScaleDay | null; impacts: SpaceWxImpact[]; severe: { scale: "R" | "S" | "G"; level: number }[]; polar: boolean | null };
  edge: { declared: boolean; live: boolean; led: Led; vendors: string[]; hits: { cve: string; vendor: string; product: string; name: string; dateAdded: string; ransomware: boolean }[] };
  /** Worst of pnt / cyber / spaceWx / edge (space activity is informational on the tile). */
  led: Led;
  /** One line for the tile. */
  line: string;
}

const TTL = 5 * 60 * 1000;
let cache: { at: number; body: SpectrumSummary } | null = null;
let inflight: Promise<SpectrumSummary> | null = null;

export function resetSpectrumCache(): void { cache = null; }

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const to = new Promise<null>((res) => { timer = setTimeout(() => res(null), ms); });
  return Promise.race([p.catch(() => null), to]).finally(() => clearTimeout(timer)) as Promise<T | null>;
}

export async function getSpectrumSummary(opts: { maxWaitMs?: number } = {}): Promise<SpectrumSummary> {
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  if (!inflight) inflight = compute().then((b) => { cache = { at: Date.now(), body: b }; return b; }).finally(() => { inflight = null; });
  const settled = await withTimeout(inflight, opts.maxWaitMs ?? 8_000);
  if (settled) return settled;
  if (cache) return { ...cache.body, pending: true };
  return {
    generatedAt: new Date().toISOString(), pending: true, boards: [], pnt: null, cyber: null, space: null,
    spaceWx: { live: false, led: "u", now: null, impacts: [], severe: [], polar: null },
    edge: { declared: false, live: false, led: "u", vendors: [], hits: [] },
    led: "u", line: "assembling…",
  };
}

const RANK: Record<ObservedState, number> = { dormant: 0, watching: 1, active: 2, confirmed: 3 };

function pick(a: WarningAssessment & { sensorHealth: { indicatorId: string; live: boolean }[] }, id: string): SpectrumIndicatorRead | null {
  const ind = a.indicators.find((i) => i.id === id);
  if (!ind) return null;
  const live = a.sensorHealth.find((h) => h.indicatorId === id)?.live ?? false;
  return { state: ind.state, confidence: ind.confidence, led: live ? stateLed(ind.state) : "u", board: a.label, problemId: a.problemId, why: ind.observedProvenance ?? "", live };
}

const worse = (a: SpectrumIndicatorRead | null, b: SpectrumIndicatorRead | null): SpectrumIndicatorRead | null => {
  if (!a) return b; if (!b) return a;
  if (!a.live && b.live) return b; if (!b.live && a.live) return a;
  return RANK[b.state] > RANK[a.state] ? b : a;
};

async function compute(): Promise<SpectrumSummary> {
  const [problems, scales, kev, profile] = await Promise.all([
    activeWarningProblems().catch(() => []),
    getNoaaScales().catch(() => ({ live: false, now: { date: "", R: null, S: null, G: null }, outlook: [] })),
    getKev().catch(() => ({ live: false, entries: [] })),
    getMissionProfile().catch(() => null),
  ]);
  const spec = profile?.spectrum ?? { polarRoutes: false, satcom: "", edgeVendors: [], spaceActivity: true };

  const boards: SpectrumSummary["boards"] = [];
  let pnt: SpectrumIndicatorRead | null = null, cyber: SpectrumIndicatorRead | null = null, space: SpectrumIndicatorRead | null = null;
  for (const p of problems) {
    const a = await withTimeout(assessWarning(p.def.id), 25_000);
    if (!a) continue;
    const pp = pick(a, PNT_ID), cc = pick(a, CYBER_ID), ss = pick(a, SPACE_ID);
    boards.push({ problemId: a.problemId, label: a.label, level: a.level, pnt: pp?.state ?? null, cyber: cc?.state ?? null, space: ss?.state ?? null });
    pnt = worse(pnt, pp); cyber = worse(cyber, cc); space = worse(space, ss);
  }

  const impacts = spaceWeatherImpacts(scales, { polar: spec.polarRoutes });
  const spaceWx: SpectrumSummary["spaceWx"] = { live: scales.live, led: spaceWxLed(scales, { polar: spec.polarRoutes }), now: scales.live ? scales.now : null, impacts, severe: severeScales(scales), polar: spec.polarRoutes };
  const hits = kev.live ? kevHits(kev.entries, spec.edgeVendors, Date.now(), 14) : [];
  const edge: SpectrumSummary["edge"] = {
    declared: spec.edgeVendors.length > 0, live: kev.live, led: edgeExposureLed(hits, spec.edgeVendors.length > 0, kev.live), vendors: spec.edgeVendors,
    hits: hits.map((h) => ({ cve: h.entry.cveID, vendor: h.vendor, product: h.entry.product, name: h.entry.vulnerabilityName, dateAdded: h.entry.dateAdded, ransomware: h.entry.knownRansomwareCampaignUse })),
  };

  const led = worstLed(pnt?.led ?? "u", cyber?.led ?? "u", spaceWx.led, edge.led);
  const parts: string[] = [];
  if (cyber && cyber.live && cyber.state !== "dormant") parts.push(`cyber ${cyber.state} · ${cyber.board.split(" · ").pop()}`);
  if (pnt && pnt.live && pnt.state !== "dormant") parts.push(`PNT ${pnt.state} · ${pnt.board.split(" · ").pop()}`);
  if (spaceWx.severe.length) parts.push(`space wx ${spaceWx.severe.map((s) => `${s.scale}${s.level}`).join("/")}`);
  else if (spaceWx.led === "a") parts.push("space wx minor");
  if (edge.hits.length) parts.push(`${edge.hits.length} KEV hit${edge.hits.length === 1 ? "" : "s"}`);
  if (space && space.live && space.state !== "dormant") parts.push(`space activity ${space.state}`);
  const unknowns = [!pnt?.live ? "PNT" : null, !cyber?.live ? "cyber" : null, !spaceWx.live ? "space wx" : null, !edge.declared ? "vendors undeclared" : !edge.live ? "KEV" : null].filter(Boolean);
  const line = parts.length ? parts.join(" · ") : unknowns.length === 4 ? "sensors unreachable — UNKNOWN" : `quiet${unknowns.length ? ` · ${unknowns.join("/")} unknown` : ""}`;

  return { generatedAt: new Date().toISOString(), boards, pnt, cyber, space, spaceWx, edge, led, line };
}
