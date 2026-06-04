import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { getWeatherThreats, type NamedPoint } from "@/lib/severeWeather";
import type { WeatherThreats } from "@/lib/types";

export const dynamic = "force-dynamic";

// Aggregated severe-weather picture for the user's locations (home +
// tracked) plus active tropical systems. Single server-side endpoint so the
// Weather tab, Glance, and the morning brief all share one cached read.
const TTL_MS = 3 * 60 * 1000;
let cache: { data: WeatherThreats; expires: number } | null = null;

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (cache && cache.expires > Date.now()) {
    return NextResponse.json(cache.data);
  }

  const prefs = await getUserPrefs().catch(() => null);
  const locations: NamedPoint[] = [];
  if (prefs?.localLat != null && prefs?.localLon != null) {
    locations.push({ label: prefs.localCity || "Home", lat: prefs.localLat, lon: prefs.localLon });
  }
  for (const t of prefs?.trackedLocations ?? []) {
    locations.push({ label: t.label, lat: t.lat, lon: t.lon });
  }

  try {
    const data = await getWeatherThreats(locations);
    cache = { data, expires: Date.now() + TTL_MS };
    return NextResponse.json(data);
  } catch (err) {
    console.error("Weather threats fetch failed:", err);
    return NextResponse.json({ threats: [], tropical: [], disasters: [], hazards: [], summary: { extreme: 0, severe: 0, lifeThreatening: 0, total: 0, topEvent: null, disasters: 0, disastersRed: 0, hazardLocations: 0 } });
  }
}
