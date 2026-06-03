// Server-side severe-weather aggregation: NWS active alerts across a set of
// locations + NHC active tropical systems. Shared by /api/weather/threats and
// (later) the Glance tab + morning brief.

import type { WeatherAlert, SevereThreat, TropicalSystem, WeatherThreats } from "./types";

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
  const res = await fetch(
    `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
    { headers: NWS_HEADERS, cache: "no-store" }
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

export async function fetchActiveTropical(): Promise<TropicalSystem[]> {
  try {
    const res = await fetch("https://www.nhc.noaa.gov/CurrentStorms.json", {
      headers: { "User-Agent": NWS_HEADERS["User-Agent"], Accept: "application/json" },
      cache: "no-store",
    });
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
        lastUpdate: String(r.lastUpdate ?? ""),
      }];
    });
  } catch {
    return [];
  }
}

export async function getWeatherThreats(locations: NamedPoint[]): Promise<WeatherThreats> {
  const [threats, tropical] = await Promise.all([
    locations.length > 0 ? aggregateThreats(locations) : Promise.resolve([] as SevereThreat[]),
    fetchActiveTropical(),
  ]);
  const summary = {
    extreme: threats.filter((t) => t.severity === "Extreme").length,
    severe: threats.filter((t) => t.severity === "Severe").length,
    lifeThreatening: threats.filter((t) => t.lifeThreatening).length,
    total: threats.length,
    topEvent: threats[0]?.event ?? null,
  };
  return { threats, tropical, summary };
}
