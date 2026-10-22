// Spectrum sensors for the I&W boards — server-only. Normalises the cyber
// and space feeds into IndicatorObservations for the three spectrum
// indicators (pnt_denial, cyber_pressure, space_activity) of one warning
// problem, the same contract as lib/warningSensors: every feed bounded, an
// unreachable feed yields no observation and is flagged in `health`
// (UNKNOWN ≠ clear), the tunable judgements live in lib/spectrumRules.
//
// Passive only. Nothing here probes a network; every input is a published
// feed or the user's own captures. Space weather enters ONLY as the
// attribution guard on the PNT ladder — it never raises a level.

import { cellToLatLng } from "h3-js";
import type { IndicatorObservation } from "./warning";
import type { NewsItem } from "./types";
import type { ProblemGeo } from "./warningTaxonomy";
import { PNT_ID, CYBER_ID, SPACE_ID, COUNTERSPACE_ID } from "./warningTaxonomy";
import { getGpsInterference, gpsLevelAt } from "./gpsjam";
import { getGpsNotams } from "./airspace";
import { getNoaaScales, getLaunches, getConjunctions } from "./spaceSources";
import { getIodaOutageAlerts, getRansomwareVictims, getCisaAdvisories } from "./cyberSources";
import { outageAlertsFor, advisoriesNaming, victimsRelevant, readCyber, cyberTargetOf, cyberPostureRead, type CyberPostureItem, type CyberPostureRead } from "./cyberSignals";
import { pntStormGuard } from "./spaceWeatherOps";
import { launchCadence, usPayloadConjunctions } from "./spaceCatalog";
import { pntState, cyberState, spaceActivityState } from "./spectrumRules";
import { attribute, type GradedEvidence } from "./economicWarfare";
import { gdeltSearch } from "./localNews";
import { countryIso2 } from "./holidays";
import { knownCountryNames } from "./countryNames";
import { getMissionProfile } from "./missionProfileApply";
import { readCounterspace, fleetActorIn, hasCorroborator, counterspaceState, type SpaceActor } from "./counterspace";
import { getCounterspaceCatalogue } from "./counterspaceAssemble";
import type { SensorBaseline } from "./sensorStore";

// The cyber POSTURE read per board (PLAN-SPACE-CYBER-ASK §3) — kept beside
// the observation so the Spectrum summary and the country room can show
// it without a second gather. Written on every pass, read by
// `getCyberPosture`.
const lastCyberPosture = new Map<string, CyberPostureRead>();
export function getCyberPosture(problemId: string): CyberPostureRead | null { return lastCyberPosture.get(problemId) ?? null; }

const SPACE_QUERY = '("inspector satellite" OR "close approach" OR "anti-satellite" OR "proximity operations" OR "satellite jamming" OR "co-orbital" OR "rendezvous and proximity" OR Kosmos OR Cosmos OR Shijian OR "Space Force")';
const COUNTERSPACE_ACTORS: SpaceActor[] = ["RUS", "CHN"];
const OFFICIAL_RX = /\b(space force|ussf|usspacecom|space command|pentagon|18th space defense|18 sds)\b/i;

export interface SpectrumBaselines { pnt: SensorBaseline; ransom: SensorBaseline }

export interface SpectrumHealth { indicatorId: string; live: boolean; note?: string }

export interface SpectrumGather {
  observations: IndicatorObservation[];
  health: SpectrumHealth[];
  /** Counts to persist as the day's sensor values (null = sensor dead — write nothing). */
  magnitudes: { pntCells: number | null; victims: number | null };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const to = new Promise<null>((res) => { timer = setTimeout(() => res(null), ms); });
  return Promise.race([p.catch(() => null), to]).finally(() => clearTimeout(timer)) as Promise<T | null>;
}

const inBbox = (geo: ProblemGeo, lat: number, lon: number): boolean =>
  lat >= geo.bbox.latMin && lat <= geo.bbox.latMax && lon >= geo.bbox.lonMin && lon <= geo.bbox.lonMax;

const CYBER_QUERY = '(cyberattack OR "cyber attack" OR ransomware OR hackers OR "state-sponsored" OR malware OR "denial-of-service" OR wiper OR intrusion)';

function obs(indicatorId: string, sensorId: string, s: { state: IndicatorObservation["observedState"]; confidence: number; why: string }, provenance: string, magnitude?: number): IndicatorObservation {
  return { sensorId, indicatorId, observedState: s.state, confidence: s.confidence, magnitude, ts: new Date().toISOString(), provenance: `${provenance} — ${s.why}` };
}

/**
 * Gather the spectrum observations for one problem. `userNews` is the
 * AOI-relevant slice of the user's own sources the classic sensors already
 * gathered (no second fan-out); `problemId` keys the GDELT cache.
 */
export async function gatherSpectrumObservations(
  geo: ProblemGeo,
  problemId: string,
  baselines: SpectrumBaselines,
  userNews: NewsItem[],
): Promise<SpectrumGather> {
  const nowMs = Date.now();
  const cyberQuery = `(${[...new Set(geo.countries)].slice(0, 8).map((c) => `"${c}"`).join(" OR ")}) ${CYBER_QUERY} sourcelang:english`;

  const counterspaceActor = COUNTERSPACE_ACTORS.find((a) => geo.spacePowers.includes(a)) ?? null;
  const [gps, gpsNotams, scales, outages, victims, advisories, launches, conj, cyberNews, profile, catalogue, spaceNews] = await Promise.all([
    withTimeout(getGpsInterference(), 12_000),
    withTimeout(getGpsNotams(), 12_000),
    withTimeout(getNoaaScales(), 8_000),
    withTimeout(getIodaOutageAlerts(24), 10_000),
    withTimeout(getRansomwareVictims(), 10_000),
    withTimeout(getCisaAdvisories(), 10_000),
    geo.spacePowers.length ? withTimeout(getLaunches(), 12_000) : Promise.resolve(null),
    geo.spacePowers.length ? withTimeout(getConjunctions(), 12_000) : Promise.resolve(null),
    withTimeout(gdeltSearch(cyberQuery, { cacheKey: `cyber:${problemId}`, timespan: "7d", maxrecords: 30, keep: 25, source: "wire", category: "cyber" }), 8_000),
    withTimeout(getMissionProfile(), 5_000),
    counterspaceActor ? withTimeout(getCounterspaceCatalogue(counterspaceActor, { maxWaitMs: 12_000 }), 13_000) : Promise.resolve(null),
    counterspaceActor ? withTimeout(gdeltSearch(`(${[...new Set(geo.countries)].slice(0, 4).map((c) => `"${c}"`).join(" OR ")}) ${SPACE_QUERY} sourcelang:english`, { cacheKey: `space:${problemId}`, timespan: "7d", maxrecords: 30, keep: 25, source: "wire", category: "space" }), 8_000) : Promise.resolve(null),
  ]);
  const allCountries = knownCountryNames();
  const vendors = profile?.spectrum?.edgeVendors ?? [];

  const observations: IndicatorObservation[] = [];
  const health: SpectrumHealth[] = [];
  const magnitudes: SpectrumGather["magnitudes"] = { pntCells: null, victims: null };

  // ── pnt_denial ──────────────────────────────────────────────────────────
  {
    const cellsLive = !!gps?.ok;
    let cells = 0, hubHits = 0;
    if (gps?.ok) {
      for (const h of gps.hexes) {
        try {
          const [lat, lon] = cellToLatLng(h.h3);
          if (inBbox(geo, lat, lon)) cells += h.level >= 2 ? 2 : 1;
        } catch { /* malformed cell */ }
      }
      hubHits = geo.hubs.filter((h) => gpsLevelAt(h.lat, h.lon, gps.hexes) > 0).length;
      magnitudes.pntCells = cells;
    }
    // GPS/WAAS system NOTAMs that name an AOI FIR or country.
    let gpsNotamCount: number | null = null;
    if (gpsNotams && gpsNotams.configured && gpsNotams.live) {
      const rx = new RegExp(`\\b(${[...geo.firs, ...geo.countries.map((c) => c.toUpperCase())].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
      gpsNotamCount = gpsNotams.groups.flatMap((g) => g.notams).filter((n) => rx.test(`${n.text} ${n.rawtext ?? ""}`)).length;
    }
    const guard = scales ? pntStormGuard(scales) : false;
    const s = pntState({ cellsLive, cells, baseline: baselines.pnt, hubHits, gpsNotams: gpsNotamCount, raimNotams: 0, stormGuard: guard });
    if (s) {
      observations.push(obs(PNT_ID, "gpsjam", s, `GPSJam ${gps?.date ?? ""} cells in AOI bbox${gpsNotamCount != null ? ` + DAIP GPS_WAAS` : ""}${scales?.live ? ` · SWPC G${scales.now.G ?? "?"}` : " · SWPC unreachable (no guard)"}`, cells));
      health.push({ indicatorId: PNT_ID, live: true, note: !cellsLive ? "GPSJam unreachable — NOTAMs only" : gpsNotamCount == null ? "DAIP GPS/WAAS unreachable — cells only" : undefined });
    } else {
      health.push({ indicatorId: PNT_ID, live: false, note: "GPSJam and DAIP GPS/WAAS both unreachable" });
    }
  }

  // ── cyber_pressure ──────────────────────────────────────────────────────
  {
    const actorTerms = { terms: geo.terms };
    const wire = (cyberNews ?? []).map((n) => ({ ...n, own: false }));
    const own = userNews.map((n) => ({ ...n, own: true }));
    const actsBy: GradedEvidence[] = [];
    const postureItems: CyberPostureItem[] = [];
    let elsewhere = 0;
    const seen = new Set<string>();
    for (const t of [...wire, ...own]) {
      const text = `${t.title} ${t.summary ?? ""}`;
      const key = (t.link || t.title).toLowerCase();
      if (seen.has(key)) continue;
      const r = readCyber(text);
      if (!r) continue;
      if (attribute(text, actorTerms) !== "by") continue;
      seen.add(key);
      // AGAINST whom (PLAN-SPACE-CYBER-ASK §3): an act whose stated target
      // is outside the AOI is named, never ranked.
      const target = cyberTargetOf(text, geo.countries, allCountries, { vendors });
      const age = t.pubDate ? Math.round((nowMs - Date.parse(t.pubDate)) / 86_400_000) : null;
      postureItems.push({ cls: r.cls, modality: r.modality, target, phrase: r.phrase, ageDays: Number.isFinite(age as number) ? age : null });
      if (target === "elsewhere") { elsewhere++; continue; }
      actsBy.push({ modality: r.modality, own: t.own, source: (t.source ?? "").toLowerCase() || t.title.slice(0, 40) });
    }
    const outagesFor = outages?.live ? outageAlertsFor(outages.alerts, geo.countries) : [];
    const named = advisories?.live ? advisoriesNaming(advisories.items, geo.countries, nowMs, 14) : [];
    for (const a of named) postureItems.push({ cls: "espionage", modality: "act", target: "aoi", phrase: a.title, ageDays: a.ageDays, advisory: true });
    const countries = geo.countries.map((c) => ({ name: c, iso2: countryIso2(c) ?? undefined }));
    const relevant = victims?.live ? victimsRelevant(victims.victims, countries, nowMs, 7) : [];
    if (victims?.live) magnitudes.victims = relevant.length;
    lastCyberPosture.set(problemId, cyberPostureRead(postureItems, !!cyberNews || !!advisories?.live));

    const s = cyberState({
      outagesLive: !!outages?.live, outages: outagesFor.map((o) => ({ country: o.country, level: o.level })),
      victimsLive: !!victims?.live, victims: relevant.length, victimsBaseline: baselines.ransom,
      actsBy, advisories: named.length, elsewhere,
    });
    if (s) {
      const srcs = [cyberNews ? "GDELT" : null, own.length ? "own sources" : null, advisories?.live ? "CISA" : null, outages?.live ? "IODA" : null, victims?.live ? "ransomware.live" : null].filter(Boolean).join(" + ");
      observations.push(obs(CYBER_ID, "cyber", s, `${srcs}${named[0] ? ` · lead: "${named[0].title.slice(0, 80)}"` : ""}`, actsBy.length + named.length + outagesFor.length));
      const dead = [!cyberNews ? "GDELT" : null, !advisories?.live ? "CISA" : null, !outages?.live ? "IODA" : null, !victims?.live ? "ransomware.live" : null].filter(Boolean);
      health.push({ indicatorId: CYBER_ID, live: true, note: dead.length ? `${dead.join("/")} unreachable` : undefined });
    } else {
      health.push({ indicatorId: CYBER_ID, live: false, note: "cyber feeds unreachable (GDELT / CISA / IODA / ransomware.live)" });
    }
  }

  // ── space_activity ──────────────────────────────────────────────────────
  if (geo.spacePowers.length) {
    const cadence = launches?.live ? launchCadence(launches.launches, geo.spacePowers, nowMs, 90) : null;
    const conjunctions = conj?.live ? usPayloadConjunctions(conj.conjunctions).length : 0;
    const s = spaceActivityState({ live: !!launches?.live, last14: cadence?.last14 ?? 0, per14: cadence?.per14 ?? null, next14: cadence?.next14 ?? 0, conjunctions });
    if (s) {
      observations.push(obs(SPACE_ID, "spaceCatalog", s, `Launch Library 2 (${geo.spacePowers.join("/")})${conj?.live ? " + SOCRATES" : " · SOCRATES unreachable"}`, (cadence?.last14 ?? 0) + conjunctions));
      health.push({ indicatorId: SPACE_ID, live: true, note: !conj?.live ? "SOCRATES unreachable — cadence only" : undefined });
    } else {
      health.push({ indicatorId: SPACE_ID, live: false, note: "Launch Library unreachable" });
    }
  }

  // ── counterspace_activity ───────────────────────────────────────────────
  // Catalogue (what the fleet DID — lib/counterspaceAssemble) + reporting
  // (what the wires and the user's sources SAID — the counterspace
  // grammar), through one ladder (lib/counterspace counterspaceState).
  if (counterspaceActor) {
    const actorTerms = { terms: geo.terms };
    const wire = (spaceNews ?? []).map((n) => ({ ...n, own: false }));
    const own = userNews.map((n) => ({ ...n, own: true }));
    const reported: { modality: GradedEvidence["modality"]; own: boolean; corroborated: boolean; cls: "asat" | "rpo" | "jamming" }[] = [];
    let official = 0;
    let lead: string | null = null;
    const seen = new Set<string>();
    for (const t of [...wire, ...own]) {
      const text = `${t.title} ${t.summary ?? ""}`;
      const key = (t.link || t.title).toLowerCase();
      if (seen.has(key)) continue;
      const r = readCounterspace(text);
      if (!r) continue;
      // Attributed BY the actor — by the state's name, or by the fleet's.
      if (attribute(text, actorTerms) !== "by" && fleetActorIn(text) !== counterspaceActor) continue;
      seen.add(key);
      const corroborated = hasCorroborator(text);
      reported.push({ modality: r.modality, own: t.own, corroborated, cls: r.cls });
      if (r.modality === "act" && OFFICIAL_RX.test(text)) official++;
      if (!lead && r.modality === "act" && !t.own) lead = t.title.slice(0, 90);
    }
    const cat = catalogue ?? null;
    const s = counterspaceState({
      catalogueLive: !!cat?.live,
      manoeuvres14: cat?.manoeuvres14 ?? 0, cadencePer14: cat?.cadencePer14 ?? null,
      coPlanar: cat?.coPlanar ?? [], proximity: cat?.proximity ?? [],
      reported, official,
    });
    if (s) {
      const srcs = [cat?.live ? "Space-Track catalogue" : null, spaceNews ? "GDELT" : null, own.length ? "own sources" : null].filter(Boolean).join(" + ");
      observations.push(obs(COUNTERSPACE_ID, "counterspace", s, `${srcs || "reporting"}${lead ? ` · lead: "${lead}"` : ""}`, (cat?.proximity.length ?? 0) + (cat?.manoeuvres14 ?? 0) + reported.filter((r) => r.modality === "act").length));
      health.push({ indicatorId: COUNTERSPACE_ID, live: true, note: !cat?.live ? `catalogue: ${cat?.reason ?? "unreachable"} — reporting only` : !spaceNews ? "GDELT unreachable — catalogue only" : undefined });
    } else {
      health.push({ indicatorId: COUNTERSPACE_ID, live: false, note: `catalogue ${cat?.reason ?? "unreachable"} and no reporting — UNKNOWN` });
    }
  }

  return { observations, health, magnitudes };
}
