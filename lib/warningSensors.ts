// I&W sensor layer — server-only. Normalizes feeds THIS REPO ALREADY HAS into
// the common IndicatorObservation format (lib/warning) for the CENTCOM/Iran
// problem. Every sensor is fail-safe: an unreachable feed yields no observation
// (→ dormant, contribution 0) and is flagged in `health` so the UI shows
// "sensor unreachable" rather than a false "clear". No new dep — pure fetch via
// the existing feed libs (esbuild stays 0).

import type { IndicatorObservation, ObservedState } from "./warning";
import { getConflictPoints } from "./conflictEvents";
import { getDisasters, haversineKm } from "./disasters";
import { getConflictNewsByCountry, scoreConflictNews } from "./conflictNews";
import { gdeltLocalNews } from "./localNews";
import { getAllStateAdvisories } from "./stateAdvisories";
import { getFirNotams } from "./airspace";
import { isMobilityType, isTankerType } from "./aircraftTypes";
import { getXItems } from "./xStore";
import { getAllCachedSummaries } from "./newsletterCache";
import { getCapturedArticles, articleToNewsItem } from "./articleStore";
import { fetchFeed } from "./rss";
import { getUserPrefs } from "./userPrefs";
import {
  isRecentLevel4, recentConflictCount, bandConflictIntensity, conflictImpliesDemand,
  mobilityObservedHigh, CONFLICT_WINDOW_DAYS, type MobilityBaseline,
} from "./warningRules";
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

// AOR relevance for free-text (X posts, newsletters, OSINT feeds aren't geo-
// tagged) — a mention gate so only Gulf/Iran-relevant items feed the score.
const AOR_TERMS = /\b(iran|iranian|tehran|irgc|iraq|iraqi|israel|israeli|\bidf\b|yemen|houthi|hormuz|persian gulf|arabian gulf|strait of hormuz|red sea|bab.?el.?mandeb|saudi|riyadh|qatar|doha|bahrain|manama|kuwait|\buae\b|emirates|abu dhabi|dubai|oman|muscat|syria|lebanon|hezbollah|hizbollah|centcom)\b/i;
const aorRelevant = (n: NewsItem): boolean => AOR_TERMS.test(`${n.title} ${n.summary ?? ""}`);

// The user's OWN curated sources — imported X captures, newsletters, and the
// configured OSINT RSS/Telegram feeds. These often break a warning indicator
// before wire news does, but they're single-source: they raise confidence and
// can trip a WATCH, but only CORROBORATE (never alone confirm) — the scoring
// blends them so a social-only signal caps at watching. All fail-safe; the
// `sources` set drives provenance. Bounded so the fan-out can't hang the request.
async function gatherUserSourceNews(): Promise<{ items: NewsItem[]; sources: Set<string> }> {
  const sources = new Set<string>();
  const items: NewsItem[] = [];

  const xs = await withTimeout(getXItems(), 6000);
  if (xs) for (const x of xs) items.push({ id: `x-${x.id}`, title: x.text, source: `𝕏 @${x.handle}`, category: "social", pubDate: x.postedAt ?? x.importedAt, summary: "", link: x.url });

  const nls = await withTimeout(getAllCachedSummaries(), 6000);
  if (nls) for (const s of nls) items.push({ id: `nl-${s.id}`, title: s.subject, source: `✉ ${s.source}`, category: "newsletter", pubDate: s.date, summary: s.bullets.join(" · "), link: "" });

  // Captured analysis articles (reader-capture, e.g. WSJ via DoD MWR). A bigger
  // body slice so escalation phrasing deeper in the piece still scores.
  const arts = await withTimeout(getCapturedArticles(200), 6000);
  if (arts) for (const a of arts) items.push({ ...articleToNewsItem(a, 2000), source: `📄 ${a.source}` });

  const prefs = await withTimeout(getUserPrefs(), 6000);
  const feeds = (prefs?.osintFeeds ?? []).slice(0, 12);
  if (feeds.length) {
    const results = await Promise.all(feeds.map((f) => withTimeout(fetchFeed(f.url, f.label, f.kind), 8000)));
    for (const r of results) if (r?.items) for (const it of r.items) items.push(it);
  }

  const relevant = items.filter(aorRelevant);
  for (const n of relevant) {
    if (n.source.startsWith("𝕏")) sources.add("X");
    else if (n.source.startsWith("✉")) sources.add("newsletters");
    else if (n.source.startsWith("📄")) sources.add("analysis");
    else sources.add("OSINT feeds");
  }
  return { items: relevant, sources };
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
  baselineMean: number | null;   // trailing mean of daily peak mobility counts
  baselineSamples: number;
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
// `mobilityBaseline` comes from the store (trailing mean of daily peak counts) —
// the sensors stay DB-free; the assembler owns persistence.
export async function gatherObservations(
  mobilityBaseline: MobilityBaseline = { mean: null, samples: 0 },
): Promise<GatherResult> {
  const [conflictPts, disasters, newsByCountry, hormuzNewsRaw, advisories, milAc, firRes, userSrc] = await Promise.all([
    withTimeout(getConflictPoints(), 10_000),
    withTimeout(getDisasters(), 10_000),
    withTimeout(getConflictNewsByCountry(GULF_COUNTRIES), 12_000),
    withTimeout(gdeltLocalNews("Strait of Hormuz"), 10_000),
    withTimeout(getAllStateAdvisories(), 10_000),
    withTimeout(fetchMilAircraft(), 10_000),
    withTimeout(getFirNotams(AOR_FIRS), 12_000),
    gatherUserSourceNews().catch(() => ({ items: [] as NewsItem[], sources: new Set<string>() })),
  ]);
  const hormuzNews = hormuzNewsRaw ?? [];
  const userNews = userSrc?.items ?? [];
  const userSources = userSrc?.sources ?? new Set<string>();
  const userSrcLabel = userSources.size ? ` + your ${[...userSources].join("/")}` : "";

  const observations: IndicatorObservation[] = [];
  const health: SensorHealth[] = [];

  // 1) conflict_intensity_gulf ← UCDP/ACLED/ReliefWeb event density in the AOR,
  // banded on a ~90-day slice (warningRules) — the feed's 365-day window
  // saturates any threshold and a pinned indicator can't warn. UCDP candidates
  // lag 1-2 months (honest-SA caveat carried in provenance); undated ReliefWeb
  // situations count as current.
  let recent90 = 0;
  if (conflictPts) {
    const nowMs = Date.now();
    recent90 = recentConflictCount(conflictPts.filter((p) => inBbox(p.lat, p.lon)), nowMs);
    const state = bandConflictIntensity(recent90);
    observations.push(obs("conflict_intensity_gulf", "conflictEvents", state, state === "dormant" ? 0 : 0.85, `UCDP/ACLED/ReliefWeb events in AOR bbox, trailing ${CONFLICT_WINDOW_DAYS}d (UCDP lags 1-2mo)`, recent90));
    health.push({ indicatorId: "conflict_intensity_gulf", live: true });
  } else {
    health.push({ indicatorId: "conflict_intensity_gulf", live: false, note: "conflict-event feed unreachable" });
  }

  // 2) escalatory_strike_signal ← GDELT escalation across AOR states, CORROBORATED
  // by the user's own X/newsletters/OSINT feeds. Discipline: wire+own-source
  // agreement confirms; GDELT-only follows its own scale; own-source-ONLY (e.g. a
  // single X capture) caps at WATCH — social raises confidence, never confirms alone.
  const userEsc = scoreConflictNews(userNews);
  if (newsByCountry || userNews.length) {
    const signals = newsByCountry ? GULF_COUNTRIES.map((c) => newsByCountry[c.toLowerCase()]).filter(Boolean) : [];
    const gdeltEsc = signals.filter((s) => s?.escalation).length;
    const gdeltTotal = signals.reduce((s, sig) => s + (sig?.count || 0), 0);
    const total = gdeltTotal + userEsc.count;
    let state: ObservedState; let conf: number;
    if (gdeltEsc >= 1 && userEsc.escalation) { state = "confirmed"; conf = 0.85; }  // corroborated wire + own sources
    else if (gdeltEsc >= 2) { state = "confirmed"; conf = 0.75; }
    else if (gdeltEsc === 1) { state = "active"; conf = 0.7; }
    else if (userEsc.escalation) { state = "watching"; conf = 0.5; }                // own-source only → don't confirm
    else if (total > 0) { state = "watching"; conf = 0.55; }
    else { state = "dormant"; conf = 0; }
    observations.push(obs("escalatory_strike_signal", "conflictNews", state, conf, `GDELT DOC escalation scan across AOR states${userSrcLabel}`, total));
    health.push({ indicatorId: "escalatory_strike_signal", live: true });
  } else {
    health.push({ indicatorId: "escalatory_strike_signal", live: false, note: "conflict-news + your-source feeds unreachable" });
  }

  // Implied demand (for the divergence) = a CHANGE-signal trigger, never a
  // permanent condition: an in-effect departure order, a NEW Level-4 (14-day
  // recency gate — Iran/Iraq/Syria/Yemen are permanently L4 and used to pin
  // this true forever), confirmed-band 90d conflict intensity, or an AOR disaster.
  const nowMs = Date.now();
  const neoTriggers = (advisories ?? []).filter((a) =>
    GULF_COUNTRIES.includes(a.country) && (a.orderedDeparture || a.authorizedDeparture || isRecentLevel4(a, nowMs)));
  const aorDisasters = (disasters ?? []).filter((d) => typeof d.lat === "number" && typeof d.lon === "number" && inBbox(d.lat as number, d.lon as number));
  const impliedHigh = conflictImpliesDemand(recent90) || neoTriggers.length > 0 || aorDisasters.length > 0;

  // 3) mobility_divergence ← observed mil mobility/tanker near hubs × implied
  // demand. "Surge" is relative to THIS AOR's own trailing baseline
  // (mobilityObservedHigh) — Gulf hubs always have lift, so a static bar read
  // "surge" on ordinary days and pinned the 2×2.
  if (milAc) {
    const observedCount = milAc.filter((a) => nearHub(a.lat, a.lon) && (isMobilityType(a.type) || isTankerType(a.type))).length;
    const observedHigh = mobilityObservedHigh(observedCount, mobilityBaseline);
    let quadrant: DivergenceState["quadrant"];
    let state: ObservedState;
    if (impliedHigh && !observedHigh) { quadrant = "early_warning"; state = "active"; }       // demand, no lift → warning
    else if (!impliedHigh && observedHigh) { quadrant = "anomaly"; state = "active"; }         // lift, no trigger → warning
    else if (impliedHigh && observedHigh) { quadrant = "corroboration"; state = "watching"; }  // expected, low novelty
    else { quadrant = "quiet"; state = "dormant"; }
    const baseNote = mobilityBaseline.mean != null ? `, baseline ~${mobilityBaseline.mean.toFixed(0)}/day over ${mobilityBaseline.samples}d` : ", baseline forming";
    observations.push(obs("mobility_divergence", "aircraftMil", state, state === "dormant" ? 0 : 0.7, `keyless ADS-B mil (${observedCount} mobility/tanker within ${HUB_RADIUS_KM}km of AOR hubs${baseNote}) × implied demand`, observedCount));
    health.push({ indicatorId: "mobility_divergence", live: true });
    return finalize(observations, health, { impliedHigh, observedHigh, observedCount, baselineMean: mobilityBaseline.mean, baselineSamples: mobilityBaseline.samples, quadrant }, advisories, neoTriggers, hormuzNews, firRes, userNews, userSrcLabel);
  } else {
    health.push({ indicatorId: "mobility_divergence", live: false, note: "community ADS-B mirrors unreachable" });
    return finalize(observations, health, { impliedHigh, observedHigh: false, observedCount: 0, baselineMean: mobilityBaseline.mean, baselineSamples: mobilityBaseline.samples, quadrant: impliedHigh ? "early_warning" : "quiet" }, advisories, neoTriggers, hormuzNews, firRes, userNews, userSrcLabel);
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
  userNews: NewsItem[],
  userSrcLabel: string,
): GatherResult {
  // 4) neo_departure_posture ← in-effect ordered/authorized departure, or a NEW
  // Level-4 (neoTriggers is already 14-day recency-gated upstream — a standing
  // L4 like Iran's is posture, not warning).
  if (advisories) {
    const ordered = neoTriggers.some((a) => a.orderedDeparture);
    const authorized = neoTriggers.some((a) => a.authorizedDeparture);
    const newLevel4 = neoTriggers.some((a) => !a.orderedDeparture && !a.authorizedDeparture);
    const state: ObservedState = ordered ? "confirmed" : authorized ? "active" : newLevel4 ? "watching" : "dormant";
    observations.push(obs("neo_departure_posture", "stateAdvisories", state, state === "dormant" ? 0 : 0.9, "State Dept Travel Advisory RSS (ordered/authorized departure; NEW Level-4 within 14d)", neoTriggers.length));
    health.push({ indicatorId: "neo_departure_posture", live: true });
  } else {
    health.push({ indicatorId: "neo_departure_posture", live: false, note: "State advisory feed unreachable" });
  }

  // 5) hormuz_interdiction_signal ← Hormuz closure/mining/seizure reporting, from
  // GDELT AND the user's own sources (corroboration; own-source-only caps at watch).
  const HORMUZ_TERMS = ["hormuz", "strait"];
  const INTERDICT = ["clos", "mine", "mining", "seiz", "seized", "block", "impound", "attack", "harass"];
  const scan = (arr: NewsItem[]): number => arr.filter((a) => {
    const h = `${a.title} ${a.summary ?? ""}`.toLowerCase();
    return HORMUZ_TERMS.some((t) => h.includes(t)) && INTERDICT.some((t) => h.includes(t));
  }).length;
  const gdeltHits = scan(hormuzNews ?? []);
  const userHits = scan(userNews);
  let hState: ObservedState; let hConf: number;
  if (gdeltHits >= 1 && userHits >= 1) { hState = "active"; hConf = 0.75; }   // corroborated
  else if (gdeltHits >= 2) { hState = "active"; hConf = 0.6; }
  else if (gdeltHits === 1) { hState = "watching"; hConf = 0.55; }
  else if (userHits >= 1) { hState = "watching"; hConf = 0.45; }              // own-source only
  else { hState = "dormant"; hConf = 0; }
  observations.push(obs("hormuz_interdiction_signal", "conflictNews", hState, hConf, `GDELT DOC 'Strait of Hormuz' + interdiction scan${userSrcLabel}`, gdeltHits + userHits));
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
