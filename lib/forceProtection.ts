// Force Protection Watch — fuses the threat layers the app already collects into
// a per-location posture for the bases/locations where the user's forces fly &
// operate (UserPrefs.forceLocations). Answers "where are my people & tails, and
// which spots need my attention today?" across combatant commands.
//
// Design: assessLocation() is PURE (takes pre-fetched context) so the scoring
// thresholds are unit-tested without the network; getForceProtection() fetches
// the shared context once and maps every location through it. No new external
// feeds in Phase 1 — every source here is already used by the Crisis map.

import type { ForceLocation, DisasterEvent, SevereThreat, TropicalSystem, LocationHazard, TravelAdvisory } from "./types";
import type { ConflictPoint } from "./conflictEvents";
import type { AcledEvent } from "./acled";
import type { InformPoint } from "./inform";
import type { GpsHex } from "./gpsjam";
import { haversineKm, getDisasters } from "./disasters";
import { getWeatherThreats, type NamedPoint } from "./severeWeather";
import { getStateAdvisories } from "./stateAdvisories";
import { getConflictPoints } from "./conflictEvents";
import { getAcledEvents } from "./acled";
import { getInformPoints } from "./inform";
import { getGpsInterference, gpsLevelAt } from "./gpsjam";

export type Severity = "green" | "amber" | "red" | "unknown";
export type ForceCategory = "conflict" | "weather" | "gps" | "civil" | "hazard";

export const CATEGORY_LABEL: Record<ForceCategory, string> = {
  conflict: "Conflict",
  weather: "Aviation Wx",
  gps: "GPS / Comms",
  civil: "Civil / Diplomatic",
  hazard: "Hazard",
};

export interface CategoryAssessment {
  category: ForceCategory;
  severity: Severity;
  signals: string[]; // human-readable drivers, worst first
}

export interface ForceAssessment {
  id: string;
  label: string;
  country: string;
  cocom: string;
  lat: number;
  lon: number;
  icao?: string;
  note?: string;
  transient: boolean;        // has a presence window
  composite: Severity;       // worst category
  score: number;             // 0-100 for ranking within a severity tier
  topDriver: string;         // one-line headline ("Conflict — ...")
  categories: CategoryAssessment[];
}

export interface ForceContext {
  disasters: DisasterEvent[];
  threats: SevereThreat[];
  tropical: TropicalSystem[];
  hazards: LocationHazard[];
  advisories: TravelAdvisory[];
  conflict: ConflictPoint[];
  acled: AcledEvent[];
  inform: InformPoint[];
  gps: GpsHex[];
  // Per-source liveness: distinguishes "checked, clean" from "couldn't check".
  // A category whose source(s) weren't live scores UNKNOWN, never green — so a
  // downed feed never reads as "all clear" (the cardinal safety rule). Sources
  // that can't tell down-from-empty (conflict/advisories/etc. swallow errors to
  // []) are best-effort and assumed live; gps/weather report real liveness.
  live: { weather: boolean; gps: boolean };
}

export interface ForceProtectionResult {
  assessments: ForceAssessment[];
  generatedAt: string;
  sources: { gps: boolean; acled: boolean; conflict: "ucdp" | "reliefweb" | "none" };
}

// Rank orders BOTH for sorting and for "worst category" rollup. UNKNOWN sits
// between green and amber: a blind spot deserves a look, but never outranks a
// known amber/red, and never counts as clear.
const SEV_RANK: Record<Severity, number> = { green: 0, unknown: 1, amber: 2, red: 3 };
// `worse` is only ever called among KNOWN severities (unknown is filtered out
// before rollup), so the green/amber/red ordering is what matters here.
const worse = (a: Severity, b: Severity): Severity => (SEV_RANK[a] >= SEV_RANK[b] ? a : b);

// Loose country-name match (normalize, substring either way). Mirrors the loose
// matching used elsewhere for centroid/advisory lookups.
function countryMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\b(the|of|republic|democratic|peoples?)\b/g, "").trim();
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

// ── Per-location scoring (pure) ──────────────────────────────────────────────

// A force location is "active" now unless its presence window has ended.
export function isForceLocationActive(loc: ForceLocation, nowMs: number): boolean {
  if (!loc.end) return true;
  const end = Date.parse(`${loc.end}T23:59:59Z`);
  return !Number.isFinite(end) || end >= nowMs;
}

function assessConflict(loc: ForceLocation, ctx: ForceContext): CategoryAssessment {
  const signals: string[] = [];
  let sev: Severity = "green";

  // Structured strikes (ACLED) — precise, highest fidelity when available.
  const strikes = ctx.acled
    .map((e) => ({ e, km: Math.round(haversineKm(loc.lat, loc.lon, e.lat, e.lon)) }))
    .filter((x) => x.km <= 400)
    .sort((a, b) => a.km - b.km);
  for (const { e, km } of strikes.slice(0, 2)) {
    signals.push(`${e.subType || "Strike"} ~${km}km${e.fatalities > 0 ? ` (${e.fatalities} killed)` : ""} [ACLED]`);
    if (km <= 250 || e.fatalities >= 5) sev = worse(sev, "red");
    else sev = worse(sev, "amber");
  }

  // Conflict events (UCDP precise, or ReliefWeb country-level fallback).
  const conflicts = ctx.conflict
    .map((c) => ({ c, km: Math.round(haversineKm(loc.lat, loc.lon, c.lat, c.lon)) }))
    .filter((x) => x.km <= 400)
    .sort((a, b) => a.km - b.km);
  if (strikes.length === 0) {
    for (const { c, km } of conflicts.slice(0, 2)) {
      signals.push(`${c.title || c.name} ~${km}km${c.count > 1 ? ` (${c.count} fatalities)` : ""}`);
      if (km <= 200 && c.count >= 10) sev = worse(sev, "red");
      else sev = worse(sev, "amber");
    }
  }

  // INFORM structural risk (0-10) — baseline even with no live events nearby.
  const inform = ctx.inform.find((p) => countryMatch(p.country, loc.country));
  if (inform) {
    signals.push(`INFORM risk ${inform.score.toFixed(1)}/10`);
    if (inform.score >= 6.5) sev = worse(sev, "red");
    else if (inform.score >= 4.5) sev = worse(sev, "amber");
  }

  return { category: "conflict", severity: sev, signals };
}

function assessWeather(loc: ForceLocation, ctx: ForceContext): CategoryAssessment {
  if (!ctx.live.weather) return { category: "weather", severity: "unknown", signals: ["Weather feeds unavailable — conditions UNKNOWN"] };
  const signals: string[] = [];
  let sev: Severity = "green";

  // Open-Meteo model hazards (worldwide, aviation-relevant: crosswind gusts,
  // IFR/LIFR vis, convection, ice, temp extremes) — keyed by the base label.
  const hz = ctx.hazards.find((h) => h.label === loc.label);
  if (hz) {
    signals.push(...hz.flags);
    sev = worse(sev, hz.severity === "severe" ? "red" : "amber");
  }

  // NWS active alerts (US territory) covering this base.
  for (const t of ctx.threats.filter((x) => x.locations.includes(loc.label)).slice(0, 2)) {
    signals.push(`${t.event}${t.tier === "warning" ? " (warning)" : ""}`);
    sev = worse(sev, t.lifeThreatening || t.severity === "Extreme" ? "red" : "amber");
  }

  // Tropical systems within reach.
  for (const tc of ctx.tropical) {
    if (tc.lat == null || tc.lon == null) continue;
    const km = Math.round(haversineKm(loc.lat, loc.lon, tc.lat, tc.lon));
    if (km > 800) continue;
    signals.push(`${tc.category} ${tc.name} ~${km}km${tc.intensityKt ? ` ${tc.intensityKt}kt` : ""}`);
    sev = worse(sev, km <= 400 ? "red" : "amber");
  }

  return { category: "weather", severity: sev, signals };
}

function assessGps(loc: ForceLocation, ctx: ForceContext): CategoryAssessment {
  // Cardinal rule: feed down ≠ "no interference". Absent data is UNKNOWN.
  if (!ctx.live.gps) return { category: "gps", severity: "unknown", signals: ["GPS interference feed unavailable — status UNKNOWN"] };
  const level = gpsLevelAt(loc.lat, loc.lon, ctx.gps);
  if (level >= 2) return { category: "gps", severity: "red", signals: ["High GPS interference (GPSJam)"] };
  if (level === 1) return { category: "gps", severity: "amber", signals: ["Moderate GPS interference (GPSJam)"] };
  return { category: "gps", severity: "green", signals: [] };
}

function assessCivil(loc: ForceLocation, ctx: ForceContext): CategoryAssessment {
  const signals: string[] = [];
  let sev: Severity = "green";
  // State advisories currently surface only the hot spots (Level 4 / embassy
  // departure). Phase 2 generalizes to all levels + cultural/health overlays.
  const adv = ctx.advisories.find((a) => countryMatch(a.country, loc.country));
  if (adv) {
    if (adv.orderedDeparture) { signals.push(`State: ordered departure (${adv.country})`); sev = "red"; }
    else if (adv.authorizedDeparture) { signals.push(`State: authorized departure (${adv.country})`); sev = "red"; }
    else if (adv.level === 4) { signals.push(`State: Level 4 — Do Not Travel`); sev = worse(sev, "amber"); }
  }
  return { category: "civil", severity: sev, signals };
}

function assessHazard(loc: ForceLocation, ctx: ForceContext): CategoryAssessment {
  const signals: string[] = [];
  let sev: Severity = "green";
  const near = ctx.disasters
    .filter((d) => d.lat != null && d.lon != null)
    .map((d) => ({ d, km: Math.round(haversineKm(loc.lat, loc.lon, d.lat as number, d.lon as number)) }))
    .filter((x) => x.km <= 500)
    .sort((a, b) => a.km - b.km);
  for (const { d, km } of near.slice(0, 2)) {
    signals.push(`${d.type} (${d.severity}) ~${km}km`);
    if (d.severity === "red" && km <= 300) sev = worse(sev, "red");
    else sev = worse(sev, "amber");
  }
  return { category: "hazard", severity: sev, signals };
}

// Rank score within a severity tier: weighted count of category severities so a
// base RED in two categories sorts above one RED in a single category.
function rankScore(categories: CategoryAssessment[]): number {
  return categories.reduce((s, c) => s + SEV_RANK[c.severity] * 20 + c.signals.length, 0);
}

export function assessLocation(loc: ForceLocation, ctx: ForceContext): ForceAssessment {
  const categories = [
    assessConflict(loc, ctx),
    assessWeather(loc, ctx),
    assessGps(loc, ctx),
    assessCivil(loc, ctx),
    assessHazard(loc, ctx),
  ];
  // Composite = worst KNOWN category. If nothing could be checked, the whole
  // location is UNKNOWN (a blind spot), not green.
  const known = categories.filter((c) => c.severity !== "unknown");
  const composite: Severity = known.length === 0 ? "unknown" : known.reduce<Severity>((acc, c) => worse(acc, c.severity), "green");
  // Headline: worst category with a signal (red/amber beat unknown beat green).
  const driver = [...categories]
    .filter((c) => c.signals.length > 0)
    .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity])[0];
  const blind = categories.filter((c) => c.severity === "unknown").map((c) => CATEGORY_LABEL[c.category]);
  const topDriver = composite === "green" && blind.length
    ? `No active signals — blind on ${blind.join(", ")}`
    : driver ? `${CATEGORY_LABEL[driver.category]} — ${driver.signals[0]}` : "No active threat signals";
  return {
    id: loc.id, label: loc.label, country: loc.country, cocom: loc.cocom,
    lat: loc.lat, lon: loc.lon, ...(loc.icao ? { icao: loc.icao } : {}), ...(loc.note ? { note: loc.note } : {}),
    transient: !!(loc.start || loc.end),
    composite, score: rankScore(categories), topDriver, categories,
  };
}

// ── Fetch + assemble ─────────────────────────────────────────────────────────

export async function getForceProtection(locations: ForceLocation[]): Promise<ForceProtectionResult> {
  const active = locations.filter((l) => isForceLocationActive(l, Date.now()));
  const points: NamedPoint[] = active.map((l) => ({ label: l.label, lat: l.lat, lon: l.lon }));

  const [weather, advisories, conflict, acled, inform, gps] = await Promise.all([
    points.length ? getWeatherThreats(points).catch(() => null) : Promise.resolve(null),
    getStateAdvisories().catch(() => []),
    getConflictPoints().catch(() => [] as ConflictPoint[]),
    getAcledEvents().catch(() => [] as AcledEvent[]),
    getInformPoints("risk").catch(() => [] as InformPoint[]),
    getGpsInterference().catch(() => ({ ok: false, hexes: [] as GpsHex[], date: "" })),
  ]);

  // getWeatherThreats already pulls disasters; only fetch separately if it failed.
  const disasters = weather?.disasters ?? (await getDisasters().catch(() => []));

  const ctx: ForceContext = {
    disasters,
    threats: weather?.threats ?? [],
    tropical: weather?.tropical ?? [],
    hazards: weather?.hazards ?? [],
    advisories,
    conflict,
    acled,
    inform,
    gps: gps.hexes,
    // weather is "live" only if the aggregate fetch succeeded (null = failed, but
    // also null when there are no points to query — treat no-points as live so a
    // location with no ICAO/coords issue isn't falsely UNKNOWN).
    live: { weather: points.length === 0 || weather !== null, gps: gps.ok },
  };

  const assessments = active
    .map((l) => assessLocation(l, ctx))
    .sort((a, b) => SEV_RANK[b.composite] - SEV_RANK[a.composite] || b.score - a.score);

  return {
    assessments,
    generatedAt: new Date().toISOString(),
    sources: {
      gps: gps.ok,
      acled: acled.length > 0,
      conflict: conflict.length === 0 ? "none" : (conflict[0].src === "reliefweb" ? "reliefweb" : "ucdp"),
    },
  };
}
