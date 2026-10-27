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
import { getChokepointReads, type ChokepointRead } from "./chokepointReads";
import { readInterdiction } from "./chokepointSignals";
import { chokepointState } from "./warningRules";
import { getAllStateAdvisories } from "./stateAdvisories";
import { getFirNotams } from "./airspace";
import { isMobilityType, isTankerType } from "./aircraftTypes";
import { getOpenSkyStates } from "./opensky";
import { getXItems } from "./xStore";
import { getAllCachedSummaries } from "./newsletterCache";
import { getCapturedArticles, articleToNewsItem } from "./articleStore";
import { fetchFeed } from "./rss";
import { getUserPrefs } from "./userPrefs";
import {
  isRecentLevel4, recentConflictCount, bandConflictIntensity, conflictImpliesDemand,
  mobilityObservedHigh, mobilityBaselineNote, CONFLICT_WINDOW_DAYS, type MobilityBaseline,
  conflictWithCaptures,
} from "./warningRules";
import { getCapturedEvents } from "./eventStore";
import { kineticEvents, countKineticInAoi } from "./kineticEvents";
import { mobilityWithChatter, type ChatterLite } from "./warningRules";
import { readChatter, chatterSurge } from "./mobilityChatter";
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
const aorRelevant = (geo: Pick<ProblemGeo, "terms">, n: NewsItem): boolean => geo.terms.test(`${n.title} ${n.summary ?? ""}`);

// The user's OWN curated sources — imported X captures, newsletters, and the
// configured OSINT RSS/Telegram feeds. These often break a warning indicator
// before wire news does, but they're single-source: they raise confidence and
// can trip a WATCH, but only CORROBORATE (never alone confirm) — the scoring
// blends them so a social-only signal caps at watching. All fail-safe; the
// `sources` set drives provenance. Bounded so the fan-out can't hang the request.
// Exported (mention gate only) so the economic-warfare assembler reads the
// same sources under the same cap.
export async function gatherUserSourceNews(geo: Pick<ProblemGeo, "terms">): Promise<{ items: NewsItem[]; sources: Set<string>; /** The whole pool before the mention gate — the lift-chatter grammar places a post by its own destination, not by the AOI's terms. */ all: NewsItem[] }> {
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
  return { items: relevant, sources, all: items };
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
  /** Per named hub (PLAN §5 C2): mobility and tanker counts within HUB_RADIUS_KM. */
  byHub?: { icao: string; mobility: number; tanker: number }[];
  /** Which instrument produced observedCount: the community mil mirrors
   *  (typed — mobility / tanker) or the OpenSky FALLBACK (mil by ICAO range
   *  or callsign, type unknown — its own baseline, its own series). */
  source?: "adsb" | "opensky";
  /** Lift reported TOWARD this command by the user's own sources in the last
   *  72 h (lib/mobilityChatter) — reporting beside the observation, never in
   *  place of it. Null = no chatter. */
  chatter?: ChatterLite | null;
}
export interface GatherResult {
  observations: IndicatorObservation[];
  health: SensorHealth[];
  divergence: DivergenceState;
  /** The AOI-relevant slice of the user's own sources, so the spectrum
   *  sensors (lib/spectrumSensors) can corroborate without a second fan-out. */
  userNews: NewsItem[];
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
  /** The OpenSky fallback's OWN trailing baseline (osky:<problemId>). */
  openskyBaseline: MobilityBaseline = { mean: null, samples: 0 },
): Promise<GatherResult> {
  const [conflictPts, disasters, newsByCountry, chokeNewsRaw, advisories, milAc, firRes, userSrc, capturedRaw] = await Promise.all([
    withTimeout(getConflictPoints(), 10_000),
    withTimeout(getDisasters(), 10_000),
    withTimeout(getConflictNewsByCountry(geo.countries), 12_000),
    // The SAME graded read the Economy tab's chokepoint board shows (15-min
    // cached, one GDELT query per chokepoint shared with that board).
    geo.chokepoint ? withTimeout(getChokepointReads([geo.chokepoint.id]), 12_000) : Promise.resolve(null),
    withTimeout(getAllStateAdvisories(), 10_000),
    withTimeout(fetchMilAircraft(), 10_000),
    geo.firs.length ? withTimeout(getFirNotams(geo.firs), 12_000) : Promise.resolve(null),
    gatherUserSourceNews(geo).catch(() => ({ items: [] as NewsItem[], sources: new Set<string>(), all: [] as NewsItem[] })),
    // The user's browser-captured map events (LiveUAMap) read as kinetic
    // acts and placed — the fill for ACLED's embargo (warningRules
    // conflictWithCaptures). A store miss is simply no captures.
    withTimeout(getCapturedEvents(300), 6_000),
  ]);
  const capturedKinetic = capturedRaw ? countKineticInAoi(kineticEvents(capturedRaw, Date.now()), { bbox: geo.bbox, countries: geo.countries }) : 0;
  const chokeNews: ChokepointRead | null = chokeNewsRaw?.signals?.[0] ?? null;
  const userNews = userSrc?.items ?? [];
  const userSources = userSrc?.sources ?? new Set<string>();
  const userSrcLabel = userSources.size ? ` + your ${[...userSources].join("/")}` : "";
  // Lift chatter toward THIS command in the last 72 h, from the whole own-
  // source pool (a spotter post names a base, not the AOI's terms).
  const chatter: ChatterLite | null = chatterSurge(readChatter(userSrc?.all ?? [], Date.now()), geo.aor, Date.now());

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
    const band = bandConflictIntensity(recent90);
    const fused = conflictWithCaptures({ state: band, confidence: band === "dormant" ? 0 : 0.85, live: true }, capturedKinetic);
    observations.push(obs(geo.conflictIndicatorId, "conflictEvents", fused.state, fused.confidence, `UCDP/ACLED/ReliefWeb events in AOR bbox, trailing ${CONFLICT_WINDOW_DAYS}d (UCDP lags 1-2mo)${fused.note}`, recent90 + capturedKinetic));
    health.push({ indicatorId: geo.conflictIndicatorId, live: true });
  } else {
    // The structured feeds are dead. The user's own captures can still earn
    // a watching floor (never more); below it the indicator is unobserved.
    const fused = conflictWithCaptures({ state: "dormant", confidence: 0, live: false }, capturedKinetic);
    if (fused.state !== "dormant") observations.push(obs(geo.conflictIndicatorId, "capturedEvents", fused.state, fused.confidence, `your captured map events only${fused.note}`, capturedKinetic));
    health.push({ indicatorId: geo.conflictIndicatorId, live: false, note: `conflict-event feed unreachable${capturedKinetic ? ` (${capturedKinetic} captured kinetic events in the AOI stand in, capped at watching)` : ""}` });
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
    const baseNote = mobilityBaselineNote(mobilityBaseline, new Date(nowMs).toISOString().slice(0, 10));
    // Per-hub split — which field carries the lift. Only named hubs (icao).
    const byHub = geo.hubs.filter((h) => h.icao).map((h) => {
      const near = milAc.filter((a) => haversineKm(a.lat, a.lon, h.lat, h.lon) <= HUB_RADIUS_KM);
      return { icao: h.icao!, mobility: near.filter((a) => isMobilityType(a.type)).length, tanker: near.filter((a) => isTankerType(a.type)).length };
    });
    const topHub = byHub.slice().sort((a, b) => (b.mobility + b.tanker) - (a.mobility + a.tanker))[0];
    const hubNote = observedHigh && topHub && topHub.mobility + topHub.tanker > 0 ? `; most at ${topHub.icao} (${topHub.mobility + topHub.tanker})` : "";
    const fused = mobilityWithChatter({ state, confidence: state === "dormant" ? 0 : 0.7, observedHigh, live: true }, chatter);
    observations.push(obs("mobility_divergence", "aircraftMil", fused.state, fused.confidence, `keyless ADS-B mil (${observedCount} mobility/tanker within ${HUB_RADIUS_KM}km of AOR hubs${baseNote}${hubNote}) × implied demand${fused.note}`, observedCount));
    health.push({ indicatorId: "mobility_divergence", live: true });
    return finalize(geo, observations, health, { impliedHigh, observedHigh, observedCount, baselineMean: mobilityBaseline.mean, baselineSamples: mobilityBaseline.samples, quadrant, byHub, source: "adsb", chatter }, advisories, neoTriggers, chokeNews, firRes, userNews, userSrcLabel);
  }

  // The community mirrors are down. FALLBACK: OpenSky's anonymous state
  // vectors over the AOI bbox (rationed — lib/opensky). A state vector has
  // no aircraft TYPE, so "military" is by ICAO range / callsign and a
  // fighter counts like a C-17: the read is judged against the fallback's
  // OWN baseline (osky:), its confidence is halved, and its state is capped
  // at watching — a weaker instrument must not fire the 2×2's alarm alone.
  const osky = await withTimeout(getOpenSkyStates(geo.bbox), 11_000);
  if (osky?.live) {
    const observedCount = osky.states.filter((a) => a.mil && !a.onGround && nearHub(geo, a.lat, a.lon)).length;
    const observedHigh = mobilityObservedHigh(observedCount, openskyBaseline);
    let quadrant: DivergenceState["quadrant"];
    let state: ObservedState;
    if (impliedHigh && !observedHigh) { quadrant = "early_warning"; state = "watching"; }
    else if (!impliedHigh && observedHigh) { quadrant = "anomaly"; state = "watching"; }
    else if (impliedHigh && observedHigh) { quadrant = "corroboration"; state = "watching"; }
    else { quadrant = "quiet"; state = "dormant"; }
    const baseNote = mobilityBaselineNote(openskyBaseline, new Date(nowMs).toISOString().slice(0, 10));
    // The fallback is already capped at watching; chatter can only add the note and a little confidence.
    const fused = mobilityWithChatter({ state, confidence: state === "dormant" ? 0 : 0.35, observedHigh, live: true }, chatter);
    observations.push(obs("mobility_divergence", "opensky", fused.state === "dormant" ? "dormant" : "watching", Math.min(0.45, fused.confidence), `OpenSky FALLBACK — community mil mirrors unreachable; ${observedCount} military-by-ICAO/callsign aircraft within ${HUB_RADIUS_KM}km of AOR hubs (type unknown${baseNote}) × implied demand — capped at watching${fused.note}`, observedCount));
    health.push({ indicatorId: "mobility_divergence", live: true, note: "community ADS-B mirrors unreachable — OpenSky fallback (mil by ICAO range / callsign, type unknown; capped at watching)" });
    return finalize(geo, observations, health, { impliedHigh, observedHigh, observedCount, baselineMean: openskyBaseline.mean, baselineSamples: openskyBaseline.samples, quadrant, source: "opensky", chatter }, advisories, neoTriggers, chokeNews, firRes, userNews, userSrcLabel);
  }
  // Every ADS-B instrument is dead. The user's own chatter can still earn a
  // watching floor — reported only, said so — else the indicator is unobserved.
  const dead = mobilityWithChatter({ state: "dormant", confidence: 0, observedHigh: false, live: false }, chatter);
  if (dead.state !== "dormant") observations.push(obs("mobility_divergence", "chatter", dead.state, dead.confidence, `no ADS-B instrument answered${dead.note}`, chatter?.reports));
  health.push({ indicatorId: "mobility_divergence", live: false, note: `community ADS-B mirrors unreachable; OpenSky fallback ${osky ? osky.reason ?? "not live" : "timed out"}${chatter ? ` — your sources' lift chatter stands in, capped at watching` : ""}` });
  return finalize(geo, observations, health, { impliedHigh, observedHigh: false, observedCount: 0, baselineMean: mobilityBaseline.mean, baselineSamples: mobilityBaseline.samples, quadrant: impliedHigh ? "early_warning" : "quiet", chatter }, advisories, neoTriggers, chokeNews, firRes, userNews, userSrcLabel);
}

function finalize(
  geo: ProblemGeo,
  observations: IndicatorObservation[],
  health: SensorHealth[],
  divergence: DivergenceState,
  advisories: Awaited<ReturnType<typeof getAllStateAdvisories>> | null,
  neoTriggers: { orderedDeparture: boolean; authorizedDeparture: boolean; level: number | null }[],
  chokeNews: ChokepointRead | null,
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

  // 5) chokepoint interdiction ← the GRADED activity read for the problem's
  // chokepoint (skipped entirely when the AOI has none): modality-graded text
  // (reported act > declared threat > analysis) plus georeferenced kinetic
  // events in the approaches — the same read the Economy tab shows, so the
  // board and the I&W indicator can never disagree about the strait. The
  // user's own sources corroborate through the same interdiction grammar
  // (readInterdiction), never a bare mention; own-source-only caps at watch
  // (warningRules.chokepointState).
  if (geo.chokepoint) {
    const cp = geo.chokepoint;
    const userHits = userNews.filter((a) => {
      const h = `${a.title} ${a.summary ?? ""}`;
      return cp.terms.some((t) => h.toLowerCase().includes(t)) && readInterdiction(h) !== null;
    }).length;
    const lite = chokeNews
      ? { acts: chokeNews.acts, threats: chokeNews.threats, analysis: chokeNews.analysis, events: chokeNews.totalEvents, score: chokeNews.score, transit: chokeNews.transit?.state, transitLeadRate: chokeNews.transitLead ? chokeNews.transitLead.hits / chokeNews.transitLead.events : null }
      : null;
    const { state: hState, confidence: hConf, why } = chokepointState(lite, userHits);
    if (chokeNews || userHits > 0) {
      observations.push(obs(
        cp.indicatorId, "conflictNews", hState, hConf,
        `${cp.name} graded read — ${why}${chokeNews?.lead ? ` · lead: "${chokeNews.lead.title.slice(0, 80)}"` : ""}${userSrcLabel}`,
        (lite ? lite.acts + lite.threats : 0) + userHits,
      ));
    }
    if (chokeNews) health.push({ indicatorId: cp.indicatorId, live: true });
    else health.push({ indicatorId: cp.indicatorId, live: false, note: `${cp.name} read unavailable (GDELT/conflict feeds)` });
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

  return { observations, health, divergence, userNews };
}
