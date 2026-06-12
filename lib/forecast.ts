import { fetchWithTimeout } from "./fetchTimeout";
import type { NamedPoint } from "./severeWeather";

// Plain "what's it like out / will I get rained on" day forecast per point,
// for the Morning Brief's travel-aware weather readout. Open-Meteo (keyless,
// HTTPS) daily endpoint: one call per location, best-effort with a timeout so a
// slow point never holds the brief. Distinct from severeWeather's hazard scan
// (which is ops/aviation-threat oriented) — this is the human "78°, 60% rain".

export interface DayForecast {
  label: string;
  highF: number | null;
  lowF: number | null;
  precipChance: number | null; // %
  gustKt: number | null;
  condition: string;           // WMO code → words
  threat: string;              // "" when none
}

// WMO weather interpretation codes → short words.
const WMO: Record<number, string> = {
  0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "freezing fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "rain showers", 81: "rain showers", 82: "heavy downpours",
  85: "snow showers", 86: "heavy snow showers",
  95: "thunderstorms", 96: "thunderstorms w/ hail", 99: "severe thunderstorms",
};

// Pure summary of one location's daily fields → a DayForecast. Exported for
// unit tests (the network call is the only untested part).
export function summarizeDaily(label: string, daily: Record<string, unknown>): DayForecast {
  const at0 = (k: string): number | null => {
    const v = (daily?.[k] as unknown[])?.[0];
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  };
  const code = Number((daily?.weather_code as unknown[])?.[0]);
  const gust = at0("wind_gusts_10m_max");
  const high = at0("temperature_2m_max");
  const low = at0("temperature_2m_min");

  const threats: string[] = [];
  if (code === 95 || code === 96 || code === 99) threats.push("thunderstorms");
  if ([66, 67, 56, 57].includes(code)) threats.push("freezing rain");
  if ([71, 73, 75, 77, 85, 86].includes(code)) threats.push("snow");
  if (gust != null && gust >= 35) threats.push(`high winds ${gust}kt`);
  if (high != null && high >= 100) threats.push("extreme heat");
  if (low != null && low <= 20) threats.push("hard freeze");

  return {
    label,
    highF: high,
    lowF: low,
    precipChance: at0("precipitation_probability_max"),
    gustKt: gust,
    condition: WMO[code] ?? "—",
    threat: threats.join(", "),
  };
}

// One compact line for the brief prompt / display.
export function forecastLine(f: DayForecast): string {
  const temp = f.highF != null && f.lowF != null ? `${f.highF}°/${f.lowF}°F`
    : f.highF != null ? `${f.highF}°F` : "";
  const rain = f.precipChance != null ? `${f.precipChance}% rain` : "";
  const parts = [temp, f.condition, rain].filter(Boolean);
  const base = `${f.label}: ${parts.join(", ")}`;
  return f.threat ? `${base} — ⚠ ${f.threat}` : base;
}

export async function getDayForecasts(points: NamedPoint[]): Promise<DayForecast[]> {
  const results = await Promise.all(points.map(async (p): Promise<DayForecast | null> => {
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(4)}&longitude=${p.lon.toFixed(4)}` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,wind_gusts_10m_max` +
        `&temperature_unit=fahrenheit&wind_speed_unit=kn&timezone=auto&forecast_days=1`;
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)" } }, 8_000);
      if (!res.ok) return null;
      const d = await res.json();
      return summarizeDaily(p.label, (d?.daily ?? {}) as Record<string, unknown>);
    } catch {
      return null; // best-effort per location
    }
  }));
  return results.filter((r): r is DayForecast => r !== null);
}
