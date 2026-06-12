import { fetchWithTimeout } from "./fetchTimeout";

// Free-text place → lat/lon via OpenStreetMap Nominatim, server-side (the TOS
// requires an identifying User-Agent). Results are cached in-process keyed by
// the lowercased query so the daily brief doesn't re-geocode the same office
// every morning. Nominatim's TOS is 1 req/sec — callers that geocode several
// places in a row should space them (the briefing does).

export interface GeoPoint { lat: number; lon: number; label: string }

const cache = new Map<string, GeoPoint | null>();

// Calendar "locations" that are virtual or non-geocodable — skip these so we
// don't ask Nominatim for "Microsoft Teams Meeting" and map a random match.
const VIRTUAL = /\b(zoom|teams|webex|google\s*meet|meet\.google|hangouts?|skype|gotomeeting|bluejeans|phone|dial[- ]?in|conference\s*call|virtual|online|tbd|n\/a)\b/i;

export function isGeocodable(loc: string): boolean {
  const s = (loc ?? "").trim();
  if (s.length < 3) return false;
  if (/^https?:\/\//i.test(s)) return false; // a URL (video link)
  if (VIRTUAL.test(s)) return false;
  return true;
}

export async function geocodePlace(query: string): Promise<GeoPoint | null> {
  const q = (query ?? "").trim().slice(0, 200);
  if (!isGeocodable(q)) return null;
  const key = q.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  try {
    const res = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,
      { headers: { "User-Agent": "dead-web-dashboard/1.0 (personal-use)" } },
      8_000,
    );
    if (!res.ok) { cache.set(key, null); return null; }
    const data: unknown = await res.json();
    const first = Array.isArray(data) ? (data[0] as { lat?: string; lon?: string; display_name?: string } | undefined) : undefined;
    const lat = parseFloat(String(first?.lat ?? ""));
    const lon = parseFloat(String(first?.lon ?? ""));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { cache.set(key, null); return null; }
    const point: GeoPoint = { lat, lon, label: q };
    cache.set(key, point);
    return point;
  } catch {
    return null; // don't cache transient network failures
  }
}
