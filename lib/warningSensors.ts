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
import { CENTCOM_GEO, type ProblemGeo } from "./warningTaxonomy";
import type { NewsItem } from "./types";

// The AOR definition (bbox / countries / hubs / FIRs / mention-gate terms /
// chokepoint) is a ProblemGeo parameter — CENTCOM_GEO carries the hand-tuned
// Gulf values these sensors shipped with; Mission Profile AOIs supply their
// own via problemFromSeed(). The six indicators are geography-agnostic.
const HUB_RADIUS_KM = 600;

const inBbox = (geo: ProblemGeo, lat: number, lon: number): boolean =>
  lat >= geo.bbox.latMin && lat <= geo.bbox.latMax && lon >= geo.bbox.lonMin && lon <= geo.bbox.lonMax;
const nearHub = (geo: ProblemGeo, lat: number, lon: number): boolean =>
  geo.hubs.some((h) => haversineKm(lat, lon, h.lat, h.lon) <= HUB_RADIUS_KM);

// Bound every feed so one slow/hung source can't idle the request past the
// platform gateway timeout (the SITREP-read 502 lesson). A timeout → null →
// that sensor degrades to "unreachable", never a hang.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const to = new Promise<null>((res) => { timer = setTimeout(() => res(null), ms); });
  return Promise.race([p.catch(() => null), to]).finally(() => clearTimeout(timer)) as Promise<T | null>;
}

// AOR relevance for free-text (X posts, newsletters, OSINT feeds aren't geo-
// tagged) — a mention gate (geo.terms) so only AOI-relevant items feed the score.
const aorRelevant = (geo: ProblemGeo, n: NewsItem): boolean => geo.terms.test(`${n.title} ${n.summary ?? ""}`);

// The user's OWN curated sources — imported X captures, newsletters, and the
// configured OSINT RSS/Telegram feeds. These often break a warning indicator
// before wire news does, but they're single-source: they raise confidence and
// can trip a WATCH, but only CORROBORATE (never alone confirm) — the scoring
// blends them so a social-only signal caps at watching. All fail-safe; the
// `sources` set drives provenance. Bounded so the fan-out can't hang the request.
async function gatherUserSourceNews(geo: ProblemGeo): Promise<{ items: NewsItem[]; sources: Set<string> }> {
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

  const relevant = items.filter((n) => aorRelevant(geo, n));
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

// ── Gather all observations for one warning problem ──────────────────────────
// `mobilityBaseline` comes from the store (trailing mean of daily peak counts) —
// the sensors stay DB-free; the assembler owns persistence. `geo` points the
// six indicators at the problem's part of the world (default: the Gulf).
export async function gatherObservations(
  mobilityBaseline: MobilityBaseline = { mean: null, samples: 0 },
  geo: ProblemGeo = CENTCOM_GEO,
): Promise<GatherResult> {
  const [conflictPts, disasters, newsByCountry, chokeNewsRaw, advisories, milAc, firRes, userSrc] = await Promise.all([
    withTimeout(getConflictPoints(), 10_000),
    withTimeout(getDisasters(), 10_000),
    withTimeout(getConflictNewsByCountry(geo.countries), 12_000),
    geo.chokepoint ? withTimeout(gdeltLocalNews(geo.chokepoint.searchTerm), 10_000) : Promise.resolve(null),
    withTimeout(getAllStateAdvisories(), 10_000),
    withTimeout(fetchMilAircraft(), 10_000),
    geo.firs.length ? withTimeout(getFirNotams(geo.firs), 12_000) : Promise.resolve(null),
    gatherUserSourceNews(geo).catch(() => ({ items: [] as NewsItem[], sources: new Set<string>() })),
  ]);
  const chokeNews = chokeNewsRaw ?? [];
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
    recent90 = recentConflictCount(conflictPts.filter((p) => inBbox(geo, p.lat, p.lon)), nowMs);
    const state = bandConflictIntensity(recent90);
    observations.push(obs(geo.conflictIndicatorId, "conflictEvents", state, state === "dormant" ? 0 : 0.85, `UCDP/ACLED/ReliefWeb events in AOR bbox, trailing ${CONFLICT_WINDOW_DAYS}d (UCDP lags 1-2mo)`, recent90));
    health.push({ indicatorId: geo.conflictIndicatorId, live: true });
  } else {
    health.push({ indicatorId: geo.conflictIndicatorId, live: false, note: "conflict-event feed unreachable" });
  }

  // 2) escalatory_strike_signal ← GDELT escalation across AOR states, CORROBORATED
  // by the user's own X/newsletters/OSINT feeds. Discipline: wire+own-source
  // agreement confirms; GDELT-only follows its own scale; own-source-ONLY (e.g. a
  // single X capture) caps at WATCH — social raises confidence, never confirms alone.
  const userEsc = scoreConflictNews(userNews);
  if (newsByCountry || userNews.length) {
    const signals = newsByCountry ? geo.countries.map((c) => newsByCountry[c.toLowerCase()]).filter(Boolean) : [];
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
    geo.countries.includes(a.country) && (a.orderedDeparture || a.authorizedDeparture || isRecentLevel4(a, nowMs)));
  const aorDisasters = (disasters ?? []).filter((d) => typeof d.lat === "number" && typeof d.lon === "number" && inBbox(geo, d.lat as number, d.lon as number));
  const impliedHigh = conflictImpliesDemand(recent90) || neoTriggers.length > 0 || aorDisasters.length > 0;

  // 3) mobility_divergence ← observed mil mobility/tanker near hubs × implied
  // demand. "Surge" is relative to THIS AOR's own trailing baseline
  // (mobilityObservedHigh) — Gulf hubs always have lift, so a static bar read
  // "surge" on ordinary days and pinned the 2×2.
  if (milAc) {
    const observedCount = milAc.filter((a) => nearHub(geo, a.lat, a.lon) && (isMobilityType(a.type) || isTankerType(a.type))).length;
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
    return finalize(geo, observations, health, { impliedHigh, observedHigh, observedCount, baselineMean: mobilityBaseline.mean, baselineSamples: mobilityBaseline.samples, quadrant }, advisories, neoTriggers, chokeNews, firRes, userNews, userSrcLabel);
  } else {
    health.push({ indicatorId: "mobility_divergence", live: false, note: "community ADS-B mirrors unreachable" });
    return finalize(geo, observations, health, { impliedHigh, observedHigh: false, observedCount: 0, baselineMean: mobilityBaseline.mean, baselineSamples: mobilityBaseline.samples, quadrant: impliedHigh ? "early_warning" : "quiet" }, advisories, neoTriggers, chokeNews, firRes, userNews, userSrcLabel);
  }
}

function finalize(
  geo: ProblemGeo,
  observations: IndicatorObservation[],
  health: SensorHealth[],
  divergence: DivergenceState,
  advisories: Awaited<ReturnType<typeof getAllStateAdvisories>> | null,
  neoTriggers: { orderedDeparture: boolean; authorizedDeparture: boolean; level: number | null }[],
  chokeNews: NewsItem[],
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

  // 5) chokepoint interdiction ← closure/mining/seizure reporting for the
  // problem's chokepoint (skipped entirely when the AOI has none), from GDELT
  // AND the user's own sources (corroboration; own-source-only caps at watch).
  if (geo.chokepoint) {
    const cp = geo.chokepoint;
    const INTERDICT = ["clos", "mine", "mining", "seiz", "seized", "block", "impound", "attack", "harass"];
    const scan = (arr: NewsItem[]): number => arr.filter((a) => {
      const h = `${a.title} ${a.summary ?? ""}`.toLowerCase();
      return cp.terms.some((t) => h.includes(t)) && INTERDICT.some((t) => h.includes(t));
    }).length;
    const gdeltHits = scan(chokeNews ?? []);
    const userHits = scan(userNews);
    let hState: ObservedState; let hConf: number;
    if (gdeltHits >= 1 && userHits >= 1) { hState = "active"; hConf = 0.75; }   // corroborated
    else if (gdeltHits >= 2) { hState = "active"; hConf = 0.6; }
    else if (gdeltHits === 1) { hState = "watching"; hConf = 0.55; }
    else if (userHits >= 1) { hState = "watching"; hConf = 0.45; }              // own-source only
    else { hState = "dormant"; hConf = 0; }
    observations.push(obs(cp.indicatorId, "conflictNews", hState, hConf, `GDELT DOC '${cp.name}' + interdiction scan${userSrcLabel}`, gdeltHits + userHits));
    health.push({ indicatorId: cp.indicatorId, live: true });
  }

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
