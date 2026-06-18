// Current conditions + today's sun times for the Weather tab cards, via
// Open-Meteo (keyless, HTTPS, GLOBAL). NWS gives the nicely-worded named periods
// but is US-only and carries no feels-like / humidity / sun times on the forecast
// endpoint; Open-Meteo fills those in and — because it's worldwide — lets the
// cards show *something* OCONUS where NWS returns nothing.
//
// One call per location (current + today's daily). Pure parser (parseCurrent) is
// unit-tested; the fetch is best-effort and fail-safe (null → the card just omits
// the enrichment, never shows a fake value).

import { fetchWithTimeout } from "./fetchTimeout";

export interface CurrentConditions {
  tempF: number | null;
  feelsLikeF: number | null;
  humidityPct: number | null;
  windMph: number | null;
  windDir: number | null;       // degrees
  gustMph: number | null;
  weatherCode: number | null;   // WMO code
  isDay: boolean;
  highF: number | null;
  lowF: number | null;
  precipChancePct: number | null;
  sunrise: string | null;       // local ISO ("2026-06-17T05:42")
  sunset: string | null;
}

const round = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

// PURE: Open-Meteo current+daily JSON → CurrentConditions. Exported for tests.
export function parseCurrent(json: unknown): CurrentConditions | null {
  const cur = (json as { current?: Record<string, unknown> })?.current;
  const daily = (json as { daily?: Record<string, unknown> })?.daily;
  if (!cur && !daily) return null;
  const d0 = (k: string): unknown => (daily?.[k] as unknown[] | undefined)?.[0];
  const dayFlag = cur?.is_day;
  return {
    tempF: round(cur?.temperature_2m),
    feelsLikeF: round(cur?.apparent_temperature),
    humidityPct: round(cur?.relative_humidity_2m),
    windMph: round(cur?.wind_speed_10m),
    windDir: round(cur?.wind_direction_10m),
    gustMph: round(cur?.wind_gusts_10m),
    weatherCode: cur?.weather_code != null ? round(cur.weather_code) : (d0("weather_code") != null ? round(d0("weather_code")) : null),
    isDay: dayFlag == null ? true : Number(dayFlag) === 1,
    highF: round(d0("temperature_2m_max")),
    lowF: round(d0("temperature_2m_min")),
    precipChancePct: d0("precipitation_probability_max") != null ? round(d0("precipitation_probability_max")) : null,
    sunrise: typeof d0("sunrise") === "string" ? (d0("sunrise") as string) : null,
    sunset: typeof d0("sunset") === "string" ? (d0("sunset") as string) : null,
  };
}

export async function getCurrentConditions(lat: number, lon: number): Promise<CurrentConditions | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
      `&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1`;
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)" } }, 8_000);
    if (!res.ok) return null;
    return parseCurrent(await res.json());
  } catch {
    return null; // best-effort — card omits enrichment on failure
  }
}
