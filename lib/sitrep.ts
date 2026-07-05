// SITREP assembler — the commander's situation report for one operating
// location (OSINT tab → SITREP pane). SERVER-ONLY: composes existing keyless
// sources (AWC METAR/TAF, NWS alerts, Open-Meteo, DAIP NOTAMs, OurAirports,
// Force Protection fusion, GDELT local news) around a single base. Every
// section is best-effort and reports its own liveness — a source that can't
// be reached shows UNKNOWN, never an implied "all clear".

import type { SitrepBase, TafReport, MetarObs } from "./types";
import { getFlightCategories, getTafOutlook, type AviationWx, type TafOutlook } from "./aviationWx";
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
import { classifyAor } from "./aor";
import {
  groupNotams, filterImpactNews, tafTimeline, wxLed, opsLed, threatLed, runwayWinds,
  type NotamGroup, type TafSegment, type Led, type RunwayWind,
} from "./sitrepSignals";
import { astroData, type AstroData } from "./astro";
import { recordSitrepDay, getSitrepHistory, type SitrepDay } from "./sitrepHistory";

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

export interface SitrepPayload {
  base: SitrepBase;
  generatedAt: string;
  status: { wx: Led; ops: Led; threat: Led; infra: Led };
  weather: {
    live: boolean;
    now: AviationWx | null;
    metarRaw: string | null;
    tafWorst: TafOutlook | null;
    tafSegments: TafSegment[];
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
    // System fuel NOTAMs referencing this ICAO (DAIP FUEL_NOTAMS).
    fuel: { live: boolean; items: string[] } | null;
  };
  // Worst LED per axis per UTC day, oldest→newest (≤7 rows incl. today).
  history: SitrepDay[];
  threats: {
    fp: { composite: string; topDriver: string; axes: { key: string; severity: string; summary: string }[] } | null;
    disasters: { title: string; type: string; severity: string; km: number }[];
    news: { title: string; link: string; matched: string[] }[];
    newsScanned: number;
  };
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { payload: SitrepPayload; expires: number }>();

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

  const [cats, tafOutlook, rawWx, notams, caps, alerts, current, outlook, disasters, fpResult, newsRaw] =
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
    ]);

  const [runways, fuelRes, historyRows] = await Promise.all([
    airfieldRunways(icao).catch(() => []),
    getFuelNotams().catch(() => null),
    getSitrepHistory(icao, 7).catch(() => [] as SitrepDay[]),
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

  const severeAlert = sitAlerts.some((a) => a.lifeThreatening || a.severity === "Extreme");
  const payload: SitrepPayload = {
    base,
    generatedAt: new Date(now).toISOString(),
    status: {
      wx: wxLed(nowWx?.flightCategory ?? null, tafWorst?.worst ?? null, sitAlerts.length, severeAlert),
      ops: opsLed(notams.configured, notams.live, limiting, fieldClosed),
      threat: threatLed(fp?.composite ?? null),
      infra: "u", // v2 — IODA / USGS / power sources pending live verification
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
    threats: {
      fp,
      disasters: nearDisasters,
      news: impactNews,
      newsScanned: newsRaw.length,
    },
  };

  // Persist today's worst-per-axis LEDs (fire-and-forget) and reflect today
  // in the history strip immediately.
  recordSitrepDay(icao, payload.status).catch(() => {});
  const today = new Date(now).toISOString().slice(0, 10);
  if (!payload.history.some((h) => h.day === today)) {
    payload.history = [...payload.history, { day: today, wx: payload.status.wx, ops: payload.status.ops, threat: payload.status.threat }].slice(-7);
  }

  cache.set(cacheKey, { payload, expires: now + TTL_MS });
  return payload;
}
