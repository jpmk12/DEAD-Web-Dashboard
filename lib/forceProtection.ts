// Force Protection Watch — fuses the threat layers the app already collects into
// a per-location posture for the bases/locations where the user's forces fly &
// operate (UserPrefs.forceLocations). Answers "where are my people & tails, and
// which spots need my attention today?" across combatant commands.
//
// Design: assessLocation() is PURE (takes pre-fetched context) so the scoring
// thresholds are unit-tested without the network; getForceProtection() fetches
// the shared context once and maps every location through it. No new external
// feeds in Phase 1 — every source here is already used by the Crisis map.

import type { ForceLocation, CountryWatch, DisasterEvent, SevereThreat, TropicalSystem, LocationHazard, TravelAdvisory } from "./types";
import { countryCentroid } from "./countryCentroids";
import type { ConflictPoint } from "./conflictEvents";
import type { AcledEvent } from "./acled";
import type { InformPoint } from "./inform";
import type { GpsHex } from "./gpsjam";
import { haversineKm, getDisasters } from "./disasters";
import { getWeatherThreats, type NamedPoint } from "./severeWeather";
import { getConflictPoints } from "./conflictEvents";
import { getAcledEvents } from "./acled";
import { getInformPoints } from "./inform";
import { getGpsInterference, gpsLevelAt } from "./gpsjam";
import { getFlightCategories, type AviationWx } from "./aviationWx";
import { getNotams, type Notam } from "./notams";
import { getAllStateAdvisories } from "./stateAdvisories";
import { civilCalendarEvents } from "./civilCalendar";
import { getHealthEvents, type HealthEvent } from "./health";

export type Severity = "green" | "amber" | "red" | "unknown";
export type ForceCategory = "conflict" | "weather" | "gps" | "airspace" | "civil" | "hazard";

export const CATEGORY_LABEL: Record<ForceCategory, string> = {
  conflict: "Conflict",
  weather: "Aviation Wx",
  gps: "GPS / Comms",
  airspace: "Airspace / NOTAM",
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
  kind: "country" | "base";  // country of interest vs pinned base
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
  aviation: Record<string, AviationWx>; // decoded METAR flight category, keyed by ICAO
  notams: Record<string, Notam[]>;      // NOTAMs keyed by ICAO (DAIP)
  notamsConfigured: boolean;            // DoD CA bundle present → airspace category enabled
  health: HealthEvent[];                // WHO Disease Outbreak News
  nowMs: number;                        // evaluation time (civil calendar lookahead)
  // Per-source liveness: distinguishes "checked, clean" from "couldn't check".
  // A category whose source(s) weren't live scores UNKNOWN, never green — so a
  // downed feed never reads as "all clear" (the cardinal safety rule). Sources
  // that can't tell down-from-empty (conflict/advisories/etc. swallow errors to
  // []) are best-effort and assumed live; gps/weather/notams report real liveness.
  live: { weather: boolean; gps: boolean; notams: boolean };
}

export interface ForceProtectionResult {
  assessments: ForceAssessment[];
  generatedAt: string;
  sources: { gps: boolean; acled: boolean; aviationWx: boolean; notams: "live" | "down" | "off"; conflict: "ucdp" | "reliefweb" | "none" };
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
  const byCountry = (loc.kind ?? "base") === "country";

  // Structured strikes (ACLED) — precise, highest fidelity when available.
  // Country watch: every in-country event; base: only those within ~400 km.
  const strikes = byCountry
    ? ctx.acled.filter((e) => countryMatch(e.country, loc.country)).map((e) => ({ e, km: null as number | null }))
    : ctx.acled.map((e) => ({ e, km: Math.round(haversineKm(loc.lat, loc.lon, e.lat, e.lon)) as number | null }))
        .filter((x) => (x.km as number) <= 400).sort((a, b) => (a.km as number) - (b.km as number));
  const topStrikes = byCountry ? [...strikes].sort((a, b) => b.e.fatalities - a.e.fatalities) : strikes;
  for (const { e, km } of topStrikes.slice(0, 2)) {
    signals.push(`${e.subType || "Strike"}${km != null ? ` ~${km}km` : ` (${e.country})`}${e.fatalities > 0 ? ` ${e.fatalities} killed` : ""} [ACLED]`);
    if ((km != null && km <= 250) || e.fatalities >= 5) sev = worse(sev, "red");
    else sev = worse(sev, "amber");
  }

  // Conflict events (UCDP precise points, or ReliefWeb country-level fallback).
  if (strikes.length === 0) {
    const conflicts = byCountry
      ? ctx.conflict.filter((c) => countryMatch(c.name, loc.country) || (c.title ? countryMatch(c.title, loc.country) : false)).map((c) => ({ c, km: null as number | null }))
      : ctx.conflict.map((c) => ({ c, km: Math.round(haversineKm(loc.lat, loc.lon, c.lat, c.lon)) as number | null }))
          .filter((x) => (x.km as number) <= 400).sort((a, b) => (a.km as number) - (b.km as number));
    for (const { c, km } of conflicts.slice(0, 2)) {
      signals.push(`${c.title || c.name}${km != null ? ` ~${km}km` : ""}${c.count > 1 ? ` (${c.count} fatalities)` : ""}`);
      if (((km != null && km <= 200) || byCountry) && c.count >= 10) sev = worse(sev, "red");
      else sev = worse(sev, "amber");
    }
  }

  // INFORM structural risk (0-10) — baseline even with no live events.
  const inform = ctx.inform.find((p) => countryMatch(p.country, loc.country));
  if (inform) {
    signals.push(`INFORM risk ${inform.score.toFixed(1)}/10`);
    if (inform.score >= 6.5) sev = worse(sev, "red");
    else if (inform.score >= 4.5) sev = worse(sev, "amber");
  }

  return { category: "conflict", severity: sev, signals };
}

const FLIGHT_CAT_SEV: Record<string, Severity> = { LIFR: "red", IFR: "amber", MVFR: "amber", VFR: "green", UNKNOWN: "green" };

function assessWeather(loc: ForceLocation, ctx: ForceContext): CategoryAssessment {
  if (!ctx.live.weather) return { category: "weather", severity: "unknown", signals: ["Weather feeds unavailable — conditions UNKNOWN"] };
  const signals: string[] = [];
  let sev: Severity = "green";

  // Current observed flight category at the base (decoded METAR) — the most
  // direct "can we shoot the approach" read when an ICAO is set. MVFR is a soft
  // amber; IFR amber; LIFR red.
  if (loc.icao) {
    const wx = ctx.aviation[loc.icao.toUpperCase()];
    if (wx && wx.flightCategory !== "VFR" && wx.flightCategory !== "UNKNOWN") {
      const bits = [
        wx.ceilingFt != null ? `ceil ${wx.ceilingFt}ft` : null,
        wx.visMi != null ? `vis ${wx.visMi}sm` : null,
        wx.gustKt != null ? `gust ${wx.gustKt}kt` : (wx.windKt != null ? `wind ${wx.windKt}kt` : null),
      ].filter(Boolean);
      signals.push(`${wx.flightCategory}${bits.length ? ` (${bits.join(", ")})` : ""}`);
      sev = worse(sev, FLIGHT_CAT_SEV[wx.flightCategory] ?? "amber");
    }
  }

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
  // Two complementary sources: GPSJam = OBSERVED interference; RAIM NOTAMs =
  // PREDICTED outages. Cardinal rule: a down feed is UNKNOWN, never "clear".
  const raimNotams = loc.icao ? (ctx.notams[loc.icao.toUpperCase()] ?? []).filter((n) => n.category === "gps_raim") : [];
  const signals: string[] = [];
  let sev: Severity = "green";

  // Observed (GPSJam).
  if (ctx.live.gps) {
    const level = gpsLevelAt(loc.lat, loc.lon, ctx.gps);
    if (level >= 2) { signals.push("High GPS interference (GPSJam)"); sev = worse(sev, "red"); }
    else if (level === 1) { signals.push("Moderate GPS interference (GPSJam)"); sev = worse(sev, "amber"); }
  }

  // Predicted (RAIM NOTAMs) — only meaningful when NOTAMs are live.
  if (ctx.live.notams && loc.icao) {
    for (const n of raimNotams.slice(0, 2)) {
      const w = n.raimWindows?.length ? ` ${n.raimWindows.join(", ")}` : "";
      signals.push(`RAIM outage NOTAM${w}`);
      sev = worse(sev, "amber");
    }
  }

  // Liveness: if BOTH the observed feed and (when configured) the NOTAM feed are
  // down, we genuinely couldn't check → UNKNOWN. If GPSJam is down but NOTAMs are
  // live (or vice-versa) we still have a partial read; flag the gap in a signal.
  const gpsBlind = !ctx.live.gps;
  const raimBlind = ctx.notamsConfigured && !ctx.live.notams;
  if (gpsBlind && (raimBlind || !ctx.notamsConfigured)) {
    return { category: "gps", severity: "unknown", signals: ["GPS interference feed unavailable — status UNKNOWN (check FAA SAPT for RAIM)"] };
  }
  if (gpsBlind) signals.push("Observed-interference feed down — RAIM only");
  else if (raimBlind) signals.push("RAIM NOTAM feed down — observed only");
  return { category: "gps", severity: sev, signals };
}

const NOTAM_SEV: Partial<Record<Notam["category"], Severity>> = { runway: "red", approach: "amber", airspace: "amber", obstacle: "amber" };

function assessAirspace(loc: ForceLocation, ctx: ForceContext): CategoryAssessment {
  // Only present when NOTAMs are configured (else omitted, not a blind spot).
  if (!ctx.live.notams) return { category: "airspace", severity: "unknown", signals: ["NOTAM feed unavailable — airfield/airspace status UNKNOWN"] };
  const list = loc.icao ? (ctx.notams[loc.icao.toUpperCase()] ?? []) : [];
  const signals: string[] = [];
  let sev: Severity = "green";
  for (const n of list.filter((x) => x.category in NOTAM_SEV).slice(0, 3)) {
    const s = NOTAM_SEV[n.category] ?? "amber";
    sev = worse(sev, s);
    if (n.category === "runway" && n.runwaysClosed?.length) signals.push(`RWY ${n.runwaysClosed.join(", ")} CLSD`);
    else signals.push(n.text.replace(/\s+/g, " ").slice(0, 90));
  }
  return { category: "airspace", severity: sev, signals };
}

function assessCivil(loc: ForceLocation, ctx: ForceContext): CategoryAssessment {
  const signals: string[] = [];
  let sev: Severity = "green";
  // State advisory level for the base country (all levels available now).
  const adv = ctx.advisories.find((a) => countryMatch(a.country, loc.country));
  if (adv) {
    if (adv.orderedDeparture) { signals.push(`State: ordered departure (${adv.country})`); sev = worse(sev, "red"); }
    else if (adv.authorizedDeparture) { signals.push(`State: authorized departure (${adv.country})`); sev = worse(sev, "red"); }
    else if (adv.level === 4) { signals.push("State: Level 4 — Do Not Travel"); sev = worse(sev, "amber"); }
    else if (adv.level === 3) { signals.push("State: Level 3 — Reconsider Travel"); sev = worse(sev, "amber"); }
  }
  // Cultural / civil calendar — observances, national days, elections that raise
  // force-protection posture or sensitivity (amber; they're context, not threats).
  if (loc.country) {
    for (const e of civilCalendarEvents(loc.country, ctx.nowMs).slice(0, 2)) {
      signals.push(e.active ? `${e.label} — active` : `${e.label} in ${e.daysUntil}d`);
      sev = worse(sev, "amber");
    }
  }
  return { category: "civil", severity: sev, signals };
}

function assessHazard(loc: ForceLocation, ctx: ForceContext): CategoryAssessment {
  const signals: string[] = [];
  let sev: Severity = "green";
  const byCountry = (loc.kind ?? "base") === "country";
  // Country watch: disasters whose country matches; base: those within ~500 km.
  const near = byCountry
    ? ctx.disasters.filter((d) => d.country && countryMatch(d.country, loc.country)).map((d) => ({ d, km: null as number | null }))
    : ctx.disasters.filter((d) => d.lat != null && d.lon != null)
        .map((d) => ({ d, km: Math.round(haversineKm(loc.lat, loc.lon, d.lat as number, d.lon as number)) as number | null }))
        .filter((x) => (x.km as number) <= 500).sort((a, b) => (a.km as number) - (b.km as number));
  for (const { d, km } of near.slice(0, 2)) {
    signals.push(`${d.type} (${d.severity})${km != null ? ` ~${km}km` : ""}`);
    if (d.severity === "red" && (km == null || km <= 300)) sev = worse(sev, "red");
    else sev = worse(sev, "amber");
  }
  // WHO Disease Outbreak News in the base country — force-health posture (amber).
  for (const h of ctx.health.filter((e) => countryMatch(e.country, loc.country)).slice(0, 2)) {
    signals.push(`WHO: ${h.disease} outbreak (${h.country})`);
    sev = worse(sev, "amber");
  }
  return { category: "hazard", severity: sev, signals };
}

// Rank score within a severity tier: weighted count of category severities so a
// base RED in two categories sorts above one RED in a single category.
function rankScore(categories: CategoryAssessment[]): number {
  return categories.reduce((s, c) => s + SEV_RANK[c.severity] * 20 + c.signals.length, 0);
}

export function assessLocation(loc: ForceLocation, ctx: ForceContext): ForceAssessment {
  // Airfield-specific categories (aviation wx, GPS, airspace/NOTAM) only apply
  // when an ICAO is given — i.e. a pinned base. A country watch is scored purely
  // from country-keyed sources (conflict, civil/diplomatic, hazard).
  const hasAirfield = !!loc.icao;
  const categories = [
    assessConflict(loc, ctx),
    ...(hasAirfield ? [assessWeather(loc, ctx), assessGps(loc, ctx)] : []),
    // Airspace/NOTAM needs an airfield AND the DAIP feed configured.
    ...(hasAirfield && ctx.notamsConfigured ? [assessAirspace(loc, ctx)] : []),
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
    id: loc.id, label: loc.label, country: loc.country, cocom: loc.cocom, kind: loc.kind ?? "base",
    lat: loc.lat, lon: loc.lon, ...(loc.icao ? { icao: loc.icao } : {}), ...(loc.note ? { note: loc.note } : {}),
    transient: !!(loc.start || loc.end),
    composite, score: rankScore(categories), topDriver, categories,
  };
}

// ── Fetch + assemble ─────────────────────────────────────────────────────────

// A country of interest as a scoring entry. No coordinates needed (scored by
// country name); centroid is filled best-effort for any future map use.
export function countryToEntry(c: CountryWatch): ForceLocation {
  const cen = countryCentroid(c.country);
  return {
    id: c.id, label: c.country, country: c.country, cocom: c.cocom, kind: "country",
    lat: cen?.[0] ?? 0, lon: cen?.[1] ?? 0, ...(c.note ? { note: c.note } : {}),
  };
}

export async function getForceProtection(countries: CountryWatch[], bases: ForceLocation[] = []): Promise<ForceProtectionResult> {
  const locations: ForceLocation[] = [
    ...countries.map(countryToEntry),
    ...bases.map((b) => ({ ...b, kind: "base" as const })),
  ];
  const active = locations.filter((l) => isForceLocationActive(l, Date.now()));
  // Weather points only for airfield bases (ICAO present) — the only entries
  // whose weather category is scored. Disasters/tropical come globally regardless.
  const points: NamedPoint[] = active.filter((l) => l.icao).map((l) => ({ label: l.label, lat: l.lat, lon: l.lon }));
  const icaos = active.map((l) => l.icao).filter((x): x is string => !!x);

  const [weather, advisories, conflict, acled, inform, gps, aviation, notams, health] = await Promise.all([
    points.length ? getWeatherThreats(points).catch(() => null) : Promise.resolve(null),
    getAllStateAdvisories().catch(() => []),
    getConflictPoints().catch(() => [] as ConflictPoint[]),
    getAcledEvents().catch(() => [] as AcledEvent[]),
    getInformPoints("risk").catch(() => [] as InformPoint[]),
    getGpsInterference().catch(() => ({ ok: false, hexes: [] as GpsHex[], date: "" })),
    getFlightCategories(icaos).catch(() => ({ live: false, byIcao: {} as Record<string, AviationWx> })),
    getNotams(icaos).catch(() => ({ configured: false, live: false, byIcao: {} as Record<string, Notam[]> })),
    getHealthEvents().catch(() => ({ live: false, events: [] as HealthEvent[] })),
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
    aviation: aviation.byIcao,
    notams: notams.byIcao,
    notamsConfigured: notams.configured,
    health: health.events,
    nowMs: Date.now(),
    // weather is "live" if EITHER source returned: the Open-Meteo aggregate
    // (model hazards/alerts) OR the AWC METAR pull. Both down → UNKNOWN, never a
    // false "clear". No points to query also counts as live (nothing to check).
    live: { weather: points.length === 0 || weather !== null || aviation.live, gps: gps.ok, notams: notams.live },
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
      aviationWx: aviation.live && icaos.length > 0,
      notams: !notams.configured ? "off" : (notams.live ? "live" : "down"),
      conflict: conflict.length === 0 ? "none" : (conflict[0].src === "reliefweb" ? "reliefweb" : "ucdp"),
    },
  };
}
