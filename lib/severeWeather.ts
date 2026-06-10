// Server-side severe-weather aggregation: NWS active alerts across a set of
// locations + NHC active tropical systems. Shared by /api/weather/threats and
// (later) the Glance tab + morning brief.

import type { WeatherAlert, SevereThreat, TropicalSystem, WeatherThreats, LocationHazard } from "./types";
import { getDisasters, haversineKm } from "./disasters";
import { fetchWithTimeout } from "./fetchTimeout";
import { recordDailySignals } from "./trends";

const NWS_HEADERS = { "User-Agent": "DEAD-Dashboard (https://github.com/jpmk12/dead-web-dashboard)", Accept: "application/geo+json" };

const SEVERITIES = new Set<WeatherAlert["severity"]>(["Extreme", "Severe", "Moderate", "Minor", "Unknown"]);
const SEV_RANK: Record<WeatherAlert["severity"], number> = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };

// Events that put life/property at immediate risk when issued as a warning.
const LIFE_THREATENING = /tornado|hurricane|severe thunderstorm|flash flood|storm surge|extreme wind|tropical storm|snow squall|dust storm|tsunami/i;

export interface NamedPoint { label: string; lat: number; lon: number }

function tierOf(event: string): SevereThreat["tier"] {
  const e = event.toLowerCase();
  if (e.includes("warning") || e.includes("emergency")) return "warning";
  if (e.includes("watch")) return "watch";
  if (e.includes("advisory")) return "advisory";
  if (e.includes("statement")) return "statement";
  return "other";
}

async function fetchPointAlerts(lat: number, lon: number): Promise<WeatherAlert[]> {
  const res = await fetchWithTimeout(
    `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
    { headers: NWS_HEADERS, cache: "no-store" },
    10_000
  );
  if (!res.ok) throw new Error(`alerts ${res.status}`);
  const data = await res.json();
  const features: unknown[] = data?.features ?? [];
  return features.flatMap((f): WeatherAlert[] => {
    if (!f || typeof f !== "object") return [];
    const props = (f as { properties?: Record<string, unknown> }).properties ?? {};
    const sev = String(props.severity ?? "Unknown") as WeatherAlert["severity"];
    return [{
      id: String((f as { id?: string }).id ?? ""),
      event: String(props.event ?? ""),
      severity: SEVERITIES.has(sev) ? sev : "Unknown",
      urgency: String(props.urgency ?? ""),
      headline: String(props.headline ?? "").slice(0, 300),
      effective: String(props.effective ?? ""),
      expires: String(props.expires ?? ""),
      areaDesc: String(props.areaDesc ?? "").slice(0, 200),
    }];
  });
}

export async function aggregateThreats(locations: NamedPoint[]): Promise<SevereThreat[]> {
  const results = await Promise.all(
    locations.map((loc) =>
      fetchPointAlerts(loc.lat, loc.lon)
        .then((alerts) => alerts.map((a) => ({ a, label: loc.label })))
        .catch(() => [] as { a: WeatherAlert; label: string }[])
    )
  );

  // Dedupe by alert id; collect which tracked locations each alert covers.
  const byId = new Map<string, SevereThreat>();
  for (const { a, label } of results.flat()) {
    const existing = byId.get(a.id);
    if (existing) {
      if (!existing.locations.includes(label)) existing.locations.push(label);
      continue;
    }
    const tier = tierOf(a.event);
    byId.set(a.id, {
      id: a.id,
      event: a.event,
      severity: a.severity,
      tier,
      lifeThreatening: a.severity === "Extreme" || (tier === "warning" && LIFE_THREATENING.test(a.event)),
      headline: a.headline,
      areaDesc: a.areaDesc,
      effective: a.effective,
      expires: a.expires,
      locations: [label],
    });
  }

  return Array.from(byId.values()).sort((x, y) => {
    if (x.lifeThreatening !== y.lifeThreatening) return x.lifeThreatening ? -1 : 1;
    return SEV_RANK[x.severity] - SEV_RANK[y.severity];
  });
}

const TC_CLASS: Record<string, string> = {
  HU: "Hurricane", TY: "Typhoon", STS: "Severe Tropical Storm", TS: "Tropical Storm",
  TD: "Tropical Depression", STD: "Subtropical Depression", SS: "Subtropical Storm",
  PTC: "Potential Tropical Cyclone", PC: "Post-Tropical Cyclone", DB: "Disturbance",
};

function parseCoord(v: unknown): number | null {
  // NHC gives e.g. "24.5N" / "80.1W"; also numeric *Numeric fields.
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const m = v.match(/^([\d.]+)\s*([NSEW])$/i);
  if (!m) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const hemi = m[2].toUpperCase();
  return hemi === "S" || hemi === "W" ? -n : n;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && v !== "" && v != null ? n : null;
}

// NHC storm graphics page from a bin number, e.g. "EP1"/"EP01" ->
// https://www.nhc.noaa.gov/graphics_ep1.shtml (cone + advisories/discussion).
// Falls back to the active-cyclones overview when the bin can't be parsed.
function nhcStormLink(binNumber: unknown): string {
  const m = String(binNumber ?? "").match(/^([A-Za-z]+)0*(\d+)$/);
  return m
    ? `https://www.nhc.noaa.gov/graphics_${m[1].toLowerCase()}${m[2]}.shtml`
    : "https://www.nhc.noaa.gov/cyclones/";
}

export async function fetchActiveTropical(): Promise<TropicalSystem[]> {
  try {
    const res = await fetchWithTimeout("https://www.nhc.noaa.gov/CurrentStorms.json", {
      headers: { "User-Agent": NWS_HEADERS["User-Agent"], Accept: "application/json" },
      cache: "no-store",
    }, 10_000);
    if (!res.ok) return [];
    const data = await res.json();
    const storms: unknown[] = data?.activeStorms ?? [];
    return storms.flatMap((s): TropicalSystem[] => {
      if (!s || typeof s !== "object") return [];
      const r = s as Record<string, unknown>;
      const classification = String(r.classification ?? "").toUpperCase();
      return [{
        id: String(r.id ?? r.binNumber ?? Math.random().toString(36).slice(2)),
        name: String(r.name ?? "Unnamed"),
        classification,
        category: TC_CLASS[classification] ?? classification ?? "Tropical System",
        intensityKt: num(r.intensity),
        pressureMb: num(r.pressure),
        lat: parseCoord(r.latitudeNumeric ?? r.latitude),
        lon: parseCoord(r.longitudeNumeric ?? r.longitude),
        movement: [r.movementDir, r.movementSpeed ? `${r.movementSpeed} kt` : ""].filter(Boolean).join(" at "),
        movementDeg: num(r.movementDir),
        movementKt: num(r.movementSpeed),
        lastUpdate: String(r.lastUpdate ?? ""),
        link: nhcStormLink(r.binNumber),
      }];
    });
  } catch {
    return [];
  }
}

// Tag a disaster with any tracked locations within this radius (km).
const NEAR_KM = 500;

// ── Global per-location hazard scan (Open-Meteo model) ──────────────────────
// NWS active alerts cover US territory only. This fills the OCONUS gap with a
// uniform, model-derived read of aviation/ops-relevant hazards at every tracked
// point (including AMC hubs) for the next ~30 h. It is model GUIDANCE, not an
// official warning — labelled "model" in the UI.

interface OmHourly {
  time?: string[];
  wind_gusts_10m?: number[]; // knots
  visibility?: number[];     // metres
  weather_code?: number[];   // WMO code
  temperature_2m?: number[]; // °F
}

const HAZARD_WINDOW_H = 30;

// Compact UTC-hour window from the matched indices, e.g. "06Z–09Z" or "14Z".
function fmtWindow(times: string[], idxs: number[]): string {
  if (idxs.length === 0) return "";
  const hh = (s: string) => (s ?? "").slice(11, 13);
  const a = hh(times[idxs[0]]);
  const b = hh(times[idxs[idxs.length - 1]]);
  return a === b ? `${a}Z` : `${a}–${b}Z`;
}

export interface HazardAssessment { severity: "severe" | "elevated" | "none"; flags: string[] }

// Pure threshold logic — unit-tested independently of the network fetch.
export function assessHazards(hourly: OmHourly, nowMs: number): HazardAssessment {
  const time = hourly.time ?? [];
  const gusts = hourly.wind_gusts_10m ?? [];
  const vis = hourly.visibility ?? [];
  const wx = hourly.weather_code ?? [];
  const temp = hourly.temperature_2m ?? [];

  const endMs = nowMs + HAZARD_WINDOW_H * 3600_000;
  const idx: number[] = [];
  for (let i = 0; i < time.length; i++) {
    const iso = time[i].endsWith("Z") ? time[i] : `${time[i]}Z`;
    const t = Date.parse(iso);
    if (Number.isFinite(t) && t >= nowMs - 3600_000 && t <= endMs) idx.push(i);
  }
  if (idx.length === 0) return { severity: "none", flags: [] };

  const flags: string[] = [];
  let severe = false;

  // Wind gusts — crosswind / ground-ops / airdrop relevance.
  const gustIdx = idx.filter((i) => (gusts[i] ?? 0) >= 35);
  if (gustIdx.length) {
    const peak = Math.round(Math.max(...gustIdx.map((i) => gusts[i] ?? 0)));
    if (peak >= 50) severe = true;
    flags.push(`Gusts ${peak} kt ${fmtWindow(time, gustIdx)}`);
  }
  // Visibility — IFR < 1600 m, LIFR < 800 m.
  const visIdx = idx.filter((i) => Number.isFinite(vis[i]) && vis[i] < 1600);
  if (visIdx.length) {
    const lifr = Math.min(...visIdx.map((i) => vis[i])) < 800;
    if (lifr) severe = true;
    flags.push(`${lifr ? "LIFR" : "IFR"} vis ${fmtWindow(time, visIdx)}`);
  }
  // Thunderstorms (WMO 95/96/99) — 96/99 (hail) is severe.
  const tsIdx = idx.filter((i) => wx[i] === 95 || wx[i] === 96 || wx[i] === 99);
  if (tsIdx.length) {
    if (idx.some((i) => wx[i] === 96 || wx[i] === 99)) severe = true;
    flags.push(`Thunderstorms ${fmtWindow(time, tsIdx)}`);
  }
  // Snow / freezing precip (WMO snow 71-77,85,86 ; freezing 56,57,66,67).
  const iceCodes = new Set([71, 73, 75, 77, 85, 86, 56, 57, 66, 67]);
  const iceIdx = idx.filter((i) => iceCodes.has(wx[i]));
  if (iceIdx.length) flags.push(`Snow/ice ${fmtWindow(time, iceIdx)}`);
  // Temperature extremes (ramp/personnel/aircraft limits).
  const temps = idx.map((i) => temp[i]).filter((v): v is number => Number.isFinite(v));
  if (temps.length) {
    const tMax = Math.max(...temps);
    const tMin = Math.min(...temps);
    if (tMax >= 110) flags.push(`Extreme heat ${Math.round(tMax)}°F`);
    if (tMin <= 5) flags.push(`Extreme cold ${Math.round(tMin)}°F`);
  }

  if (flags.length === 0) return { severity: "none", flags: [] };
  return { severity: severe ? "severe" : "elevated", flags };
}

const OM_UA = "DEAD-Dashboard (https://github.com/jpmk12/dead-web-dashboard)";

async function fetchLocationHazards(locations: NamedPoint[]): Promise<LocationHazard[]> {
  if (locations.length === 0) return [];
  const now = Date.now();
  const results = await Promise.all(
    locations.map(async (loc): Promise<LocationHazard | null> => {
      try {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat.toFixed(4)}&longitude=${loc.lon.toFixed(4)}` +
          `&hourly=wind_gusts_10m,visibility,weather_code,temperature_2m&forecast_days=2` +
          `&wind_speed_unit=kn&temperature_unit=fahrenheit&timezone=UTC`;
        const res = await fetchWithTimeout(url, { headers: { "User-Agent": OM_UA }, cache: "no-store" }, 8_000);
        if (!res.ok) return null;
        const data = await res.json();
        const a = assessHazards((data?.hourly ?? {}) as OmHourly, now);
        if (a.severity === "none") return null;
        return { label: loc.label, lat: loc.lat, lon: loc.lon, severity: a.severity, flags: a.flags };
      } catch {
        return null; // unreachable source → no hazards, never breaks the board
      }
    })
  );
  const rank = { severe: 0, elevated: 1 } as const;
  return results
    .filter((r): r is LocationHazard => r !== null)
    .sort((x, y) => rank[x.severity] - rank[y.severity]);
}

export async function getWeatherThreats(locations: NamedPoint[]): Promise<WeatherThreats> {
  const [threats, tropical, disastersRaw, hazards] = await Promise.all([
    locations.length > 0 ? aggregateThreats(locations) : Promise.resolve([] as SevereThreat[]),
    fetchActiveTropical(),
    getDisasters(),
    fetchLocationHazards(locations),
  ]);

  // Flag disasters near the user's bases — then sort those near-base first so
  // a quake/typhoon by Kadena outranks a distant one of equal severity.
  const disasters = disastersRaw.map((d) => {
    if (d.lat == null || d.lon == null) return d;
    const near = locations
      .filter((loc) => haversineKm(d.lat as number, d.lon as number, loc.lat, loc.lon) <= NEAR_KM)
      .map((loc) => loc.label);
    return near.length ? { ...d, nearLocations: near } : d;
  });
  disasters.sort((a, b) => (b.nearLocations.length > 0 ? 1 : 0) - (a.nearLocations.length > 0 ? 1 : 0));

  // Trend recorder (P1): disaster type/region/AOR counted once per event
  // (stable GDACS/USGS ids dedup the repeat fetches). Fire-and-forget.
  recordDailySignals(disasters.map((d) => ({
    id: `dis|${d.id}`,
    terms: [
      { kind: "category" as const, term: d.type },
      ...(d.country ? [{ kind: "region" as const, term: d.country }] : []),
      ...(d.aor && d.aor !== "UNKNOWN" ? [{ kind: "aor" as const, term: d.aor }] : []),
    ],
  }))).catch(() => {});

  const summary = {
    extreme: threats.filter((t) => t.severity === "Extreme").length,
    severe: threats.filter((t) => t.severity === "Severe").length,
    lifeThreatening: threats.filter((t) => t.lifeThreatening).length,
    total: threats.length,
    topEvent: threats[0]?.event ?? null,
    disasters: disasters.length,
    disastersRed: disasters.filter((d) => d.severity === "red").length,
    hazardLocations: hazards.length,
  };
  return { threats, tropical, disasters, hazards, summary };
}
