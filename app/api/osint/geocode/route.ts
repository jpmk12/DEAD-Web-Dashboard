import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Geocode a free-text place name to lat/lon via OpenStreetMap's Nominatim.
// Nominatim's TOS requires a User-Agent identifying the app — that's why
// this is proxied server-side instead of called direct from the browser.
//
// Rate limit (per Nominatim TOS): 1 req/sec. This route doesn't enforce
// the limit — usage pattern is a user typing a city name into a search box
// once or twice per session, so it's well under that ceiling in practice.

interface GeocodeResult { lat: number; lon: number; displayName: string }

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ results: [] }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.slice(0, 200) ?? "";
  if (q.trim().length < 2) return NextResponse.json({ results: [] });

  const apiUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=3`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetch(apiUrl, {
      headers: { "User-Agent": "dead-web-dashboard/1.0 (personal-use)" },
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) {
      return NextResponse.json({ results: [], error: `Nominatim ${res.status}` }, { status: 502 });
    }
    const data: unknown = await res.json();
    const results: GeocodeResult[] = [];
    if (Array.isArray(data)) {
      for (const item of data.slice(0, 3)) {
        if (!item || typeof item !== "object") continue;
        const r = item as { lat?: string; lon?: string; display_name?: string };
        const lat = parseFloat(String(r.lat ?? ""));
        const lon = parseFloat(String(r.lon ?? ""));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        results.push({
          lat,
          lon,
          displayName: String(r.display_name ?? "").slice(0, 200),
        });
      }
    }
    return NextResponse.json({ results });
  } catch {
    clearTimeout(tid);
    return NextResponse.json({ results: [], error: "Fetch failed" }, { status: 502 });
  }
}
