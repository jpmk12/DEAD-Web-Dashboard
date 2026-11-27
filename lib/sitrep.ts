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
import { getFieldProfile, getPireps } from "./fieldWx";
import { getSigmets } from "./mapHazards";
import { readIcing, type IcingRead } from "./icingSignals";
import { crosswindOutlook, type XwindOutlook } from "./crosswind";
import { readTurbulence, type TurbulenceRead } from "./turbulence";
import { fieldOutlook, type FieldOutlook } from "./fieldOutlook";
import { opsTimeline, planView, windowBand, type OpsTimeline, type WindowBand } from "./opsTimeline";
import { parseTafHazards } from "./tafGroups";
import { withTimeout } from "./withTimeout";
import { getNotams, notamTimeState, type Notam } from "./notams";
import { airfieldCapabilities, airfieldRunways, type RunwayCap } from "./ourAirports";
import { aggregateThreats } from "./severeWeather";
import { getCurrentConditions, type CurrentConditions } from "./currentConditions";
import { getDisasters, haversineKm } from "./disasters";
import { getForceProtection } from "./forceProtection";
import { gdeltLocalNewsLive } from "./localNews";
import { getCenterNotams, getFuelNotams, getGpsNotams } from "./airspace";
import { gpsNotamsForField, fuelNotamsForField, type FieldGpsNotam } from "./gpsNotams";
import { firsForCountry } from "./firData";
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
import { deriveMissionImpact, upcomingClosureLine, type MissionImpact } from "./limfac";
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
import { closureWindows, timelineClosures, type FieldClosure } from "./sitrepSignals";
import { baseTempo, type BaseTempo } from "./baseTempo";
import { functionChronicity, timeToResolve } from "./limfacTrend";
import { kevCadence, type KevCadence } from "./spectrumTrend";
import type { ManualLimfac } from "./limfac";
import { sensorKey } from "./sensorKeys";
import { catOrdinal, tafVerification, type TafSkill } from "./tafVerify";
import { bestBaseline, highWater, type SeriesPoint } from "./series";
import { getPostureMoves } from "./postureMovesAssemble";
import type { FieldChatter } from "./mobilityChatter";

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
  pnt: {
    live: boolean; date: string; cellLevel: number; raim: string[];
    /** DAIP GPS_WAAS NOTAMs at this field by geometry (lib/gpsNotams).
     *  live:false = the DAIP read did not answer → UNKNOWN, never "none".
     *  Absent on assemblies older than 2026-11-04. */
    notams?: { live: boolean; items: FieldGpsNotam[]; prns: number[]; affecting: number };
  };
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
    /** Icing at the field and on approach (lib/icingSignals) — absent on older payloads. */
    icing?: IcingRead | null;
    /** Crosswind on the best runway, now and across the TAF / model 24 h (lib/crosswind). */
    crosswind?: XwindOutlook | null;
    /** Turbulence and wind shear at the field and on approach (lib/turbulence) — absent on older payloads. */
    turbulence?: TurbulenceRead | null;
    /** 72-h outlook in 6-h Zulu blocks (lib/fieldOutlook) — absent on older payloads. */
    outlook72?: FieldOutlook | null;
    /** 72-h ops timeline: hourly lanes + limiting windows (lib/opsTimeline) — absent on older payloads. Never moves the LED. */
    timeline72?: OpsTimeline | null;
  };
  astro: AstroData;
  ops: {
    configured: boolean;   // DAIP CA present
    live: boolean;         // DAIP fetch succeeded
    notamCount: number;
    groups: NotamGroup[];
    limiting: boolean;
    /** The airfield is closed NOW (an AD-CLSD NOTAM in effect at generation). */
    fieldClosed: boolean;
    /** Airfield closure — now / next scheduled window / unreadable schedule (`fieldClosureState`). */
    closure: FieldClosure;
    /** Runways at the field per OurAirports (0 = unknown) — a closure of the only one is NMC, not single-runway ops. */
    runwayCount: number;
    capability: RunwayCap | null;
    // Enroute/center NOTAM picture for the owning ARTCC (base.artcc), when set.
    center: { code: string; live: boolean; count: number; items: { text: string; amber: boolean }[] } | null;
    // Crosswind/headwind per runway end from the current METAR (advisory).
    runwayWinds: RunwayWind[];
    /** Lift at this field vs its own normal (PLAN §5 C2) — only when the field
     *  is a hub on an I&W board and the ADS-B series exists. */
    lift?: LiftRead | null;
    /** Lift chatter naming THIS field in the user's own sources, last 72 h
     *  (lib/mobilityChatter chatterForIcao via the posture-moves sweep).
     *  Null = no post named it, or the sweep was cold this pass — reported,
     *  never observed; it sits beside the ADS-B row and never replaces it. */
    liftChatter?: FieldChatter | null;
    // System fuel NOTAMs referencing this ICAO (DAIP FUEL_NOTAMS).
    fuel: { live: boolean; items: string[]; more?: number } | null;
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
    /** false when GDELT did not answer (or not within the bound) — the list is
     *  UNKNOWN, never "nothing impact-relevant". Absent on older payloads. */
    newsLive?: boolean;
  };
  spectrum: SitrepSpectrum;
  /** Slow reads that did not answer within the assembly's bound this pass
   *  (posture, local news, infrastructure, disasters). Each reads UNKNOWN on
   *  its card; the payload is cached briefly so the next open fills it in. */
  partial?: string[];
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
  /** The 72-h limiting windows (weather + NOTAM closures) as a band for the airfield cards; absent on older payloads. */
  band72?: WindowBand | null;
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
  const ice = p.weather.icing ?? null;
  const xwo = p.weather.crosswind ?? null;
  const iceShort = ice && (ice.level === "r" || ice.level === "a") ? (ice.level === "r" ? "ICING" : "icing risk") : "";
  const turb = p.weather.turbulence ?? null;
  const turbShort = turb && (turb.level === "r" || turb.level === "a") ? (turb.level === "r" ? "TURB / SHEAR" : "turbulence risk") : "";
  const xwShort = xwo && (xwo.level === "r" || xwo.level === "a") && xwo.peak?.best ? `xwind ${xwo.peak.best.crossKt}${xwo.peak.best.gustCrossKt ? `G${xwo.peak.best.gustCrossKt}` : ""}kt` : "";
  const wxShort = [cat
    ? `${cat}${tafWorst && tafWorst !== cat ? ` → ${tafWorst} fcst` : ""}`
    : "no METAR", iceShort, turbShort, xwShort].filter(Boolean).join(" · ");
  const limitingNotam = p.ops.groups.flatMap((g) => g.items).find((n) => n.amber);
  const opsShort = p.ops.fieldClosed ? "FIELD CLOSED (NOTAM)"
    : p.ops.closure?.next ? `field closure scheduled ${p.ops.closure.next}`
    : p.mission?.upcoming ? upcomingClosureLine(p.mission.upcoming)
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
    : p.ops.closure?.next ? `Field open now, closure scheduled ${p.ops.closure.next}`
    : p.mission?.upcoming ? `Field open now; ${upcomingClosureLine(p.mission.upcoming)}`
    : p.ops.limiting ? `Field open with a limiting NOTAM${limitingNotam ? ` — ${limitingNotam.text.slice(0, 60)}` : ""}`
    : p.ops.configured && p.ops.live ? `Field open, ${p.ops.notamCount} NOTAMs (none limiting)`
    : "Airfield status UNKNOWN (DAIP unreachable)";
  const tafFrom = p.weather.tafWorst?.fromISO ? ` after ${p.weather.tafWorst.fromISO.slice(11, 16)}Z` : "";
  const wxClause = cat
    ? `${cat} now${tafWorst && tafWorst !== cat && CAT_RANK[tafWorst] > CAT_RANK[cat] ? `, TAF drops ${tafWorst}${tafFrom}` : ""}`
    : "no current METAR";
  // Crosswind on the BEST runway (a field with an aligned runway is not limited
  // by its other one); the old any-end rule only when no outlook was built.
  const xw = xwo ? null : p.ops.runwayWinds.find((r) => r.flag !== "g");
  const xwClause = xwo && (xwo.level === "a" || xwo.level === "r") ? `; ${xwo.summary.charAt(0).toLowerCase()}${xwo.summary.slice(1)}`
    : xw ? `; crosswind advisory RWY ${xw.ident} (${xw.crossKt}kt${xw.gustCrossKt ? ` G${xw.gustCrossKt}` : ""})` : "";
  const iceClause = ice && (ice.level === "r" || ice.level === "a") ? ` Icing: ${ice.summary.length > 160 ? `${ice.summary.slice(0, 159)}…` : ice.summary}.` : "";
  const turbClause = turb && (turb.level === "r" || turb.level === "a") ? ` Turbulence: ${turb.summary.length > 160 ? `${turb.summary.slice(0, 159)}…` : turb.summary}.` : "";
  const line = `${fieldClause}; ${wxClause}. ${infraShort.charAt(0).toUpperCase()}${infraShort.slice(1)}${xwClause}.${iceClause}${turbClause}`;

  return {
    icao: p.base.icao, label: p.base.label,
    // Older bases carry ISO2 ("DE") — normalise so the board keys one country.
    country: normalizeCountryName(p.base.country) || "",
    aor: classifyAor({ lat: p.base.lat, lon: p.base.lon, name: normalizeCountryName(p.base.country) }),
    status: p.status, driver, line, worse: [...worse],
    band72: p.weather.timeline72
      ? (() => {
          const v = planView(p.weather.timeline72, timelineClosures(p.ops.groups.flatMap((g) => g.items), Date.parse(p.generatedAt), 72));
          return windowBand(p.weather.timeline72, v.windows, v);
        })()
      : null,
  };
}

/** All-UNKNOWN summary for a base whose assembly failed — a missing tile would
 *  read as "fine". Shared by the summary route, the heartbeat and the command
 *  board so every surface degrades the same way. */
/** All-UNKNOWN summary for a base still ASSEMBLING (not failed) — the strip
 *  says so instead of "assembly failed" while the first read is in flight. */
export function sitrepPendingStub(base: SitrepBase): SitrepSummary {
  return { ...sitrepStub(base), driver: "assembling — UNKNOWN until it lands", line: `${base.icao} is still assembling — status UNKNOWN, not clear.` };
}

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
/** A payload with a slow read missing is kept only this long — the read keeps
 *  running into its own cache, so the next open is whole. */
const PARTIAL_TTL_MS = 30 * 1000;
/** The bound on the four slow, non-weather reads of an assembly. */
export const SLOW_READ_MS = 12_000;
const cache = new Map<string, { payload: SitrepPayload; expires: number }>();

/** Lift at a hub against its own normal — null when the field has no series. */
export function liftRead(series: SeriesPoint[], today: string, tankers: SeriesPoint[] = []): LiftRead | null {
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
  // Tankers beside the airlift (the `tanker:` series was written and never
  // read — code review 2026-10-28). Their own normal once one exists.
  const tToday = tankers.find((p) => p.day === today)?.value ?? null;
  if (tToday != null) {
    const tb = bestBaseline(tankers, today, 30);
    label += ` · tankers ${tToday}${tb.mean != null ? ` vs ~${tb.mean.toFixed(0)}` : ""}`;
  }
  return { today: todayV, normal: b.mean, kind: b.kind, samples: b.samples, high: hw.isHigh, label };
}

export function resetSitrepCache(): void {
  cache.clear();
  sitrepInflight.clear();
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

// One assembly per base at a time — summary, commands, the brief, line reads,
// Ask and the heartbeat ask for the same base together (code review
// 2026-10-28: each ran its own ~20-call fan-out).
const sitrepInflight = new Map<string, Promise<SitrepPayload>>();

export async function assembleSitrep(base: SitrepBase): Promise<SitrepPayload> {
  // Key includes the ARTCC so setting/changing the center via the inline
  // editor takes effect immediately instead of waiting out the TTL.
  const cacheKey = `${base.icao}|${base.artcc ?? ""}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.payload;
  const running = sitrepInflight.get(cacheKey);
  if (running) return running;
  const p = assembleSitrepOnce(base, cacheKey).finally(() => { if (sitrepInflight.get(cacheKey) === p) sitrepInflight.delete(cacheKey); });
  sitrepInflight.set(cacheKey, p);
  return p;
}

async function assembleSitrepOnce(base: SitrepBase, cacheKey: string): Promise<SitrepPayload> {

  const icao = base.icao.toUpperCase();
  const now = Date.now();

  // Every source starts AT ONCE (2026-11-24, "the SITREP should load
  // faster"): the second group never depended on the first, and running them
  // one after the other made a cold base the SUM of its two slowest reads.
  // The four slow, non-weather reads are BOUNDED (`SLOW_READ_MS`): past the
  // bound the read is named in `partial`, reads UNKNOWN on its card, and the
  // payload is cached briefly so the next open — when the read has landed in
  // its own cache — fills it in. Weather, NOTAMs and runways are not bounded
  // here; each carries its own fetch timeout and they are what a SITREP is for.
  const partial: string[] = [];
  const slow = <T,>(p: Promise<T>, name: string): Promise<T | null> =>
    withTimeout(p, SLOW_READ_MS).then((v) => { if (v == null) partial.push(name); return v; });
  const postureMovesP = getPostureMoves(3_000).catch(() => null);
  const centerP = base.artcc ? getCenterNotams(base.artcc).catch(() => null) : Promise.resolve(null);
  const groupB = Promise.all([
    airfieldRunways(icao).catch(() => []),
    getFuelNotams().catch(() => null),
    getGpsNotams().catch(() => null),
    getSitrepHistory(icao, 7).catch(() => [] as SitrepDay[]),
    listLimfacs(icao).catch(() => []),
    getGpsInterference().catch(() => ({ ok: false, hexes: [], date: "" })),
    getNoaaScales().catch(() => ({ live: false, now: { date: "", R: null, S: null, G: null }, outlook: [] })),
    getKev().catch(() => ({ live: false, entries: [] })),
    getMissionProfile().catch(() => null),
    getFieldProfile(base.lat, base.lon).catch(() => null),
    getPireps(icao).catch(() => null),
    withTimeout(getSigmets(), 12_000),
  ] as const);

  const [cats, tafOutlook, rawWx, notams, caps, alerts, current, outlook, disastersRead, fpResult, newsRead, infraRead] =
    await Promise.all([
      getFlightCategories([icao]).catch(() => ({ live: false, byIcao: {} as Record<string, AviationWx> })),
      getTafOutlook([icao], 24).catch(() => ({} as Record<string, TafOutlook>)),
      fetchRawWx(icao),
      getNotams([icao]).catch(() => ({ configured: false, live: false, byIcao: {} as Record<string, Notam[]> })),
      airfieldCapabilities([icao]).catch(() => ({} as Record<string, RunwayCap>)),
      aggregateThreats([{ label: base.label, lat: base.lat, lon: base.lon }]).catch(() => []),
      getCurrentConditions(base.lat, base.lon).catch(() => null),
      fetchOutlook(base.lat, base.lon),
      slow(getDisasters(), "disasters"),
      slow(getForceProtection([], [{
        id: `sitrep-${icao}`,
        label: base.label,
        icao,
        lat: base.lat,
        lon: base.lon,
        country: base.country || "United States",
        cocom: classifyAor({ lat: base.lat, lon: base.lon, name: base.country }),
        kind: "base" as const,
      }], { record: false }), "force posture"),
      slow(gdeltLocalNewsLive(base.place || base.label), "local news"),
      slow(getInfraSources(base), "infrastructure"),
    ]);
  const disasters = disastersRead ?? [];
  const newsRaw = newsRead?.items ?? [];
  const newsLive = !!newsRead?.live;
  const infraSources: SitrepInfra = infraRead ?? { internet: { live: false, entity: null, led: "u", series: [] }, water: null, nas: null };

  const [runways, fuelRes, gpsRes, historyRows, manualLimfacs, gps, scales, kev, profile, fieldProfile, pirepRes, sigmetRes] = await groupB;

  // Center (ARTCC) enroute NOTAMs — the "what's between us and everywhere
  // else" layer the user's ops summary needs (KWRI → ZNY). Optional per base.
  let center: SitrepPayload["ops"]["center"] = null;
  if (base.artcc) {
    const c = await centerP;
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
  const { groups, limiting, fieldClosed, closure } = groupNotams(baseNotams, now);

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

  // Icing at the field and on approach, then the crosswind outlook on the
  // best runway — freezing / frozen precipitation from the icing read is the
  // crosswind's contamination input (lib/icingSignals, lib/crosswind).
  const icing = readIcing({
    nowMs: now,
    field: { lat: base.lat, lon: base.lon },
    metar: obs,
    taf: rawWx.taf?.periods ?? null,
    tafRaw: rawWx.taf?.raw ?? null,
    tafIssued: rawWx.taf?.issuedAt || null,
    icao,
    profile: fieldProfile,
    sigmets: sigmetRes ? { live: sigmetRes.live, items: sigmetRes.sigmets } : null,
    pireps: pirepRes ? { live: pirepRes.live, items: pirepRes.items } : null,
  });
  const tafHazards = rawWx.taf ? parseTafHazards(rawWx.taf.raw, rawWx.taf.issuedAt || null, now) : null;
  const turbulence = readTurbulence({
    nowMs: now,
    field: { lat: base.lat, lon: base.lon },
    icao,
    elevFt: icing.elevFt,
    metar: obs ? { windSpeedKt: obs.windSpeedKt ?? null, windGustKt: obs.windGustKt ?? null, raw: obs.raw ?? "" } : null,
    taf: rawWx.taf?.periods ?? null,
    hazards: tafHazards,
    sigmets: sigmetRes ? { live: sigmetRes.live, items: sigmetRes.sigmets } : null,
    pireps: pirepRes ? { live: pirepRes.live, items: pirepRes.items } : null,
  });
  const outlook72 = fieldOutlook({ nowMs: now, lon: base.lon, hours: fieldProfile?.live ? fieldProfile.hours : null, taf: rawWx.taf?.periods ?? null });
  const timeline72 = opsTimeline({
    nowMs: now, lat: base.lat, lon: base.lon,
    elevationM: fieldProfile?.elevationM ?? null,
    hours: fieldProfile?.live ? fieldProfile.hours : null,
    taf: rawWx.taf?.periods ?? null,
    tafGroups: tafHazards?.groups ?? null,
    runways,
  });
  const crosswind = crosswindOutlook({
    nowMs: now,
    runways,
    metar: obs ? { windDir: obs.windDir, windVariable: obs.windVariable, windSpeedKt: obs.windSpeedKt ?? nowWx?.windKt ?? null, windGustKt: obs.windGustKt ?? nowWx?.gustKt ?? null } : null,
    taf: rawWx.taf?.periods ?? null,
    model: fieldProfile?.live ? fieldProfile.hours.map((h) => ({ t: h.t, windDir: h.windDir, windKt: h.windKt, gustKt: h.gustKt })) : null,
    contamination: icing.contaminationWindows,
  });
  // The weather LED earns colour from icing and crosswind too; their own
  // UNKNOWN is said on their rows and never greys a live METAR's LED.
  const wxBase = wxLed(nowWx?.flightCategory ?? null, tafWorst?.worst ?? null, sitAlerts.length, severeAlert);
  // Only amber / red raise it — a green or UNKNOWN icing / crosswind read
  // never changes what the METAR and TAF said.
  const raise = (acc: Led, l: Led): Led => ((l === "a" || l === "r") && LED_RANK[l] > LED_RANK[acc] ? l : acc);
  const wxStatus = raise(raise(raise(wxBase, icing.level), crosswind.level), turbulence.level);

  // ── Spectrum at the field ──
  const spec = profile?.spectrum ?? { polarRoutes: false, satcom: "", edgeVendors: [], spaceActivity: true };
  const raim = baseNotams.filter((n) => n.category === "gps_raim").map((n) => n.text.slice(0, 160));
  // GPS / WAAS system NOTAMs that reach THIS field — by the test disk or area
  // geometry, else by the FIR / ARTCC the notice was published under.
  const gpsCodes = [
    ...(base.artcc ? [base.artcc.toUpperCase(), `K${base.artcc.toUpperCase()}`] : []),
    ...firsForCountry(base.country || "").map((f) => f.code),
  ];
  const gpsLive = Boolean(gpsRes && gpsRes.configured && gpsRes.live);
  const gpsRead = gpsLive
    ? gpsNotamsForField(gpsRes!.groups.flatMap((g) => g.notams), { lat: base.lat, lon: base.lon, icao, codes: gpsCodes }, now)
    : { items: [], prns: [], affecting: 0 };
  const cellLevel = gps.ok ? gpsLevelAt(base.lat, base.lon, gps.hexes) : 0;
  const impacts = spaceWeatherImpacts(scales, { polar: spec.polarRoutes });
  const hits = kev.live ? kevHits(kev.entries, spec.edgeVendors, now, 14) : [];
  const edgeLed = edgeExposureLed(hits, spec.edgeVendors.length > 0, kev.live);
  const spectrum: SitrepSpectrum = {
    pnt: { live: gps.ok, date: gps.date, cellLevel, raim, notams: { live: gpsLive, ...gpsRead } },
    spaceWx: { live: scales.live, now: scales.live ? scales.now : null, outlook: scales.outlook, impacts, polar: spec.polarRoutes, satcom: spec.satcom },
    edge: {
      declared: spec.edgeVendors.length > 0, live: kev.live, vendors: spec.edgeVendors,
      hits: hits.map((h) => ({ cve: h.entry.cveID, vendor: h.vendor, product: h.entry.product, name: h.entry.vulnerabilityName, dateAdded: h.entry.dateAdded, ransomware: h.entry.knownRansomwareCampaignUse })),
    },
  };
  const spectrumStatus = spectrumLed({ pntLive: gps.ok, cellLevel, raimCount: raim.length, gpsNotamCount: gpsRead.affecting, spaceWx: spaceWxLed(scales, { polar: spec.polarRoutes }), edge: edgeLed });

  const payload: SitrepPayload = {
    base,
    generatedAt: new Date(now).toISOString(),
    status: {
      wx: wxStatus,
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
      icing,
      crosswind,
      turbulence,
      outlook72,
      timeline72,
    },
    astro: astroData(base.lat, base.lon, now),
    ops: {
      configured: notams.configured,
      live: notams.live,
      notamCount: baseNotams.length,
      groups,
      limiting,
      fieldClosed,
      closure,
      runwayCount: new Set(runways.map((r) => r.pair)).size,
      capability: caps[icao] ?? null,
      center,
      runwayWinds: runwayWinds(runways, obs?.windDir ?? null, Boolean(obs?.windVariable), obs?.windSpeedKt ?? nowWx?.windKt ?? null, obs?.windGustKt ?? nowWx?.gustKt ?? null),
      fuel: fuelRes
        ? {
            live: fuelRes.configured && fuelRes.live,
            ...(() => {
              const all = fuelNotamsForField(fuelRes.groups.flatMap((g) => g.notams), icao);
              return { items: all.slice(0, 6), more: Math.max(0, all.length - 6) };
            })(),
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
      newsLive,
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
    const [fcSeries, tafSeries, liftSeries, tankerSeries, notamSeries, rwySeries, xwSeries, limfacSeries, allManual] = await Promise.all([
      getSensorSeries(fcKey, 90), getSensorSeries(tafKey, 90), getSensorSeries(sensorKey("mob", icao), 90), getSensorSeries(sensorKey("tanker", icao), 90),
      getSensorSeries(sensorKey("notam", icao), 60), getSensorSeries(sensorKey("rwyclose", icao), 60), getSensorSeries(sensorKey("xwind", icao), 60),
      getSensorSeriesMany(limfacKeys, 30), listLimfacs(icao, true).catch(() => [] as ManualLimfac[]),
    ]);
    payload.weather.tafSkill = tafVerification(fcSeries, tafSeries);
    payload.ops.lift = liftRead(liftSeries, today, tankerSeries);
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
  // Lift chatter naming this field from the own-source sweep (15-min cached
  // elsewhere; bounded here — a cold sweep reads null, never "no chatter").
  {
    const pm = await postureMovesP;
    payload.ops.liftChatter = !pm || pm.pending ? null : pm.fieldChatter?.[icao.toUpperCase()] ?? null;
  }
  if (!payload.history.some((h) => h.day === today)) {
    payload.history = [...payload.history, { day: today, wx: payload.status.wx, ops: payload.status.ops, threat: payload.status.threat }].slice(-7);
  }

  if (partial.length) payload.partial = partial;
  cache.set(cacheKey, { payload, expires: now + (partial.length ? PARTIAL_TTL_MS : TTL_MS) });
  return payload;
}
