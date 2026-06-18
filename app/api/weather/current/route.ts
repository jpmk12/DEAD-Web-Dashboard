import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCurrentConditions, type CurrentConditions } from "@/lib/currentConditions";

export const dynamic = "force-dynamic";

// Current conditions + sun times for a lat/lon (Open-Meteo, keyless, global).
// Feeds the Weather-tab cards with feels-like / humidity / gusts / sunrise-sunset
// and a worldwide condition code (so cards aren't blank OCONUS where NWS has no
// coverage). Cached briefly server-side to spare Open-Meteo on multi-card renders.
const TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { data: CurrentConditions | null; expires: number }>();

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ current: null }, { status: 401 });

  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ current: null, error: "valid lat/lon required" }, { status: 400 });
  }

  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return NextResponse.json({ current: hit.data, cached: true });

  const current = await getCurrentConditions(lat, lon);
  // Only cache a successful read so a transient failure retries next render.
  if (current) {
    cache.set(key, { data: current, expires: Date.now() + TTL_MS });
    if (cache.size > 100) { const now = Date.now(); for (const [k, v] of cache) if (v.expires < now) cache.delete(k); }
  }
  return NextResponse.json({ current });
}
