import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { StationWx } from "@/lib/types";
import { decodeMetar, decodeTaf } from "@/lib/metar";
import { fetchWithTimeout } from "@/lib/fetchTimeout";

export const dynamic = "force-dynamic";

// Decoded METAR + TAF for a set of ICAO stations, via the NWS Aviation Weather
// Center JSON API (one batched call each). Cached briefly so multi-station
// dashboard renders don't hammer AWC.
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { data: Record<string, StationWx>; expires: number }>();

const AWC = "https://aviationweather.gov/api/data";
const HEADERS = { "User-Agent": "DEAD-Dashboard (https://github.com/jpmk12/dead-web-dashboard)", Accept: "application/json" };

function isValidIcao(s: string): boolean {
  return /^[A-Z0-9]{4}$/.test(s);
}

async function fetchJson(url: string): Promise<unknown[]> {
  const res = await fetchWithTimeout(url, { headers: HEADERS, cache: "no-store" }, 10_000);
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const idsRaw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = Array.from(
    new Set(idsRaw.split(",").map((s) => s.trim().toUpperCase()).filter(isValidIcao))
  ).slice(0, 12);
  if (ids.length === 0) return NextResponse.json({ stations: {} });

  const cacheKey = ids.slice().sort().join(",");
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) {
    return NextResponse.json({ stations: hit.data, ok: true });
  }

  const idParam = ids.join(",");
  const [metars, tafs] = await Promise.all([
    fetchJson(`${AWC}/metar?ids=${idParam}&format=json`).catch(() => [] as unknown[]),
    fetchJson(`${AWC}/taf?ids=${idParam}&format=json`).catch(() => [] as unknown[]),
  ]);

  // Index source rows by ICAO so we can pair METAR + TAF per station.
  const metarByIcao = new Map<string, unknown>();
  for (const m of metars) {
    const id = (m as { icaoId?: string }).icaoId?.toUpperCase();
    if (id && !metarByIcao.has(id)) metarByIcao.set(id, m); // first = most recent
  }
  const tafByIcao = new Map<string, unknown>();
  for (const t of tafs) {
    const id = (t as { icaoId?: string }).icaoId?.toUpperCase();
    if (id && !tafByIcao.has(id)) tafByIcao.set(id, t);
  }

  const stations: Record<string, StationWx> = {};
  for (const icao of ids) {
    const m = metarByIcao.get(icao);
    const t = tafByIcao.get(icao);
    if (!m && !t) {
      stations[icao] = { icao, metar: null, taf: null, error: "No data reported" };
      continue;
    }
    stations[icao] = {
      icao,
      metar: m ? decodeMetar(m) : null,
      taf: t ? decodeTaf(t) : null,
    };
  }

  if (metars.length > 0 || tafs.length > 0) cache.set(cacheKey, { data: stations, expires: Date.now() + TTL_MS });
  // Both AWC fetches empty for requested stations = upstream down, not
  // "no weather" — the panel badges it instead of showing a blank strip.
  const ok = metars.length > 0 || tafs.length > 0;
  return NextResponse.json({ stations, ok });
}
