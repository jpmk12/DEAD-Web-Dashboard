import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Proxy to OpenSky Network's anonymous /api/states/all endpoint, scoped to a
// user-supplied bounding box around their home coords. Anonymous tier
// rate-limits at ~10 req/min, so we cache server-side at 60s. The map
// component polls every 15s — those polls hit cache 3 out of 4 times.

interface Aircraft {
  icao24: string;
  callsign: string;
  country: string;
  lon: number;
  lat: number;
  altitude: number | null;
  onGround: boolean;
  velocity: number | null;
  heading: number | null;
  verticalRate: number | null;
  isMilitary: boolean;
}

interface CacheEntry { items: Aircraft[]; bbox: string; fetchedAt: number }
let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 60_000;

// Two-tier military detection. ICAO 24-bit address ranges are the most
// reliable — US Mil owns AE0000-AFFFFF. Callsigns supplement: any of these
// common mil prefixes flags the aircraft even if its ICAO isn't in our
// (deliberately conservative) prefix list.
//
// References: ADS-B Exchange's mil filter is similar but covers more
// allied ranges (UK, Germany, etc.). For MVP we cover US Mil reliably and
// catch the rest through callsigns.
const MIL_ICAO_PREFIXES = ["ae", "af"];
const MIL_CALLSIGN_RE = /^(REACH|HAVOC|BLUE\d+|KING\d+|EVAC|HOBO|SAM\d+|MAGMA|GULF|VENUS|ANVIL|VICTUS|VADER|TREK|HEAVY|FORCE|SPAR|PETRO|LIME|ASPEN|FLAP|CASH|TANGO|BISON|RCH|PAT\d+|CONVOY|UNDIE|JOKER|PIKE|BRUTE|RAVEN|SHARK|TITUS|VECTOR|MAGNUM|EAGLE|HERKY|ROCKY|GOTHIC|VOODOO|SCALP|GRIM)/i;

function isMilitary(icao24: string, callsign: string): boolean {
  if (icao24 && MIL_ICAO_PREFIXES.some((p) => icao24.startsWith(p))) return true;
  if (callsign && MIL_CALLSIGN_RE.test(callsign)) return true;
  return false;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ aircraft: [] }, { status: 401 });

  const url = new URL(req.url);
  const lat = parseFloat(url.searchParams.get("lat") || "38.85");
  const lon = parseFloat(url.searchParams.get("lon") || "-104.8");
  if (!isFinite(lat) || !isFinite(lon)) {
    return NextResponse.json({ aircraft: [], error: "Invalid coords" }, { status: 400 });
  }
  // Clamp radius so a bad client request can't ask OpenSky for the whole
  // continent. 50-500 km covers everything from a metro view to most of a
  // theatre AOR.
  const radius = Math.min(500, Math.max(50, parseFloat(url.searchParams.get("radius") || "250")));

  // Rough lat/lon → km. 1° latitude ≈ 111 km everywhere; longitude scales
  // by cos(lat). Good enough for a query bounding box.
  const latDelta = radius / 111;
  const lonDelta = radius / (111 * Math.cos(lat * Math.PI / 180) || 1);
  const lamin = lat - latDelta;
  const lamax = lat + latDelta;
  const lomin = lon - lonDelta;
  const lomax = lon + lonDelta;
  const bbox = `${lamin.toFixed(2)},${lamax.toFixed(2)},${lomin.toFixed(2)},${lomax.toFixed(2)}`;

  if (cache && cache.bbox === bbox && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ aircraft: cache.items, fetchedAt: cache.fetchedAt, cached: true });
  }

  const apiUrl = `https://opensky-network.org/api/states/all?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(tid);
    if (!res.ok) {
      return NextResponse.json({ aircraft: [], error: `OpenSky ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    const states: unknown[] = Array.isArray(data?.states) ? data.states : [];
    const aircraft: Aircraft[] = [];
    for (const sRaw of states) {
      if (!Array.isArray(sRaw)) continue;
      const s = sRaw as unknown[];
      const lonV = s[5], latV = s[6];
      if (typeof lonV !== "number" || typeof latV !== "number") continue;
      const icao24 = String(s[0] || "").toLowerCase();
      const callsign = String(s[1] || "").trim();
      aircraft.push({
        icao24,
        callsign,
        country: String(s[2] || ""),
        lon: lonV,
        lat: latV,
        altitude: typeof s[7] === "number" ? s[7] : null,
        onGround: !!s[8],
        velocity: typeof s[9] === "number" ? s[9] : null,
        heading: typeof s[10] === "number" ? s[10] : null,
        verticalRate: typeof s[11] === "number" ? s[11] : null,
        isMilitary: isMilitary(icao24, callsign),
      });
    }
    cache = { items: aircraft, bbox, fetchedAt: Date.now() };
    return NextResponse.json({ aircraft, fetchedAt: cache.fetchedAt, cached: false });
  } catch {
    clearTimeout(tid);
    return NextResponse.json({ aircraft: [], error: "Fetch failed" }, { status: 502 });
  }
}
