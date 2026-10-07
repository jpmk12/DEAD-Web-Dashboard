// SITREP assembler — the commander's situation report for one operating
// location (OSINT tab → SITREP pane). SERVER-ONLY: composes existing keyless
// sources (AWC METAR/TAF, NWS alerts, Open-Meteo, DAIP NOTAMs, OurAirports,
// Force Protection fusion, GDELT local news) around a single base. Every
// section is best-effort and reports its own liveness — a source that can't
// be reached shows UNKNOWN, never an implied "all clear".

import type { SitrepBase, TafReport, MetarObs } from "./types";
import { getFlightCategories, getTafOutlook, CAT_RANK, type AviationWx, type TafOutlook } from "./aviationWx";
import { decodeMetar, decodeTaf } from "./metar";
import { fetchWithTimeout } from "./fetchTimeout";
import { getNotams, notamTimeState, type Notam } from "./notams";
import { airfieldCapabilities, airfieldRunways, type RunwayCap } from "./ourAirports";
import { aggregateThreats } from "./severeWeather";
import { getCurrentConditions, type CurrentConditions } from "./currentConditions";
import { getDisasters, haversineKm } from "./disasters";
import { getForceProtection } from "./forceProtection";
import { gdeltLocalNews } from "./localNews";
import { getCenterNotams, getFuelNotams } from "./airspace";
import { classifyAor, type Aor } from "./aor";
import { normalizeCountryName } from "./countryNames";
import {
  groupNotams, filterImpactNews, tafTimeline, wxLed, opsLed, threatLed, runwayWinds,
  type NotamGroup, type TafSegment, type Led, type RunwayWind,
} from "./sitrepSignals";
import { astroData, type AstroData } from "./astro";
import { recordSitrepDay, getSitrepHistory, type SitrepDay } from "./sitrepHistory";
import { getInfraSources, type SitrepInfra } from "./infra";
import { splitInfraNews, infraLed, nasLed } from "./infraSignals";
import { deriveMissionImpact, type MissionImpact } from "./limfac";
import { listLimfacs } from "./limfacStore";
import { getGpsInterference, gpsLevelAt } from "./gpsjam";
import { getNoaaScales } from "./spaceSources";
import { getKev } from "./cyberSources";
import { getMissionProfile } from "./missionProfileApply";
import { spaceWeatherImpacts, spaceWxLed, type SpaceWxImpact, type ScaleDay } from "./spaceWeatherOps";
import { kevHits } from "./cyberSignals";
import { edgeExposureLed } from "./spectrumRules";
import { spectrumLed, spectrumShort } from "./sitrepSignals";
import { recordSensorDay, getSensorSeries, getSensorSeriesMany } from "./sensorStore";
import { closureWindows } from "./sitrepSignals";
import { baseTempo, type BaseTempo } from "./baseTempo";
import { functionChronicity, timeToResolve } from "./limfacTrend";
import { kevCadence, type KevCadence } from "./spectrumTrend";
import type { ManualLimfac } from "./limfac";
import { sensorKey } from "./sensorKeys";
import { catOrdinal, tafVerification, type TafSkill } from "./tafVerify";
import { bestBaseline, highWater, type SeriesPoint } from "./series";

export interface SitrepAlert {
  event: string;
  severity: string;
  lifeThreatening: boolean;
  headline: string;
}

export interface SitrepOutlookDay {
  date: string;        // YYYY-MM-DD
  hiF: number | null;
  loF: number | null;
  precipPct: number | null;
  windMph: number | null;
}

// Spectrum at the field (REVIEW-CYBER-SPACE §3.2): PNT (GPSJam cell the
// airfield sits in + RAIM outage NOTAMs), space weather → ops impact rows,
// and KEV entries on the DECLARED edge vendors. Every block reports its own
// liveness; an undeclared vendor list is UNKNOWN, never green.
export interface SitrepSpectrum {
  pnt: { live: boolean; date: string; cellLevel: number; raim: string[] };
  spaceWx: { live: boolean; now: ScaleDay | null; outlook: ScaleDay[]; impacts: SpaceWxImpact[]; polar: boolean | null; satcom: string };
  edge: {
    declared: boolean; live: boolean; vendors: string[];
    hits: { cve: string; vendor: string; product: string; name: string; dateAdded: string; ransomware: boolean }[];
    /** KEV cadence per declared vendor against its own normal (lib/spectrumTrend). */
    cadence?: KevCadence[];
  };
}

export interface LiftRead {
  today: number | null;
  normal: number | null;
  kind: "weekday" | "flat" | "none";
  samples: number;
  /** Today above every prior value in 30 days (null below seven prior points). */
  high: boolean | null;
  label: string;
}

export interface SitrepPayload {
  base: SitrepBase;
  generatedAt: string;
  status: { wx: Led; ops: Led; threat: Led; infra: Led; spectrum: Led };
  weather: {
    live: boolean;
    now: AviationWx | null;
    metarRaw: string | null;
    tafWorst: TafOutlook | null;
    tafSegments: TafSegment[];
    /** How this field's TAF has verified against its METAR (lib/tafVerify); absent until recorded. */
    tafSkill?: TafSkill | null;
    alerts: SitrepAlert[];
    current: CurrentConditions | null;
    outlook: SitrepOutlookDay[];
    windDirDeg: number | null;
    windVariable: boolean;
  };
  astro: AstroData;
  ops: {
    configured: boolean;   // DAIP CA present
    live: boolean;         // DAIP fetch succeeded
    notamCount: number;
    groups: NotamGroup[];
    limiting: boolean;
    fieldClosed: boolean;
    capability: RunwayCap | null;
    // Enroute/center NOTAM picture for the owning ARTCC (base.artcc), when set.
    center: { code: string; live: boolean; count: number; items: { text: string; amber: boolean }[] } | null;
    // Crosswind/headwind per runway end from the current METAR (advisory).
    runwayWinds: RunwayWind[];
    /** Lift at this field vs its own normal (PLAN §5 C2) — only when the field
     *  is a hub on an I&W board and the ADS-B series exists. */
    lift?: LiftRead | null;
    // System fuel NOTAMs referencing this ICAO (DAIP FUEL_NOTAMS).
    fuel: { live: boolean; items: string[] } | null;
  };
  // Worst LED per axis per UTC day, oldest→newest (≤7 rows incl. today).
  history: SitrepDay[];
  /** Operating tempo read along the recorded series (lib/baseTempo, PLAN §6 D1). */
  tempo?: BaseTempo | null;
  // Infrastructure: IODA internet + USGS water + FAA NAS sensors, plus the
  // news-derived utility buckets (power has NO sensor — labeled as such).
  infra: SitrepInfra & {
    powerNews: { title: string; link: string; matched: string[] }[];
    waterNews: { title: string; link: string; matched: string[] }[];
    commsNews: { title: string; link: string; matched: string[] }[];
  };
  threats: {
    fp: { composite: string; topDriver: string; axes: { key: string; severity: string; summary: string }[] } | null;
    disasters: { title: string; type: string; severity: string; km: number }[];
    news: { title: string; link: string; matched: string[] }[];
    newsScanned: number;
  };
  spectrum: SitrepSpectrum;
  // Leadership-facing mission-capability rollup: per-function FMC/PMC/NMC, the
  // ranked LIMFAC register (auto-derived + commander-entered), and CCIR flags.
  mission: MissionImpact;
}

// Compact per-base rollup for the multi-base tile strip and the Morning Brief
// block — derived deterministically from an assembled payload (no extra fetch,
// no model call).
export interface SitrepSummary {
  icao: string;
  label: string;
  /** The base's country and command, so the command board can place it. */
  country: string;
  aor: Aor;
  status: SitrepPayload["status"];
  driver: string;    // short tile line — the worst axis explains itself
  line: string;      // 1-2 sentence Morning Brief read
  worse: string[];   // axes worse than yesterday (history compare, u ignored)
}

const LED_RANK: Record<Led, number> = { u: 0, g: 1, a: 2, r: 3 };

export function sitrepSummary(p: SitrepPayload): SitrepSummary {
  const prev = p.history.length >= 2 ? p.history[p.history.length - 2] : null;
  // All five axes. Infra and spectrum are nullable on older history rows —
  // an unobserved yesterday is skipped, never read as green (REVIEW-2026-10
  // §6 O6: before this only wx/ops/threat could flag "worse than yesterday").
  const worse = prev
    ? (["wx", "ops", "threat", "infra", "spectrum"] as const).filter((k) => {
        const was = prev[k] as Led | null | undefined;
        return was != null && was !== "u" && LED_RANK[p.status[k]] > LED_RANK[was];
      })
    : [];

  const cat = p.weather.now?.flightCategory ?? null;
  const tafWorst = p.weather.tafWorst?.worst ?? null;
  const wxShort = cat
    ? `${cat}${tafWorst && tafWorst !== cat ? ` → ${tafWorst} fcst` : ""}`
    : "no METAR";
  const limitingNotam = p.ops.groups.flatMap((g) => g.items).find((n) => n.amber);
  const opsShort = p.ops.fieldClosed ? "FIELD CLOSED (NOTAM)"
    : p.ops.limiting ? (limitingNotam ? limitingNotam.text.slice(0, 48) : "limiting NOTAM active")
    : (!p.ops.configured || !p.ops.live) ? "DAIP unreachable — OPS UNKNOWN"
    : `${p.ops.notamCount} NOTAMs, none limiting`;
  const infraShort = !p.infra.internet.live && !p.infra.nas?.live ? "infra sensors unreachable — UNKNOWN"
    : p.infra.internet.led === "r" || p.infra.internet.led === "a" ? "internet degradation detected"
    : p.infra.nas?.nearby.some((x) => x.kind === "closure" || x.kind === "groundStop")
      ? `NAS ${p.infra.nas.nearby.find((x) => x.kind === "closure" || x.kind === "groundStop")!.kind === "closure" ? "closure" : "ground stop"} at ${p.infra.nas.nearby.find((x) => x.kind === "closure" || x.kind === "groundStop")!.airport}`
    : p.infra.powerNews.length > 0 ? "power reporting in local news"
    : "no infra degradation";
  const axisShort: Record<"wx" | "ops" | "threat" | "infra" | "spectrum", string> = {
    wx: wxShort,
    ops: opsShort,
    threat: p.threats.fp ? p.threats.fp.topDriver : "FP assessment unavailable",
    infra: infraShort,
    spectrum: spectrumShort(p.spectrum),
  };
  // Tile driver = the worst axis speaking for itself. Ties resolve toward the
  // airfield (ops), which is what the tile owner runs. All-green = wx + NOTAM count.
  const order: ("ops" | "wx" | "threat" | "infra" | "spectrum")[] = ["ops", "wx", "threat", "infra", "spectrum"];
  const worst = order.reduce((acc, k) => (LED_RANK[p.status[k]] > LED_RANK[p.status[acc]] ? k : acc), order[0]);
  const driver = p.status[worst] === "g" ? `${wxShort} · ${opsShort}` : axisShort[worst];

  // Brief sentence: field state, weather trajectory, infra — the day's read.
  const fieldClause = p.ops.fieldClosed ? "Field CLOSED by NOTAM"
    : p.ops.limiting ? `Field open with a limiting NOTAM${limitingNotam ? ` — ${limitingNotam.text.slice(0, 60)}` : ""}`
    : p.ops.configured && p.ops.live ? `Field open, ${p.ops.notamCount} NOTAMs (none limiting)`
    : "Airfield status UNKNOWN (DAIP unreachable)";
  const tafFrom = p.weather.tafWorst?.fromISO ? ` after ${p.weather.tafWorst.fromISO.slice(11, 16)}Z` : "";
  const wxClause = cat
    ? `${cat} now${tafWorst && tafWorst !== cat && CAT_RANK[tafWorst] > CAT_RANK[cat] ? `, TAF drops ${tafWorst}${tafFrom}` : ""}`
    : "no current METAR";
  const xw = p.ops.runwayWinds.find((r) => r.flag !== "g");
  const xwClause = xw ? `; crosswind advisory RWY ${xw.ident} (${xw.crossKt}kt${xw.gustCrossKt ? ` G${xw.gustCrossKt}` : ""})` : "";
  const line = `${fieldClause}; ${wxClause}. ${infraShort.charAt(0).toUpperCase()}${infraShort.slice(1)}${xwClause}.`;

  return {
    icao: p.base.icao, label: p.base.label,
    // Older bases carry ISO2 ("DE") — normalise so the board keys one country.
    country: normalizeCountryName(p.base.country) || "",
    aor: classifyAor({ lat: p.base.lat, lon: p.base.lon, name: normalizeCountryName(p.base.country) }),
    status: p.status, driver, line, worse: [...worse],
  };
}

/** All-UNKNOWN summary for a base whose assembly failed — a missing tile would
 *  read as "fine". Shared by the summary route, the heartbeat and the command
 *  board so every surface degrades the same way. */
export function sitrepStub(base: SitrepBase): SitrepSummary {
  return {
    icao: base.icao,
    label: base.label,
    country: normalizeCountryName(base.country) || "",
    aor: classifyAor({ lat: base.lat, lon: base.lon, name: normalizeCountryName(base.country) }),
    status: { wx: "u", ops: "u", threat: "u", infra: "u", spectrum: "u" },
    driver: "assembly failed — UNKNOWN",
    line: `${base.icao} assembly failed this cycle — status UNKNOWN, not clear.`,
    worse: [],
  };
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { payload: SitrepPayload; expires: number }>();

/** Lift at a hub against its own normal — null when the field has no series. */
export function liftRead(series: SeriesPoint[], today: string): LiftRead | null {
  if (!series.length) return null;
  const b = bestBaseline(series, today, 30);
  const hw = highWater(series, today, 30);
  const todayV = series.find((p) => p.day === today)?.value ?? null;
  let label: string;
  if (todayV == null) label = `no lift count recorded today · ${series.length} observed days on record`;
  else if (b.mean == null) label = `${todayV} mobility aircraft within 600 km today · baseline forming (${b.samples} observed days)`;
  else {
    const pct = Math.round((todayV / Math.max(b.mean, 0.5) - 1) * 100);
    label = `${todayV} mobility aircraft within 600 km today vs ${b.kind === "weekday" ? "same-weekday" : "30-day"} normal ~${b.mean.toFixed(0)} (${pct >= 0 ? "+" : ""}${pct}%)${hw.isHigh ? " — 30-day high" : ""}`;
  }
  return { today: todayV, normal: b.mean, kind: b.kind, samples: b.samples, high: hw.isHigh, label };
}

export function resetSitrepCache(): void {
  cache.clear();
}

const AWC = "https://aviationweather.gov/api/data";
const UA = { "User-Agent": "DEAD-Dashboard/1.0", Accept: "application/json" };

// Raw METAR line + full TAF (periods for the timeline). aviationWx's helpers
// return the decoded category / worst-outlook views; the SITREP also wants
// the raw obs text and the period-by-period picture.
async function fetchRawWx(icao: string): Promise<{ metar: MetarObs | null; taf: TafReport | null }> {
  const [metarRes, tafRes] = await Promise.all([
    fetchWithTimeout(`${AWC}/metar?ids=${icao}&format=json`, { headers: UA, cache: "no-store" }, 10_000).catch(() => null),
    fetchWithTimeout(`${AWC}/taf?ids=${icao}&format=json`, { headers: UA, cache: "no-store" }, 10_000).catch(() => null),
  ]);
  let metar: MetarObs | null = null;
  if (metarRes?.ok) {
    try {
      const rows = await metarRes.json();
      if (Array.isArray(rows) && rows.length > 0) metar = decodeMetar(rows[0] as Parameters<typeof decodeMetar>[0]);
    } catch { /* metar stays null */ }
  }
  let taf: TafReport | null = null;
  if (tafRes?.ok) {
    try {
      const rows = await tafRes.json();
      if (Array.isArray(rows) && rows.length > 0) taf = decodeTaf(rows[0] as Parameters<typeof decodeTaf>[0]);
    } catch { /* taf stays null */ }
  }
  return { metar, taf };
}

// 3-day Open-Meteo outlook (imperial units to match the rest of the app).
async function fetchOutlook(lat: number, lon: number): Promise<SitrepOutlookDay[]> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=3&timezone=auto`;
    const res = await fetchWithTimeout(url, { cache: "no-store" }, 10_000);
    if (!res.ok) return [];
    const j = (await res.json()) as { daily?: Record<string, unknown[]> };
    const d = j.daily;
    if (!d || !Array.isArray(d.time)) return [];
    const num = (arr: unknown[] | undefined, i: number): number | null => {
      const v = Number(arr?.[i]);
      return Number.isFinite(v) ? Math.round(v) : null;
    };
    return (d.time as unknown[]).slice(0, 3).map((t, i) => ({
      date: String(t),
      hiF: num(d.temperature_2m_max, i),
      loF: num(d.temperature_2m_min, i),
      precipPct: num(d.precipitation_probability_max, i),
      windMph: num(d.wind_speed_10m_max, i),
    }));
  } catch {
    return [];
  }
}

export async function assembleSitrep(base: SitrepBase): Promise<SitrepPayload> {
  // Key includes the ARTCC so setting/changing the center via the inline
  // editor takes effect immediately instead of waiting out the TTL.
  const cacheKey = `${base.icao}|${base.artcc ?? ""}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.payload;

  const icao = base.icao.toUpperCase();
  const now = Date.now();

  const [cats, tafOutlook, rawWx, notams, caps, alerts, current, outlook, disasters, fpResult, newsRaw, infraSources] =
    await Promise.all([
      getFlightCategories([icao]).catch(() => ({ live: false, byIcao: {} as Record<string, AviationWx> })),
      getTafOutlook([icao], 24).catch(() => ({} as Record<string, TafOutlook>)),
      fetchRawWx(icao),
      getNotams([icao]).catch(() => ({ configured: false, live: false, byIcao: {} as Record<string, Notam[]> })),
      airfieldCapabilities([icao]).catch(() => ({} as Record<string, RunwayCap>)),
      aggregateThreats([{ label: base.label, lat: base.lat, lon: base.lon }]).catch(() => []),
      getCurrentConditions(base.lat, base.lon).catch(() => null),
      fetchOutlook(base.lat, base.lon),
      getDisasters().catch(() => []),
      getForceProtection([], [{
        id: `sitrep-${icao}`,
        label: base.label,
        icao,
        lat: base.lat,
        lon: base.lon,
        country: base.country || "United States",
        cocom: classifyAor({ lat: base.lat, lon: base.lon, name: base.country }),
        kind: "base" as const,
      }]).catch(() => null),
      gdeltLocalNews(base.place || base.label).catch(() => []),
      getInfraSources(base).catch((): SitrepInfra => ({ internet: { live: false, entity: null, led: "u", series: [] }, water: null, nas: null })),
    ]);

  const [runways, fuelRes, historyRows, manualLimfacs, gps, scales, kev, profile] = await Promise.all([
    airfieldRunways(icao).catch(() => []),
    getFuelNotams().catch(() => null),
    getSitrepHistory(icao, 7).catch(() => [] as SitrepDay[]),
    listLimfacs(icao).catch(() => []),
    getGpsInterference().catch(() => ({ ok: false, hexes: [], date: "" })),
    getNoaaScales().catch(() => ({ live: false, now: { date: "", R: null, S: null, G: null }, outlook: [] })),
    getKev().catch(() => ({ live: false, entries: [] })),
    getMissionProfile().catch(() => null),
  ]);

  // Center (ARTCC) enroute NOTAMs — the "what's between us and everywhere
  // else" layer the user's ops summary needs (KWRI → ZNY). Optional per base.
  let center: SitrepPayload["ops"]["center"] = null;
  if (base.artcc) {
    const c = await getCenterNotams(base.artcc).catch(() => null);
    if (c) {
      const items = (c.groups[0]?.notams ?? [])
        .filter((n) => notamTimeState(n, now) !== "expired")
        .slice(0, 8)
        .map((n) => ({ text: n.text, amber: n.alert === "Warning" || /\bTFR|GPS\b/i.test(n.text) }));
      center = { code: base.artcc, live: c.configured && c.live, count: items.length, items };
    } else {
      center = { code: base.artcc, live: false, count: 0, items: [] };
    }
  }

  const nowWx = cats.byIcao[icao] ?? null;
  const obs = rawWx.metar;
  const tafWorst = tafOutlook[icao] ?? null;
  const tafSegments = rawWx.taf ? tafTimeline(rawWx.taf.periods, now, 24) : [];
  const sitAlerts: SitrepAlert[] = alerts.slice(0, 6).map((a) => ({
    event: a.event,
    severity: a.severity,
    lifeThreatening: Boolean(a.lifeThreatening),
    headline: a.headline ?? "",
  }));

  // Ops: only NOTAMs that are active or upcoming — expired ones are noise.
  const baseNotams = (notams.byIcao[icao] ?? []).filter((n) => notamTimeState(n, now) !== "expired");
  const { groups, limiting, fieldClosed } = groupNotams(baseNotams);

  const assessment = fpResult?.assessments?.[0] ?? null;
  const fp = assessment
    ? {
        composite: assessment.composite,
        topDriver: assessment.topDriver,
        axes: assessment.categories.map((c) => ({ key: c.category, severity: c.severity, summary: c.signals[0] ?? "" })),
      }
    : null;

  const nearDisasters = disasters
    .filter((d) => d.lat != null && d.lon != null)
    .map((d) => ({ title: d.title, type: d.type, severity: d.severity, km: Math.round(haversineKm(base.lat, base.lon, d.lat!, d.lon!)) }))
    .filter((d) => d.km <= 500)
    .sort((a, b) => a.km - b.km)
    .slice(0, 5);

  const impactNews = filterImpactNews(newsRaw.map((n) => ({ title: n.title, link: n.link }))).slice(0, 6);
  const infraNews = splitInfraNews(impactNews);

  const severeAlert = sitAlerts.some((a) => a.lifeThreatening || a.severity === "Extreme");

  // ── Spectrum at the field ──
  const spec = profile?.spectrum ?? { polarRoutes: false, satcom: "", edgeVendors: [], spaceActivity: true };
  const raim = baseNotams.filter((n) => n.category === "gps_raim").map((n) => n.text.slice(0, 160));
  const cellLevel = gps.ok ? gpsLevelAt(base.lat, base.lon, gps.hexes) : 0;
  const impacts = spaceWeatherImpacts(scales, { polar: spec.polarRoutes });
  const hits = kev.live ? kevHits(kev.entries, spec.edgeVendors, now, 14) : [];
  const edgeLed = edgeExposureLed(hits, spec.edgeVendors.length > 0, kev.live);
  const spectrum: SitrepSpectrum = {
    pnt: { live: gps.ok, date: gps.date, cellLevel, raim },
    spaceWx: { live: scales.live, now: scales.live ? scales.now : null, outlook: scales.outlook, impacts, polar: spec.polarRoutes, satcom: spec.satcom },
    edge: {
      declared: spec.edgeVendors.length > 0, live: kev.live, vendors: spec.edgeVendors,
      hits: hits.map((h) => ({ cve: h.entry.cveID, vendor: h.vendor, product: h.entry.product, name: h.entry.vulnerabilityName, dateAdded: h.entry.dateAdded, ransomware: h.entry.knownRansomwareCampaignUse })),
    },
  };
  const spectrumStatus = spectrumLed({ pntLive: gps.ok, cellLevel, raimCount: raim.length, spaceWx: spaceWxLed(scales, { polar: spec.polarRoutes }), edge: edgeLed });

  const payload: SitrepPayload = {
    base,
    generatedAt: new Date(now).toISOString(),
    status: {
      wx: wxLed(nowWx?.flightCategory ?? null, tafWorst?.worst ?? null, sitAlerts.length, severeAlert),
      ops: opsLed(notams.configured, notams.live, limiting, fieldClosed),
      threat: threatLed(fp?.composite ?? null),
      infra: infraLed(
        infraSources.internet.led,
        infraSources.nas ? nasLed(infraSources.nas.live, infraSources.nas.nearby, icao) : null,
        infraNews.power.length,
        infraNews.comms.length,
      ),
      spectrum: spectrumStatus,
    },
    weather: {
      live: cats.live,
      now: nowWx,
      metarRaw: obs?.raw ?? null,
      tafWorst,
      tafSegments,
      alerts: sitAlerts,
      current,
      outlook,
      windDirDeg: obs?.windDir ?? null,
      windVariable: Boolean(obs?.windVariable),
    },
    astro: astroData(base.lat, base.lon, now),
    ops: {
      configured: notams.configured,
      live: notams.live,
      notamCount: baseNotams.length,
      groups,
      limiting,
      fieldClosed,
      capability: caps[icao] ?? null,
      center,
      runwayWinds: runwayWinds(runways, obs?.windDir ?? null, Boolean(obs?.windVariable), obs?.windSpeedKt ?? nowWx?.windKt ?? null, obs?.windGustKt ?? nowWx?.gustKt ?? null),
      fuel: fuelRes
        ? {
            live: fuelRes.configured && fuelRes.live,
            items: fuelRes.groups.flatMap((g) => g.notams).filter((n) => n.text.toUpperCase().includes(icao)).slice(0, 4).map((n) => n.text.slice(0, 200)),
          }
        : null,
    },
    history: historyRows,
    infra: {
      ...infraSources,
      powerNews: infraNews.power,
      waterNews: infraNews.water,
      commsNews: infraNews.comms,
    },
    threats: {
      fp,
      disasters: nearDisasters,
      news: impactNews,
      newsScanned: newsRaw.length,
    },
    spectrum,
    // Placeholder — filled right after the payload exists (deriveMissionImpact
    // reads the assembled ops/weather/threats/infra + the manual LIMFACs).
    mission: { state: "fmc", functions: [], limfacs: [], ccir: [] },
  };
  payload.mission = deriveMissionImpact(payload, manualLimfacs);

  // Persist today's worst-per-axis LEDs (fire-and-forget) and reflect today
  // in the history strip immediately.
  recordSitrepDay(icao, payload.status).catch(() => {});
  const today = new Date(now).toISOString().slice(0, 10);

  // Base tempo series (PLAN §6 D1) — only what a live source produced.
  if (notams.configured && notams.live) {
    recordSensorDay(sensorKey("notam", icao), today, baseNotams.length).catch(() => {});
    const windows = closureWindows(baseNotams.map((n) => ({ category: n.category, rank: 0, text: n.text, start: n.start, end: n.end })), now, 24);
    const rwyClosed = windows.some((w) => w.kind === "closure" && !w.indeterminate && /^(RWY|Airfield)/i.test(w.label));
    recordSensorDay(sensorKey("rwyclose", icao), today, rwyClosed ? 1 : 0).catch(() => {});
  }
  if (payload.ops.runwayWinds.length) {
    recordSensorDay(sensorKey("xwind", icao), today, Math.max(...payload.ops.runwayWinds.map((r) => r.crossKt))).catch(() => {});
  }
  // LIMFAC memory (PLAN §6 D3): 1 on a day a function read PMC/NMC, 0 when
  // FMC, nothing when UNKNOWN — a dead feed is not a good day.
  for (const f of payload.mission.functions) {
    recordSensorDay(sensorKey("limfac", icao, f.key), today, f.capability === "unknown" ? null : f.capability === "fmc" ? 0 : 1).catch(() => {});
  }

  // TAF verification series (PLAN §4 B2): the worst forecast category and the
  // worst observed category per UTC day, as ordinals, day-peak. A missing
  // METAR or TAF writes nothing. The pairing is read back for the Weather
  // card — a tally until TAF_MIN_PAIRED days exist.
  const fcKey = sensorKey("fc", icao), tafKey = sensorKey("taf", icao);
  recordSensorDay(fcKey, today, catOrdinal(nowWx?.flightCategory)).catch(() => {});
  recordSensorDay(tafKey, today, catOrdinal(tafWorst?.worst)).catch(() => {});
  try {
    const limfacKeys = payload.mission.functions.map((f) => sensorKey("limfac", icao, f.key));
    const [fcSeries, tafSeries, liftSeries, notamSeries, rwySeries, xwSeries, limfacSeries, allManual] = await Promise.all([
      getSensorSeries(fcKey, 90), getSensorSeries(tafKey, 90), getSensorSeries(sensorKey("mob", icao), 90),
      getSensorSeries(sensorKey("notam", icao), 60), getSensorSeries(sensorKey("rwyclose", icao), 60), getSensorSeries(sensorKey("xwind", icao), 60),
      getSensorSeriesMany(limfacKeys, 30), listLimfacs(icao, true).catch(() => [] as ManualLimfac[]),
    ]);
    payload.weather.tafSkill = tafVerification(fcSeries, tafSeries);
    payload.ops.lift = liftRead(liftSeries, today);
    payload.tempo = baseTempo({ fc: fcSeries, notam: notamSeries, rwyclose: rwySeries, xwind: xwSeries }, today);
    const chronicity: Record<string, { state: string; label: string | null }> = {};
    for (const f of payload.mission.functions) {
      if (f.capability === "unknown") continue;
      const c = functionChronicity(limfacSeries[sensorKey("limfac", icao, f.key)] ?? [], f.capability !== "fmc", today);
      if (c.state !== "quiet" && c.state !== "unknown") chronicity[f.key] = { state: c.state, label: c.label };
    }
    payload.mission.chronicity = chronicity;
    payload.mission.resolution = timeToResolve(allManual.map((m) => ({ fn: m.fn, status: m.status, createdAt: m.createdAt, updatedAt: m.updatedAt })));
    if (spec.edgeVendors.length) {
      const keys = spec.edgeVendors.map((v) => sensorKey("kev", v));
      const kevSeries = await getSensorSeriesMany(keys, 90);
      const byVendor: Record<string, SeriesPoint[]> = {};
      spec.edgeVendors.forEach((v, i) => { byVendor[v] = kevSeries[keys[i]] ?? []; });
      payload.spectrum.edge.cadence = kevCadence(byVendor, today);
    }
  } catch { payload.weather.tafSkill = null; payload.ops.lift = null; payload.tempo = null; }
  if (!payload.history.some((h) => h.day === today)) {
    payload.history = [...payload.history, { day: today, wx: payload.status.wx, ops: payload.status.ops, threat: payload.status.threat }].slice(-7);
  }

  cache.set(cacheKey, { payload, expires: now + TTL_MS });
  return payload;
}
