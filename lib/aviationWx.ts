// Per-ICAO decoded aviation weather (NOAA Aviation Weather Center, free/no key),
// distilled to what the Force Protection scorer needs: current flight category
// and the headline limiting fields. Reuses lib/metar's decoder so the
// flight-category thresholds match the Weather tab exactly.
//
// Liveness is reported honestly: a failed/empty AWC pull returns live:false so
// the caller can score the base UNKNOWN rather than a false "VFR/clear".

import { decodeMetar } from "./metar";
import { fetchWithTimeout } from "./fetchTimeout";
import type { FlightCategory } from "./types";

const AWC = "https://aviationweather.gov/api/data";
const HEADERS = { "User-Agent": "DEAD-Dashboard (https://github.com/jpmk12/dead-web-dashboard)", Accept: "application/json" };

export interface AviationWx {
  icao: string;
  flightCategory: FlightCategory; // VFR | MVFR | IFR | LIFR | UNKNOWN
  windKt: number | null;
  gustKt: number | null;
  visMi: number | null;
  ceilingFt: number | null;
  observedAt: string;
}

const TTL = 5 * 60 * 1000;
let cache: { key: string; data: Record<string, AviationWx>; live: boolean; expires: number } | null = null;

const isIcao = (s: string) => /^[A-Z0-9]{4}$/.test(s);

// Decoded METAR for up to 12 ICAOs in one batched AWC call. `live` is false when
// the fetch failed outright (so the caller degrades to UNKNOWN, never "clear").
export async function getFlightCategories(icaosRaw: string[]): Promise<{ live: boolean; byIcao: Record<string, AviationWx> }> {
  const icaos = Array.from(new Set(icaosRaw.map((s) => s.trim().toUpperCase()).filter(isIcao))).slice(0, 12);
  if (icaos.length === 0) return { live: true, byIcao: {} };

  const key = icaos.slice().sort().join(",");
  if (cache && cache.key === key && cache.expires > Date.now()) return { live: cache.live, byIcao: cache.data };

  try {
    const res = await fetchWithTimeout(`${AWC}/metar?ids=${icaos.join(",")}&format=json`, { headers: HEADERS, cache: "no-store" }, 10_000);
    if (!res.ok) throw new Error(`metar ${res.status}`);
    const rows = await res.json();
    const list: unknown[] = Array.isArray(rows) ? rows : [];
    const byIcao: Record<string, AviationWx> = {};
    for (const row of list) {
      const id = (row as { icaoId?: string }).icaoId?.toUpperCase();
      if (!id || byIcao[id]) continue; // first row = most recent
      const m = decodeMetar(row as Parameters<typeof decodeMetar>[0]);
      byIcao[id] = {
        icao: id,
        flightCategory: m.flightCategory,
        windKt: m.windSpeedKt,
        gustKt: m.windGustKt,
        visMi: m.visibilityMi,
        ceilingFt: m.ceilingFt,
        observedAt: m.observedAt,
      };
    }
    cache = { key, data: byIcao, live: true, expires: Date.now() + TTL };
    return { live: true, byIcao };
  } catch {
    // Serve last-good if we have it; otherwise signal not-live so the scorer
    // marks affected bases UNKNOWN instead of falsely clear.
    if (cache && cache.key === key) return { live: cache.live, byIcao: cache.data };
    return { live: false, byIcao: {} };
  }
}
