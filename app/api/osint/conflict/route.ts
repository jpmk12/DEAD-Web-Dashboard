import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Recent armed-conflict event density via GDELT's GEO 2.0 API (open, no key),
// proxied server-side so the browser CSP isn't involved. Returns simplified
// points { lat, lon, name, count } for the Crisis map's "Conflict" layer — the
// permissive-environment read. Coarse OSINT, not a curated intel product.
const TTL = 30 * 60 * 1000;
let cache: { points: ConflictPoint[]; expires: number } | null = null;

interface ConflictPoint { lat: number; lon: number; name: string; count: number }

const GDELT_URL =
  "https://api.gdeltproject.org/api/v2/geo/geo?query=" +
  encodeURIComponent("(armed clashes OR airstrike OR shelling OR militants OR offensive OR insurgents OR rocket attack)") +
  "&format=GeoJSON&timespan=2d";

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ points: [] }, { status: 401 });
  if (cache && cache.expires > Date.now()) return NextResponse.json({ points: cache.points });

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(GDELT_URL, { signal: ctrl.signal, headers: { "User-Agent": "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)" }, cache: "no-store" });
    clearTimeout(tid);
    if (!res.ok) return NextResponse.json({ points: [] });
    const data: unknown = await res.json();
    const feats = Array.isArray((data as { features?: unknown[] })?.features) ? (data as { features: unknown[] }).features : [];
    const points: ConflictPoint[] = [];
    for (const f of feats) {
      const geom = (f as { geometry?: { coordinates?: unknown[] } })?.geometry;
      const props = (f as { properties?: Record<string, unknown> })?.properties ?? {};
      const lon = Number(geom?.coordinates?.[0]);
      const lat = Number(geom?.coordinates?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      points.push({ lat, lon, name: String(props.name ?? "").slice(0, 120), count: Number(props.count ?? 1) || 1 });
    }
    points.sort((a, b) => b.count - a.count);
    const top = points.slice(0, 250);
    cache = { points: top, expires: Date.now() + TTL };
    return NextResponse.json({ points: top });
  } catch {
    return NextResponse.json({ points: [] });
  }
}
