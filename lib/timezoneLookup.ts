// Server-only: the IANA zone for a point on the map, and the lazy backfill
// of `trips.tz` (the column existed; nothing filled it).
//
// Open-Meteo's forecast endpoint — already used for the trip's own weather —
// returns the zone for any coordinates when asked `timezone=auto`. Keyless,
// one call, cached per rounded point. Best-effort: null means "unknown",
// and the zone rule (lib/effectiveZone) then falls through to the device.

import { fetchWithTimeout } from "./fetchTimeout";
import { isValidTz } from "./worldClocks";
import { setTripTz, type Trip } from "./trips";

const cache = new Map<string, { at: number; tz: string | null }>();
const TTL = 24 * 60 * 60 * 1000;

export async function lookupTimezone(lat: number, lon: number): Promise<string | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.tz;
  let tz: string | null = null;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m&timezone=auto&forecast_days=1`;
    const res = await fetchWithTimeout(url, { cache: "no-store" }, 6_000);
    if (res.ok) {
      const j = await res.json() as { timezone?: unknown };
      if (typeof j.timezone === "string" && isValidTz(j.timezone)) tz = j.timezone;
    }
  } catch { tz = null; }
  cache.set(key, { at: Date.now(), tz });
  return tz;
}

/** The trip's zone, looking it up and writing it back once when missing. */
export async function ensureTripTz(email: string, trip: Trip | null): Promise<string | null> {
  if (!trip) return null;
  if (trip.tz && isValidTz(trip.tz)) return trip.tz;
  const tz = await lookupTimezone(trip.lat, trip.lon);
  if (tz) setTripTz(email, trip.id, tz).catch(() => {});
  return tz;
}
