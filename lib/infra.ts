// SITREP Infrastructure sources — SERVER-ONLY fetchers over the contracts
// pinned by the 2026-07-06 prod run of /api/sitrep/infra-diag:
// - IODA (Georgia Tech) internet signals: BOTH endpoints live. Key finding:
//   relative windows ("now-1d") are NOT parsed (requestParameters came back
//   from:0 until:0) — from/until must be EPOCH SECONDS. Region codes resolve
//   via the entities search (New Jersey = 4453), never hardcoded.
// - USGS instantaneous-values water gauges (US only): live, WaterML envelope.
// - FAA NAS status XML (US only): live, one national fetch shared by bases.
// - GDELT power query: 429 (5 s/req budget is already spent on local news) —
//   so power stays derived from the ALREADY-FETCHED local news, no new call.
// All parsing is in lib/infraSignals.ts (pure, tested). Fail-safe throughout:
// a dead source → live:false → UNKNOWN in the UI, never implied-clear.

import type { SitrepBase } from "./types";
import { fetchWithTimeout } from "./fetchTimeout";
import {
  parseIodaEntities, parseIodaSignals, internetLed, parseUsgsGauges, parseFaaNas,
  type IodaSeries, type UsgsGauge, type NasStatus, type NasNearby,
} from "./infraSignals";
import type { Led } from "./sitrepSignals";
import { airportByIdent } from "./ourAirports";

const IODA = "https://api.ioda.inetintel.cc.gatech.edu/v2";
const UA = { "User-Agent": "DEAD-Dashboard/1.0", Accept: "application/json" };

export interface SitrepInfra {
  internet: { live: boolean; entity: string | null; led: Led; series: IodaSeries[] };
  water: { live: boolean; gauges: UsgsGauge[] } | null;   // null = non-US base
  nas: {
    live: boolean;
    updated: string | null;
    counts: { groundStops: number; groundDelays: number; closures: number; delays: number };
    nearby: NasNearby[];
  } | null;                                                // null = non-US base
}

// ─── IODA ────────────────────────────────────────────────────────────────────

// Which IODA entity covers this base: a US state region when we can read one
// out of the base's place string, else the country. Coarse by design — IODA
// measures macro connectivity, not the base LAN.
const US_STATES = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia",
  "Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland",
  "Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey",
  "New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina",
  "South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming",
];

export function iodaTarget(base: SitrepBase): { entityType: "region" | "country"; search: string } {
  if ((base.country || "United States") === "United States") {
    const hay = `${base.place ?? ""} ${base.label ?? ""}`.toLowerCase();
    const state = US_STATES.find((s) => hay.includes(s.toLowerCase()));
    if (state) return { entityType: "region", search: state };
  }
  return { entityType: "country", search: base.country || "United States" };
}

const entityCache = new Map<string, { code: string; name: string; expires: number }>();
const signalsCache = new Map<string, { series: IodaSeries[]; expires: number }>();
const ENTITY_TTL = 24 * 3600_000;
const SIGNALS_TTL = 15 * 60_000;

async function iodaInternet(base: SitrepBase): Promise<SitrepInfra["internet"]> {
  const target = iodaTarget(base);
  const key = `${target.entityType}:${target.search.toLowerCase()}`;
  try {
    let ent = entityCache.get(key);
    if (!ent || ent.expires < Date.now()) {
      const res = await fetchWithTimeout(
        `${IODA}/entities/query?entityType=${target.entityType}&search=${encodeURIComponent(target.search)}`,
        { headers: UA, cache: "no-store" }, 10_000
      );
      if (!res.ok) throw new Error(`entities ${res.status}`);
      const found = parseIodaEntities(await res.json(), target.search);
      if (!found) throw new Error("entity not found");
      ent = { ...found, expires: Date.now() + ENTITY_TTL };
      entityCache.set(key, ent);
    }

    const sigKey = `${target.entityType}:${ent.code}`;
    const hit = signalsCache.get(sigKey);
    if (hit && hit.expires > Date.now()) {
      return { live: true, entity: ent.name, led: internetLed(hit.series), series: hit.series };
    }
    // EPOCH SECONDS — the API silently zeroes relative strings like "now-1d".
    const until = Math.floor(Date.now() / 1000);
    const from = until - 24 * 3600;
    const res = await fetchWithTimeout(
      `${IODA}/signals/raw/${target.entityType}/${ent.code}?from=${from}&until=${until}&maxPoints=400`,
      { headers: UA, cache: "no-store" }, 12_000
    );
    if (!res.ok) throw new Error(`signals ${res.status}`);
    const series = parseIodaSignals(await res.json());
    signalsCache.set(sigKey, { series, expires: Date.now() + SIGNALS_TTL });
    return { live: true, entity: ent.name, led: internetLed(series), series };
  } catch {
    return { live: false, entity: null, led: "u", series: [] };
  }
}

// ─── USGS water gauges ───────────────────────────────────────────────────────

const usgsCache = new Map<string, { gauges: UsgsGauge[]; live: boolean; expires: number }>();
const USGS_TTL = 15 * 60_000;

async function usgsWater(base: SitrepBase): Promise<SitrepInfra["water"]> {
  if ((base.country || "United States") !== "United States") return null;
  const key = base.icao;
  const hit = usgsCache.get(key);
  if (hit && hit.expires > Date.now()) return { live: hit.live, gauges: hit.gauges };
  try {
    // Same bBox recipe the diag probed with: lon ±0.5°, lat ±0.4° around base.
    const bBox = [
      (base.lon - 0.5).toFixed(2), (base.lat - 0.4).toFixed(2),
      (base.lon + 0.5).toFixed(2), (base.lat + 0.4).toFixed(2),
    ].join(",");
    const res = await fetchWithTimeout(
      `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${bBox}&parameterCd=00065&siteStatus=active`,
      { headers: UA, cache: "no-store" }, 12_000
    );
    if (!res.ok) throw new Error(`usgs ${res.status}`);
    const gauges = parseUsgsGauges(await res.json())
      .filter((g) => g.stageFt !== null)
      .slice(0, 6);
    usgsCache.set(key, { gauges, live: true, expires: Date.now() + USGS_TTL });
    return { live: true, gauges };
  } catch {
    usgsCache.set(key, { gauges: [], live: false, expires: Date.now() + 2 * 60_000 });
    return { live: false, gauges: [] };
  }
}

// ─── FAA NAS status ─────────────────────────────────────────────────────────

let nasCache: { status: NasStatus; live: boolean; expires: number } | null = null;
const NAS_TTL = 5 * 60_000;
const NAS_NEARBY_KM = 250;

async function faaNas(): Promise<{ status: NasStatus; live: boolean }> {
  if (nasCache && nasCache.expires > Date.now()) return { status: nasCache.status, live: nasCache.live };
  try {
    const res = await fetchWithTimeout(
      "https://nasstatus.faa.gov/api/airport-status-information",
      { headers: { "User-Agent": UA["User-Agent"], Accept: "application/xml" }, cache: "no-store" }, 12_000
    );
    if (!res.ok) throw new Error(`nas ${res.status}`);
    const status = parseFaaNas(await res.text());
    nasCache = { status, live: true, expires: Date.now() + NAS_TTL };
  } catch {
    nasCache = { status: { updated: null, programs: [] }, live: false, expires: Date.now() + 2 * 60_000 };
  }
  return { status: nasCache.status, live: nasCache.live };
}

const kmBetween = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

async function nasForBase(base: SitrepBase): Promise<SitrepInfra["nas"]> {
  if ((base.country || "United States") !== "United States") return null;
  const { status, live } = await faaNas();
  const counts = {
    groundStops: status.programs.filter((p) => p.kind === "groundStop").length,
    groundDelays: status.programs.filter((p) => p.kind === "groundDelay").length,
    closures: status.programs.filter((p) => p.kind === "closure").length,
    delays: status.programs.filter((p) => p.kind === "delay").length,
  };
  // The board lists FAA LIDs; K+LID resolves the CONUS ones in OurAirports.
  // Unresolvable idents just don't rank as nearby — the national counts still show.
  const nearby: NasNearby[] = [];
  for (const p of status.programs) {
    if (!/^[A-Z0-9]{3}$/.test(p.airport)) continue;
    const ap = await airportByIdent(`K${p.airport}`).catch(() => null);
    if (!ap) continue;
    const km = Math.round(kmBetween(base.lat, base.lon, ap.lat, ap.lon));
    if (km <= NAS_NEARBY_KM) nearby.push({ ...p, km });
  }
  nearby.sort((a, b) => a.km - b.km);
  return { live, updated: status.updated, counts, nearby: nearby.slice(0, 6) };
}

// ─── Composite ──────────────────────────────────────────────────────────────

export async function getInfraSources(base: SitrepBase): Promise<SitrepInfra> {
  const [internet, water, nas] = await Promise.all([
    iodaInternet(base),
    usgsWater(base),
    nasForBase(base),
  ]);
  return { internet, water, nas };
}

export function resetInfraCache(): void {
  entityCache.clear();
  signalsCache.clear();
  usgsCache.clear();
  nasCache = null;
}
