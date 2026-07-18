// I&W sensor layer — server-only. Normalizes feeds THIS REPO ALREADY HAS into
// the common IndicatorObservation format (lib/warning) for the CENTCOM/Iran
// problem. Every sensor is fail-safe: an unreachable feed yields no observation
// (→ dormant, contribution 0) and is flagged in `health` so the UI shows
// "sensor unreachable" rather than a false "clear". No new dep — pure fetch via
// the existing feed libs (esbuild stays 0).

import type { IndicatorObservation, ObservedState } from "./warning";
import { getConflictPoints } from "./conflictEvents";
import { getDisasters, haversineKm } from "./disasters";
import { getConflictNewsByCountry } from "./conflictNews";
import { gdeltLocalNews } from "./localNews";
import { getAllStateAdvisories } from "./stateAdvisories";
import { getFirNotams } from "./airspace";
import { isMobilityType, isTankerType } from "./aircraftTypes";
import type { NewsItem } from "./types";

// ── AOR definition (Gulf / Iran / Levant approaches) ─────────────────────────
const AOR_BBOX = { latMin: 12, latMax: 40, lonMin: 34, lonMax: 64 };
const GULF_COUNTRIES = [
  "Iran", "Iraq", "Israel", "Yemen", "Saudi Arabia", "United Arab Emirates",
  "Qatar", "Bahrain", "Kuwait", "Oman", "Syria", "Lebanon",
];
// AMC / partner hubs the mobility sensor watches for observed lift.
const AOR_HUBS: { lat: number; lon: number }[] = [
  { lat: 25.117, lon: 51.315 }, // Al Udeid, Qatar
  { lat: 24.248, lon: 54.548 }, // Al Dhafra, UAE
  { lat: 29.347, lon: 47.521 }, // Ali Al Salem, Kuwait
  { lat: 24.063, lon: 47.580 }, // Prince Sultan, KSA
  { lat: 26.271, lon: 50.636 }, // Isa, Bahrain
];
const AOR_FIRS = ["OBBB", "OTDF", "OMAE", "OIIX", "OKAC", "ORBB", "OEJD", "OYSC"];
const HUB_RADIUS_KM = 600;

const inBbox = (lat: number, lon: number): boolean =>
  lat >= AOR_BBOX.latMin && lat <= AOR_BBOX.latMax && lon >= AOR_BBOX.lonMin && lon <= AOR_BBOX.lonMax;
const nearHub = (lat: number, lon: number): boolean =>
  AOR_HUBS.some((h) => haversineKm(lat, lon, h.lat, h.lon) <= HUB_RADIUS_KM);

// Bound every feed so one slow/hung source can't idle the request past the
// platform gateway timeout (the SITREP-read 502 lesson). A timeout → null →
// that sensor degrades to "unreachable", never a hang.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const to = new Promise<null>((res) => { timer = setTimeout(() => res(null), ms); });
  return Promise.race([p.catch(() => null), to]).finally(() => clearTimeout(timer)) as Promise<T | null>;
}

const nowIso = () => new Date().toISOString();
function obs(indicatorId: string, sensorId: string, state: ObservedState, confidence: number, provenance: string, magnitude?: number): IndicatorObservation {
  return { sensorId, indicatorId, observedState: state, confidence, magnitude, ts: nowIso(), provenance };
}

export interface SensorHealth { indicatorId: string; live: boolean; note?: string }
export interface DivergenceState {
  impliedHigh: boolean;
  observedHigh: boolean;
  observedCount: number;
  quadrant: "early_warning" | "anomaly" | "corroboration" | "quiet";
}
export interface GatherResult {
  observations: IndicatorObservation[];
  health: SensorHealth[];
  divergence: DivergenceState;
}

// ── Keyless community mil ADS-B (same source as the Crisis-map layer) ─────────
interface MilAc { type: string; lat: number; lon: number }
const MIL_SOURCES = ["https://api.airplanes.live/v2/mil", "https://api.adsb.lol/v2/mil"];
async function fetchMilAircraft(): Promise<MilAc[] | null> {
  for (const url of MIL_SOURCES) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "DEAD-Dashboard/1.0" }, cache: "no-store", signal: AbortSignal.timeout(9000) });
      if (!r.ok) continue;
      const j = (await r.json()) as { ac?: unknown[] };
      const list = Array.isArray(j?.ac) ? j.ac : [];
      const out: MilAc[] = [];
      for (const a of list) {
        if (!a || typeof a !== "object") continue;
        const r2 = a as Record<string, unknown>;
        const lat = typeof r2.lat === "number" ? r2.lat : null;
        const lon = typeof r2.lon === "number" ? r2.lon : null;
        const type = typeof r2.t === "string" ? r2.t : typeof r2.type === "string" ? r2.type : "";
        if (lat == null || lon == null) continue;
        out.push({ type, lat, lon });
      }
      return out;
    } catch { /* try next mirror */ }
  }
  return null;
}

// ── Gather all observations for CENTCOM/Iran ─────────────────────────────────
export async function gatherObservations(): Promise<GatherResult> {
  const [conflictPts, disasters, newsByCountry, hormuzNewsRaw, advisories, milAc, firRes] = await Promise.all([
    withTimeout(getConflictPoints(), 10_000),
    withTimeout(getDisasters(), 10_000),
    withTimeout(getConflictNewsByCountry(GULF_COUNTRIES), 12_000),
    withTimeout(gdeltLocalNews("Strait of Hormuz"), 10_000),
    withTimeout(getAllStateAdvisories(), 10_000),
    withTimeout(fetchMilAircraft(), 10_000),
    withTimeout(getFirNotams(AOR_FIRS), 12_000),
  ]);
  const hormuzNews = hormuzNewsRaw ?? [];

  const observations: IndicatorObservation[] = [];
  const health: SensorHealth[] = [];

  // 1) conflict_intensity_gulf ← UCDP/ACLED/ReliefWeb event density in the AOR.
  let conflictCount = 0;
  if (conflictPts) {
    conflictCount = conflictPts.filter((p) => inBbox(p.lat, p.lon)).reduce((s, p) => s + (p.count || 1), 0);
    const state: ObservedState = conflictCount === 0 ? "dormant" : conflictCount <= 3 ? "watching" : conflictCount <= 10 ? "active" : "confirmed";
    observations.push(obs("conflict_intensity_gulf", "conflictEvents", state, state === "dormant" ? 0 : 0.85, "UCDP/ACLED/ReliefWeb georeferenced events (AOR bbox)", conflictCount));
    health.push({ indicatorId: "conflict_intensity_gulf", live: true });
  } else {
    health.push({ indicatorId: "conflict_intensity_gulf", live: false, note: "conflict-event feed unreachable" });
  }

  // 2) escalatory_strike_signal ← conflict-news escalation across AOR states.
  if (newsByCountry) {
    const signals = GULF_COUNTRIES.map((c) => newsByCountry[c.toLowerCase()]).filter(Boolean);
    const escalatingCountries = signals.filter((s) => s?.escalation).length;
    const total = signals.reduce((s, sig) => s + (sig?.count || 0), 0);
    const state: ObservedState = escalatingCountries >= 2 ? "confirmed" : escalatingCountries === 1 ? "active" : total > 0 ? "watching" : "dormant";
    observations.push(obs("escalatory_strike_signal", "conflictNews", state, state === "dormant" ? 0 : 0.7, "GDELT DOC + OSINT feeds, escalation-phrase scan across AOR states", total));
    health.push({ indicatorId: "escalatory_strike_signal", live: true });
  } else {
    health.push({ indicatorId: "escalatory_strike_signal", live: false, note: "conflict-news feed unreachable" });
  }

  // Implied demand (for the divergence) = any high-signal trigger present.
  const neoTriggers = (advisories ?? []).filter((a) => GULF_COUNTRIES.includes(a.country) && (a.orderedDeparture || a.authorizedDeparture || a.level === 4));
  const aorDisasters = (disasters ?? []).filter((d) => typeof d.lat === "number" && typeof d.lon === "number" && inBbox(d.lat as number, d.lon as number));
  const impliedHigh = conflictCount > 10 || neoTriggers.length > 0 || aorDisasters.length > 0;

  // 3) mobility_divergence ← observed mil mobility/tanker near hubs × implied demand.
  if (milAc) {
    const observedCount = milAc.filter((a) => nearHub(a.lat, a.lon) && (isMobilityType(a.type) || isTankerType(a.type))).length;
    const observedHigh = observedCount >= 4;
    let quadrant: DivergenceState["quadrant"];
    let state: ObservedState;
    if (impliedHigh && !observedHigh) { quadrant = "early_warning"; state = "active"; }       // demand, no lift → warning
    else if (!impliedHigh && observedHigh) { quadrant = "anomaly"; state = "active"; }         // lift, no trigger → warning
    else if (impliedHigh && observedHigh) { quadrant = "corroboration"; state = "watching"; }  // expected, low novelty
    else { quadrant = "quiet"; state = "dormant"; }
    observations.push(obs("mobility_divergence", "aircraftMil", state, state === "dormant" ? 0 : 0.7, `keyless ADS-B mil (${observedCount} mobility/tanker within ${HUB_RADIUS_KM}km of AOR hubs) × implied demand`, observedCount));
    health.push({ indicatorId: "mobility_divergence", live: true });
    return finalize(observations, health, { impliedHigh, observedHigh, observedCount, quadrant }, advisories, neoTriggers, hormuzNews, firRes);
  } else {
    health.push({ indicatorId: "mobility_divergence", live: false, note: "community ADS-B mirrors unreachable" });
    return finalize(observations, health, { impliedHigh, observedHigh: false, observedCount: 0, quadrant: impliedHigh ? "early_warning" : "quiet" }, advisories, neoTriggers, hormuzNews, firRes);
  }
}

function finalize(
  observations: IndicatorObservation[],
  health: SensorHealth[],
  divergence: DivergenceState,
  advisories: Awaited<ReturnType<typeof getAllStateAdvisories>> | null,
  neoTriggers: { orderedDeparture: boolean; authorizedDeparture: boolean; level: number | null }[],
  hormuzNews: NewsItem[],
  firRes: Awaited<ReturnType<typeof getFirNotams>> | null,
): GatherResult {
  // 4) neo_departure_posture ← State Dept ordered/authorized departure or Level-4.
  if (advisories) {
    const ordered = neoTriggers.some((a) => a.orderedDeparture);
    const authorized = neoTriggers.some((a) => a.authorizedDeparture);
    const level4 = neoTriggers.some((a) => a.level === 4);
    const state: ObservedState = ordered ? "confirmed" : authorized ? "active" : level4 ? "watching" : "dormant";
    observations.push(obs("neo_departure_posture", "stateAdvisories", state, state === "dormant" ? 0 : 0.9, "State Dept Travel Advisory RSS (ordered/authorized departure, Level-4)", neoTriggers.length));
    health.push({ indicatorId: "neo_departure_posture", live: true });
  } else {
    health.push({ indicatorId: "neo_departure_posture", live: false, note: "State advisory feed unreachable" });
  }

  // 5) hormuz_interdiction_signal ← Hormuz closure/mining/seizure reporting.
  const HORMUZ_TERMS = ["hormuz", "strait"];
  const INTERDICT = ["clos", "mine", "mining", "seiz", "seized", "block", "impound", "attack", "harass"];
  const hits = (hormuzNews ?? []).filter((a) => {
    const h = `${a.title} ${a.summary ?? ""}`.toLowerCase();
    return HORMUZ_TERMS.some((t) => h.includes(t)) && INTERDICT.some((t) => h.includes(t));
  });
  const hState: ObservedState = hits.length >= 2 ? "active" : hits.length === 1 ? "watching" : "dormant";
  observations.push(obs("hormuz_interdiction_signal", "conflictNews", hState, hState === "dormant" ? 0 : 0.6, "GDELT DOC 'Strait of Hormuz' + interdiction-term scan", hits.length));
  health.push({ indicatorId: "hormuz_interdiction_signal", live: true });

  // 6) airspace_gps_disruption ← Gulf FIR closure/overflight NOTAMs (best-effort).
  if (firRes && firRes.configured && firRes.live) {
    const groups = firRes.groups ?? [];
    const alerting = groups.filter((g) => g.worst === "Warning" || g.worst === "Caution").length;
    const state: ObservedState = alerting >= 3 ? "active" : alerting >= 1 ? "watching" : "dormant";
    observations.push(obs("airspace_gps_disruption", "airspace", state, state === "dormant" ? 0 : 0.55, "DAIP FIR/overflight NOTAMs over AOR FIRs", alerting));
    health.push({ indicatorId: "airspace_gps_disruption", live: true });
  } else {
    // DAIP needs the bundled DoD CA; UNKNOWN ≠ clear — no observation, flagged.
    health.push({ indicatorId: "airspace_gps_disruption", live: false, note: "DAIP airspace feed not configured / unreachable" });
  }

  return { observations, health, divergence };
}
