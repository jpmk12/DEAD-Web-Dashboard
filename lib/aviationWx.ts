// Per-ICAO decoded aviation weather (NOAA Aviation Weather Center, free/no key),
// distilled to what the Force Protection scorer needs: current flight category
// and the headline limiting fields. Reuses lib/metar's decoder so the
// flight-category thresholds match the Weather tab exactly.
//
// Liveness is reported honestly: a failed/empty AWC pull returns live:false so
// the caller can score the base UNKNOWN rather than a false "VFR/clear".

import { decodeMetar, decodeTaf } from "./metar";
import { fetchWithTimeout } from "./fetchTimeout";
import type { FlightCategory } from "./types";

export const CAT_RANK: Record<FlightCategory, number> = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3, UNKNOWN: -1 };

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
// Per-ICAO (not per request set): the callers ask for different sets — the
// map in chunks of 12, force protection for the bases, the SITREP for one
// field — and a single slot keyed by the whole set almost never hit
// (code review 2026-10-07). Only the misses go to AWC.
const metarCache = new Map<string, { data: AviationWx; expires: number }>();

const isIcao = (s: string) => /^[A-Z0-9]{4}$/.test(s);

// Decoded METAR for up to 12 ICAOs in one batched AWC call. `live` is false when
// the fetch failed outright (so the caller degrades to UNKNOWN, never "clear").
export async function getFlightCategories(icaosRaw: string[]): Promise<{ live: boolean; byIcao: Record<string, AviationWx> }> {
  const icaos = Array.from(new Set(icaosRaw.map((s) => s.trim().toUpperCase()).filter(isIcao))).slice(0, 12);
  if (icaos.length === 0) return { live: true, byIcao: {} };

  const now = Date.now();
  const byIcao: Record<string, AviationWx> = {};
  const misses: string[] = [];
  for (const id of icaos) {
    const hit = metarCache.get(id);
    if (hit && hit.expires > now) byIcao[id] = hit.data; else misses.push(id);
  }
  if (misses.length === 0) return { live: true, byIcao };

  try {
    const res = await fetchWithTimeout(`${AWC}/metar?ids=${misses.join(",")}&format=json`, { headers: HEADERS, cache: "no-store" }, 10_000);
    if (!res.ok) throw new Error(`metar ${res.status}`);
    const rows = await res.json();
    const list: unknown[] = Array.isArray(rows) ? rows : [];
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
    for (const id of misses) if (byIcao[id]) metarCache.set(id, { data: byIcao[id], expires: Date.now() + TTL });
    return { live: true, byIcao };
  } catch {
    // Last-good for the misses, flagged — never "live"; the scorer marks a
    // field with nothing at all UNKNOWN instead of falsely clear.
    for (const id of misses) { const stale = metarCache.get(id); if (stale) byIcao[id] = stale.data; }
    return { live: false, byIcao };
  }
}

// Anticipatory TAF outlook: the worst forecast flight category in the next
// `horizonH` hours per ICAO, and when it first reaches that category. Lets the
// Force Protection weather axis flag "VFR now, IFR by 14Z" — the planning read
// METAR-alone can't give. Reuses the Weather tab's TAF decoder.
export interface TafOutlook { worst: FlightCategory; fromISO: string }

const tafTtl = 30 * 60 * 1000;
let tafCache: { key: string; data: Record<string, TafOutlook>; expires: number } | null = null;

export async function getTafOutlook(icaosRaw: string[], horizonH = 18): Promise<Record<string, TafOutlook>> {
  const icaos = Array.from(new Set(icaosRaw.map((s) => s.trim().toUpperCase()).filter(isIcao))).slice(0, 12);
  if (icaos.length === 0) return {};
  const key = icaos.slice().sort().join(",") + `|${horizonH}`;
  if (tafCache && tafCache.key === key && tafCache.expires > Date.now()) return tafCache.data;

  try {
    const res = await fetchWithTimeout(`${AWC}/taf?ids=${icaos.join(",")}&format=json`, { headers: HEADERS, cache: "no-store" }, 10_000);
    if (!res.ok) throw new Error(`taf ${res.status}`);
    const rows = await res.json();
    const list: unknown[] = Array.isArray(rows) ? rows : [];
    const now = Date.now();
    const horizon = now + horizonH * 3600_000;
    const out: Record<string, TafOutlook> = {};
    for (const row of list) {
      const t = decodeTaf(row as Parameters<typeof decodeTaf>[0]);
      const id = t.icao.toUpperCase();
      if (!id || out[id]) continue;
      let worst: FlightCategory = "VFR";
      let fromISO = "";
      for (const p of t.periods) {
        const pf = p.from ? Date.parse(p.from) : NaN;
        const pt = p.to ? Date.parse(p.to) : NaN;
        // Period overlaps [now, now+horizon]?
        if (!(Number.isFinite(pf) && pf < horizon && (!Number.isFinite(pt) || pt > now))) continue;
        if (CAT_RANK[p.flightCategory] > CAT_RANK[worst]) { worst = p.flightCategory; fromISO = p.from; }
      }
      if (CAT_RANK[worst] >= CAT_RANK.IFR) out[id] = { worst, fromISO };
    }
    tafCache = { key, data: out, expires: Date.now() + tafTtl };
    return out;
  } catch {
    if (tafCache && tafCache.key === key) return tafCache.data;
    return {};
  }
}
