// Tracking operations — SERVER-ONLY. Loads the prefs + profile, runs the
// PURE planner (lib/trackingRegistry.ts), saves both rows, and drops every
// cache that reads the tracking lists. The route (/api/track) is a thin
// wrapper; nothing here decides what tracking MEANS — that is the planner.

import { getUserPrefs, saveUserPrefs } from "./userPrefs";
import { getMissionProfile, saveMissionProfile } from "./missionProfileApply";
import {
  buildRegistry, planTrack, planRestore,
  type TrackingRegistry, type TrackingPrefs, type TrackRequest, type TrackRoles, type TrackPlan,
} from "./trackingRegistry";
import { resolveAirfield } from "./resolveAirfield";
import { ALL_AIRFIELDS } from "./airfields";
import { centroidCountryNames } from "./countryCentroids";
import { knownCountryNames, normalizeCountryName, sameCountry } from "./countryNames";
import { classifyAor, type Aor } from "./aor";
import { resetCommandsCache } from "./commandsAssemble";
import { resetForceProtectionCache } from "./forceProtectionCached";
import { resetSitrepCache } from "./sitrep";
import { clearBriefingCache } from "./briefingCache";
import type { UserPrefs } from "./types";

const pick = (p: UserPrefs): TrackingPrefs => ({
  forceLocations: p.forceLocations, countriesOfInterest: p.countriesOfInterest, metarStations: p.metarStations,
  sitrepBases: p.sitrepBases, trackedLocations: p.trackedLocations, watchlist: p.watchlist,
});

export async function getTrackingRegistry(): Promise<TrackingRegistry> {
  const [prefs, profile] = await Promise.all([getUserPrefs(), getMissionProfile()]);
  return buildRegistry(pick(prefs), profile);
}

/** One row the picker can offer. Roles are the CURRENT roles (all false when untracked). */
export interface TrackCandidate {
  kind: "airfield" | "country";
  icao?: string;
  label: string;
  lat?: number;
  lon?: number;
  country: string;
  aor: Aor;
  roles: TrackRoles;
  own?: "hub" | "spoke" | null;
  tracked: boolean;
  source: "tracked" | "catalogue" | "ourairports" | "countries";
}

const NONE: TrackRoles = { posture: false, metar: false, sitrep: false, star: false };

/**
 * Resolve a free-text query to airfield + country candidates. An exact ICAO
 * is resolved through the shared door (curated → OurAirports); names are
 * matched against the curated catalogue, what is already tracked, and the
 * country name pool. Places (civil weather points) are geocoded by the
 * client through /api/osint/geocode — a separate, rate-limited upstream.
 */
export async function searchTrackCandidates(qRaw: string, registry?: TrackingRegistry): Promise<TrackCandidate[]> {
  const q = qRaw.trim();
  if (q.length < 2) return [];
  const reg = registry ?? await getTrackingRegistry();
  const ql = q.toLowerCase();
  const out: TrackCandidate[] = [];
  const seenIcao = new Set<string>();
  const seenCountry = new Set<string>();

  const pushAirfield = (c: Omit<TrackCandidate, "kind" | "roles" | "tracked" | "own"> & { icao: string }) => {
    const icao = c.icao.toUpperCase();
    if (seenIcao.has(icao)) return;
    seenIcao.add(icao);
    const have = reg.airfields.find((a) => a.icao === icao);
    out.push({
      ...c, kind: "airfield", icao,
      lat: have?.lat || c.lat, lon: have?.lon || c.lon,
      roles: have?.roles ?? NONE, own: have?.own ?? null, tracked: !!have,
      source: have ? "tracked" : c.source,
    });
  };

  // Exact ICAO first.
  if (/^[a-z0-9]{4}$/i.test(q)) {
    const r = await resolveAirfield(q).catch(() => null);
    if (r) pushAirfield({ icao: r.icao, label: r.label, lat: r.lat, lon: r.lon, country: normalizeCountryName(r.country), aor: classifyAor({ lat: r.lat, lon: r.lon }), source: "catalogue" });
  }
  // Already-tracked fields whose label/ICAO matches.
  for (const a of reg.airfields) {
    if (!a.icao) continue;
    if (a.icao.toLowerCase().includes(ql) || a.label.toLowerCase().includes(ql)) {
      pushAirfield({ icao: a.icao, label: a.label, lat: a.lat, lon: a.lon, country: a.country, aor: a.aor, source: "tracked" });
    }
  }
  // Curated catalogue by name / ICAO / country.
  for (const a of ALL_AIRFIELDS) {
    if (out.filter((c) => c.kind === "airfield").length >= 8) break;
    const country = normalizeCountryName(a.country);
    if (a.icao.toLowerCase().includes(ql) || a.name.toLowerCase().includes(ql) || (country && country.toLowerCase().includes(ql))) {
      pushAirfield({ icao: a.icao, label: a.name, lat: a.lat, lon: a.lon, country, aor: classifyAor({ lat: a.lat, lon: a.lon }), source: "catalogue" });
    }
  }

  // Countries: the name pool (ISO table + aliases + centroid catalogue).
  const pool = knownCountryNames(centroidCountryNames());
  const ranked = pool
    .map((name) => ({ name, rank: name.toLowerCase() === ql ? 0 : name.toLowerCase().startsWith(ql) ? 1 : name.toLowerCase().includes(ql) ? 2 : 9 }))
    .filter((x) => x.rank < 9)
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .slice(0, 6);
  for (const { name } of ranked) {
    const k = name.toLowerCase();
    if (seenCountry.has(k)) continue;
    seenCountry.add(k);
    const have = reg.countries.find((c) => sameCountry(c.country, name));
    out.push({
      kind: "country", label: name, country: name, aor: classifyAor({ name }),
      roles: { ...NONE, posture: !!have?.roles.posture, star: !!have?.roles.star },
      tracked: !!have, source: have ? "tracked" : "countries",
    });
  }
  return out;
}

export interface TrackOutcome {
  changes: string[];
  warnings: string[];
  undo: TrackRequest | null;
  registry: TrackingRegistry;
}

/** The raw body of a track request — the server fills in what the planner needs. */
export interface TrackBody {
  kind?: unknown; icao?: unknown; label?: unknown; lat?: unknown; lon?: unknown; country?: unknown; place?: unknown;
  roles?: unknown; remove?: unknown;
}

function asRoles(v: unknown, keys: (keyof TrackRoles)[]): Partial<TrackRoles> {
  const out: Partial<TrackRoles> = {};
  if (!v || typeof v !== "object") return out;
  for (const k of keys) {
    const x = (v as Record<string, unknown>)[k];
    if (typeof x === "boolean") out[k] = x;
  }
  return out;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Validate a body into a TrackRequest. An airfield request may carry only an
 * ICAO — coordinates and label are resolved here when absent, so every
 * caller (a map popup, a board row, the picker) can send the same one-liner.
 * Returns a string reason when the request cannot be built.
 */
export async function buildTrackRequest(body: TrackBody): Promise<TrackRequest | string> {
  if (body.kind === "place") {
    const label = String(body.label ?? "").trim().slice(0, 60);
    const lat = num(body.lat), lon = num(body.lon);
    if (!label) return "A place needs a label";
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return "A place needs coordinates";
    return { kind: "place", label, lat, lon, ...(body.remove === true ? { remove: true } : {}) };
  }
  if (body.kind === "country") {
    const country = normalizeCountryName(String(body.country ?? ""));
    if (!country) return "A country name is required";
    return { kind: "country", country, roles: asRoles(body.roles, ["posture", "star"]) };
  }
  if (body.kind === "airfield") {
    const icao = String(body.icao ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(icao)) return "A valid 4-character ICAO is required";
    const roles = asRoles(body.roles, ["posture", "metar", "sitrep", "star"]);
    if (!Object.keys(roles).length) return "No role given (posture / metar / sitrep / star)";
    let lat = num(body.lat), lon = num(body.lon);
    let label = String(body.label ?? "").trim().slice(0, 60);
    let country = normalizeCountryName(String(body.country ?? ""));
    let place = String(body.place ?? "").trim().slice(0, 120);
    if (lat == null || lon == null || !label) {
      // Already tracked? Its own record knows the coordinates.
      const reg = await getTrackingRegistry();
      const have = reg.airfields.find((a) => a.icao === icao && (a.lat || a.lon));
      if (have) { lat = lat ?? have.lat; lon = lon ?? have.lon; label = label || have.label; country = country || have.country; }
      else {
        const r = await resolveAirfield(icao).catch(() => null);
        if (!r) {
          // Pure removals of a field nobody can resolve still work (nothing
          // to look up) — the planner only needs coordinates to ADD.
          const adding = Object.values(roles).some(Boolean);
          if (adding) return `${icao} not found in hubs, gateways, or OurAirports`;
          lat = lat ?? 0; lon = lon ?? 0; label = label || icao;
        } else {
          lat = lat ?? r.lat; lon = lon ?? r.lon; label = label || r.label; country = country || normalizeCountryName(r.country); place = place || r.place;
        }
      }
    }
    return { kind: "airfield", icao, label, lat: lat as number, lon: lon as number, country, ...(place ? { place } : {}), roles };
  }
  return "kind must be airfield | country | place";
}

async function commit(plan: TrackPlan, prefs: UserPrefs): Promise<TrackOutcome> {
  if (plan.changes.length) {
    await saveUserPrefs({ ...prefs, ...plan.prefs });
    await saveMissionProfile(plan.profile);
    resetCommandsCache();
    resetForceProtectionCache();
    resetSitrepCache();
    clearBriefingCache().catch(() => {});
  }
  const registry = buildRegistry(plan.prefs, plan.profile);
  return { changes: plan.changes, warnings: plan.warnings, undo: plan.undo, registry };
}

export async function applyTrackRequest(req: TrackRequest): Promise<TrackOutcome> {
  const [prefs, profile] = await Promise.all([getUserPrefs(), getMissionProfile()]);
  return commit(planTrack(pick(prefs), profile, req), prefs);
}

export async function restoreExclusion(id: string): Promise<TrackOutcome> {
  const [prefs, profile] = await Promise.all([getUserPrefs(), getMissionProfile()]);
  return commit(planRestore(pick(prefs), profile, id), prefs);
}
