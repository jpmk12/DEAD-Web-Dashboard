import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ForecastPeriod } from "@/lib/types";

export const dynamic = "force-dynamic";

// NWS gridpoint forecast for a given lat/lon. Two calls:
//   1. /points/{lat},{lon} → returns the gridpoint forecast URL
//   2. GET that forecast URL → returns 7-day forecast periods
// Cached briefly server-side so multi-location dashboard rendering doesn't
// hammer NWS on every refresh.
const TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { data: ForecastPeriod[]; expires: number }>();

interface NwsPeriod {
  name?: string;
  startTime?: string;
  isDaytime?: boolean;
  temperature?: number;
  temperatureTrend?: string | null;
  windSpeed?: string;
  windDirection?: string;
  shortForecast?: string;
  icon?: string;
  probabilityOfPrecipitation?: { value?: number | null };
}

async function fetchForecast(lat: number, lon: number): Promise<ForecastPeriod[]> {
  const headers = {
    "User-Agent": "DEAD-Dashboard (https://github.com/jpmk12/dead-web-dashboard)",
    Accept: "application/geo+json",
  };

  const pointsRes = await fetch(
    `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
    { headers, cache: "no-store" }
  );
  if (!pointsRes.ok) throw new Error(`points: ${pointsRes.status}`);
  const points = await pointsRes.json();
  const forecastUrl = points?.properties?.forecast;
  if (typeof forecastUrl !== "string") throw new Error("no forecast URL");

  const forecastRes = await fetch(forecastUrl, { headers, cache: "no-store" });
  if (!forecastRes.ok) throw new Error(`forecast: ${forecastRes.status}`);
  const forecast = await forecastRes.json();
  const periods: NwsPeriod[] = forecast?.properties?.periods ?? [];
  return periods.slice(0, 8).map((p) => ({
    name: String(p.name ?? ""),
    startTime: String(p.startTime ?? ""),
    isDaytime: Boolean(p.isDaytime),
    tempF: Number(p.temperature ?? 0),
    tempTrend: p.temperatureTrend ?? null,
    windSpeed: String(p.windSpeed ?? ""),
    windDirection: String(p.windDirection ?? ""),
    shortForecast: String(p.shortForecast ?? ""),
    icon: String(p.icon ?? ""),
    precipPercent: typeof p.probabilityOfPrecipitation?.value === "number"
      ? p.probabilityOfPrecipitation.value : null,
  }));
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat and lon are required" }, { status: 400 });
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: "coords out of range" }, { status: 400 });
  }

  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    return NextResponse.json({ periods: hit.data, cached: true });
  }

  try {
    const periods = await fetchForecast(lat, lon);
    cache.set(key, { data: periods, expires: Date.now() + TTL_MS });
    if (cache.size > 100) {
      const now = Date.now();
      for (const [k, v] of cache) if (v.expires < now) cache.delete(k);
    }
    return NextResponse.json({ periods });
  } catch (err) {
    console.error("Weather forecast fetch failed:", err);
    // NWS covers US territory only. Quietly return empty for OCONUS.
    return NextResponse.json({ periods: [], error: "Forecast unavailable for this location" });
  }
}
