import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { getWeatherThreats, type NamedPoint } from "@/lib/severeWeather";
import type { WeatherThreats } from "@/lib/types";
import { getTrackingRegistry } from "@/lib/trackingOps";

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
  // The airfields the operator tracks (posture bases, SITREP bases, hub and
  // spokes) join the scan — REVIEW-2026-10 W6: the 30-h hazard scan and the
  // "near …" tags used to see only home and the civil places, so no base
  // ever got a hazard row on this tab. Labelled by ICAO so a row keys
  // straight to the airfield card.
  try {
    const reg = await getTrackingRegistry();
    const seen = new Set(locations.map((l) => `${l.lat.toFixed(2)},${l.lon.toFixed(2)}`));
    for (const a of reg.airfields) {
      if (!a.icao || (!a.lat && !a.lon)) continue;
      const k = `${a.lat.toFixed(2)},${a.lon.toFixed(2)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      locations.push({ label: a.icao, lat: a.lat, lon: a.lon });
    }
  } catch { /* registry unavailable → scan the civil points only */ }

  try {
    const data = await getWeatherThreats(locations);
    cache = { data, expires: Date.now() + TTL_MS };
    return NextResponse.json(data);
  } catch (err) {
    console.error("Weather threats fetch failed:", err);
    return NextResponse.json({ threats: [], tropical: [], disasters: [], hazards: [], summary: { extreme: 0, severe: 0, lifeThreatening: 0, total: 0, topEvent: null, disasters: 0, disastersRed: 0, hazardLocations: 0 } });
  }
}
