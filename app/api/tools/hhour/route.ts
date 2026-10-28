import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { getCurrentConditions, type HourlyForecast, type DailyOutlook } from "@/lib/currentConditions";
import { fetchLocationHazards } from "@/lib/severeWeather";
import { getFlightCategories } from "@/lib/aviationWx";
import { getNotams } from "@/lib/notams";
import { getTafReports } from "@/lib/aviationWx";
import { closureWindows, fieldClosureState, type ClosureWindow } from "@/lib/sitrepSignals";
import { getForceProtectionCached } from "@/lib/forceProtectionCached";
import { getCountryHolidaysLive } from "@/lib/holidays";
import { getNoaaScales } from "@/lib/spaceSources";
import { lunarNight, lunarTonightLine, zoneForLongitude, type LunarNight } from "@/lib/moon";
import { isValidTz } from "@/lib/worldClocks";
import {
  lightAt, nightDateFor, forecastHourAt, tafAt, windowsAt, scaleDayFor, summarize,
  type LightAt, type TafAt, type Consideration,
} from "@/lib/hHour";
import type { FlightCategory, TafReport } from "@/lib/types";
import type { ScaleDay } from "@/lib/spaceWeatherOps";

export const dynamic = "force-dynamic";

// H-hour considerations — the Tools tab's planner asks "what should I know
// about THIS instant at THIS place": light and moon (pure maths), the
// forecast hour (Open-Meteo, 7 d), the 30-h model hazard, the TAF period and
// NOTAM windows at H for an airfield (AWC, DAIP), the host nation's posture
// and holidays, the space-weather day. Every source bounded; a dead one is
// stated UNKNOWN in `live` and in the summary, never read as clear. The
// reading itself is lib/hHour (PURE). Cached 10 min per place + H (to the
// 10-minute step).

const HAZARD_WINDOW_H = 30;
const FORECAST_DAYS = 7;
const TTL_MS = 10 * 60 * 1000;
const HOUR_MS = 3_600_000;
const cache = new Map<string, { data: HConsiderations; expires: number }>();

export interface HConsiderations {
  hMs: number;
  place: { label: string; lat: number; lon: number; icao: string | null; country: string | null; zone: string; zoneSource: "open-meteo" | "longitude" };
  light: LightAt | null;
  night: { date: string; line: string; illumPct: number; phaseName: string; band: LunarNight["band"]; darkH: number | null; moonlitDarkH: number | null; usefulMoonH: number | null; moonFreeDarkH: number | null; eent: number | null; bmnt: number | null; sunset: number | null; sunrise: number | null; polar: boolean } | null;
  forecast: { live: boolean; hour: HourlyForecast | null; day: DailyOutlook | null; horizonDays: number };
  hazard: { severity: "severe" | "elevated"; flags: string[] } | null;
  airfield: {
    icao: string;
    metarCat: FlightCategory | null;
    metarLive: boolean;
    tafLive: boolean;
    tafIssuedAt: string | null;
    tafValidToMs: number | null;
    taf: TafAt | null;
    notamsConfigured: boolean;
    notamsLive: boolean;
    fieldClosed: boolean;
    windows: ClosureWindow[];
  } | null;
  posture: { composite: string; country: string; label: string; signal: string | null } | null;
  /** False when the watch list could not be read — posture UNKNOWN, not "unwatched". */
  postureKnown: boolean;
  holidays: { date: string; label: string }[];
  holidaysKnown: boolean;
  scaleDay: ScaleDay | null;
  scalesLive: boolean;
  summary: Consideration[];
  asOf: string;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}

// Through the shared per-ICAO TAF cache (lib/aviationWx) — the SITREP, the
// line reads and force protection fill it too (code review 2026-10-28).
async function fetchTaf(icao: string): Promise<{ live: boolean; taf: TafReport | null }> {
  const r = await getTafReports([icao]);
  const id = icao.toUpperCase();
  return { live: r.live || id in r.byIcao, taf: r.byIcao[id] ?? null };
}

const num = (v: string | null): number | null => { const n = Number(v); return v != null && v !== "" && Number.isFinite(n) ? n : null; };

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = new URL(request.url).searchParams;
  const hMs = num(q.get("at"));
  const lat = num(q.get("lat")), lon = num(q.get("lon"));
  if (hMs == null || lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return NextResponse.json({ error: "at, lat and lon are required" }, { status: 400 });
  const icaoRaw = (q.get("icao") ?? "").trim().toUpperCase();
  const icao = /^[A-Z0-9]{4}$/.test(icaoRaw) ? icaoRaw : null;
  const label = (q.get("label") ?? "").trim().slice(0, 80) || icao || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  const country = (q.get("country") ?? "").trim().slice(0, 80) || null;

  const key = `${lat.toFixed(2)},${lon.toFixed(2)}|${icao ?? ""}|${country ?? ""}|${Math.floor(hMs / 600_000)}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return NextResponse.json(hit.data);

  const now = Date.now();
  const hoursOut = (hMs - now) / HOUR_MS;
  const point = { label, lat, lon };

  const [cur, hazards, cats, tafRes, notams, prefs, holidays, scales] = await Promise.all([
    withTimeout(getCurrentConditions(lat, lon), 9_000),
    hoursOut >= 0 && hoursOut <= HAZARD_WINDOW_H ? withTimeout(fetchLocationHazards([point]), 9_000) : Promise.resolve(null),
    icao ? withTimeout(getFlightCategories([icao]), 9_000) : Promise.resolve(null),
    icao ? withTimeout(fetchTaf(icao), 11_000) : Promise.resolve(null),
    icao ? withTimeout(getNotams([icao]), 12_000) : Promise.resolve(null),
    withTimeout(getUserPrefs(), 5_000),
    country ? withTimeout(getCountryHolidaysLive(country, hMs - 86_400_000, 2), 8_000) : Promise.resolve(null),
    withTimeout(getNoaaScales(), 8_000),
  ]);

  // The place's zone: Open-Meteo's resolution, else a fixed offset from
  // longitude (sets the night's window only; times are shown in Zulu).
  const zone = cur?.timezone && isValidTz(cur.timezone) ? cur.timezone : zoneForLongitude(lon);
  const zoneSource: "open-meteo" | "longitude" = cur?.timezone && isValidTz(cur.timezone) ? "open-meteo" : "longitude";

  let light: LightAt | null = null;
  let night: HConsiderations["night"] = null;
  let nightObj: LunarNight | null = null;
  try {
    light = lightAt(hMs, lat, lon);
    nightObj = lunarNight(lat, lon, zone, nightDateFor(hMs, zone));
    night = {
      date: nightObj.date, line: lunarTonightLine(nightObj), illumPct: nightObj.illumPct, phaseName: nightObj.phaseName, band: nightObj.band,
      darkH: nightObj.darkH, moonlitDarkH: nightObj.moonlitDarkH, usefulMoonH: nightObj.usefulMoonH, moonFreeDarkH: nightObj.moonFreeDarkH,
      eent: nightObj.eent, bmnt: nightObj.bmnt, sunset: nightObj.sunset, sunrise: nightObj.sunrise, polar: nightObj.polar,
    };
  } catch { light = null; night = null; nightObj = null; }

  const hour = cur ? forecastHourAt(cur.hourly, hMs, zone) : null;
  const hYmdLocal = (() => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(hMs)); } catch { return new Date(hMs).toISOString().slice(0, 10); } })();
  const day = cur?.daily.find((d) => d.date === hYmdLocal) ?? null;

  let airfield: HConsiderations["airfield"] = null;
  if (icao) {
    const periods = tafRes?.taf?.periods ?? [];
    const validTo = periods.map((p) => Date.parse(p.to)).filter(Number.isFinite);
    const n = notams?.byIcao?.[icao] ?? [];
    const sitrepNotams = n.map((x) => ({ category: x.category, rank: x.rank, text: x.text, start: x.start, end: x.end }));
    // Windows are clamped to [now, now + horizon]; the horizon reaches past H.
    const horizonH = Math.min(14 * 24, Math.max(1, Math.ceil(hoursOut) + 2));
    const wins = hoursOut >= 0 && notams?.live ? closureWindows(sitrepNotams, now, horizonH) : [];
    airfield = {
      icao,
      metarCat: cats?.byIcao?.[icao]?.flightCategory ?? null,
      metarLive: !!cats?.live,
      tafLive: !!tafRes?.live,
      tafIssuedAt: tafRes?.taf?.issuedAt ?? null,
      tafValidToMs: validTo.length ? Math.max(...validTo) : null,
      taf: periods.length ? tafAt(periods, hMs) : null,
      notamsConfigured: notams ? notams.configured : false,
      notamsLive: !!notams?.live,
      fieldClosed: hoursOut >= 0 && !!notams?.live ? fieldClosureState(sitrepNotams, hMs, 1).now : false,
      windows: windowsAt(wins, hMs),
    };
  }

  // Posture: the base row for the ICAO, else the host country's row (posture
  // is NOW — the summary says so).
  let posture: HConsiderations["posture"] = null;
  try {
    const countries = prefs?.countriesOfInterest ?? [];
    const bases = prefs?.forceLocations ?? [];
    if (countries.length || bases.length) {
      const fp = await withTimeout(getForceProtectionCached(countries, bases), 8_000);
      const rows = fp?.assessments ?? [];
      const row = (icao ? rows.find((r) => r.icao?.toUpperCase() === icao) : undefined)
        ?? (country ? rows.find((r) => r.kind === "country" && r.country.toLowerCase() === country.toLowerCase()) ?? rows.find((r) => r.country.toLowerCase() === country.toLowerCase()) : undefined);
      if (row) {
        // The driver: the first signal of the worst category.
        const worst = [...row.categories].sort((x, y) => ["red", "amber", "unknown", "green"].indexOf(x.severity) - ["red", "amber", "unknown", "green"].indexOf(y.severity))[0];
        posture = { composite: row.composite, country: row.country, label: row.label, signal: worst?.signals?.[0] ?? null };
      }
    }
  } catch { posture = null; }

  // Holidays are local dates: compare against H's day IN THE PLACE'S ZONE.
  const hols = (holidays?.holidays ?? []).map((h) => ({ date: h.date, label: h.label })).filter((h) => Math.abs(Date.parse(`${h.date}T00:00:00Z`) - Date.parse(`${hYmdLocal}T00:00:00Z`)) <= 86_400_000);
  // Known only when the country is mapped AND the calendar answered.
  const holidaysKnown = !!country && !!holidays?.live;
  const scaleDay = scales?.live ? scaleDayFor(scales, hMs, now) : null;

  const summary = summarize({
    hMs, nowMs: now, placeLabel: label, zone, light, night: nightObj,
    forecast: { live: !!cur, hour, horizonDays: FORECAST_DAYS },
    hazard: hazards?.[0] ? { severity: hazards[0].severity, flags: hazards[0].flags } : null,
    hazardWindowH: HAZARD_WINDOW_H,
    airfield: airfield ? { icao: airfield.icao, metarCat: airfield.metarCat, tafLive: airfield.tafLive, taf: airfield.taf, tafValidToMs: airfield.tafValidToMs, notamsLive: airfield.notamsLive, notamsConfigured: airfield.notamsConfigured, fieldClosed: airfield.fieldClosed, windows: airfield.windows } : null,
    posture: posture ? { composite: posture.composite, country: posture.country, signal: posture.signal } : null,
    postureKnown: !!prefs,
    holidays: hols, holidaysKnown,
    scaleDay, scalesLive: !!scales?.live,
  });

  const data: HConsiderations = {
    hMs,
    place: { label, lat, lon, icao, country, zone, zoneSource },
    light, night,
    forecast: { live: !!cur, hour, day, horizonDays: FORECAST_DAYS },
    hazard: hazards?.[0] ? { severity: hazards[0].severity, flags: hazards[0].flags } : null,
    airfield, posture, postureKnown: !!prefs,
    holidays: hols, holidaysKnown,
    scaleDay, scalesLive: !!scales?.live,
    summary,
    asOf: new Date(now).toISOString(),
  };
  if (cur || airfield?.tafLive) cache.set(key, { data, expires: now + TTL_MS });
  return NextResponse.json(data);
}
