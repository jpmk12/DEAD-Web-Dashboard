// Mission Profile — the "tell the app what you command" layer. PURE data +
// math (client-safe, unit-tested): the user declares home station, theaters,
// and named Areas of Interest; deriveTracking() turns that into the concrete
// tracking lists every feature already reads (countries of interest, force
// locations, SITREP candidates, weather points, METAR stations, watchlist
// seeds, warning-problem seeds). The server-side materializer
// (lib/missionProfileApply.ts) merges the derivation into user_prefs.
//
// Architecture decision (see the review doc): derive-and-materialize, NOT a
// storage rewrite. Derived items carry an "mp-" id prefix so every editor can
// badge AUTO vs MANUAL rows; deleting a derived item anywhere records an
// exclusion at the next apply (missing previously-materialized id ⇒ excluded),
// so the profile never resurrects what the user removed.

import { classifyAor, type Aor } from "./aor";
import { ALL_AIRFIELDS, type MobilityAirfield } from "./airfields";
import { CHOKEPOINTS, type Chokepoint } from "./chokepoints";
import { countryCentroid } from "./countryCentroids";
import type { CountryWatch, ForceLocation, TrackedLocation, MetarStation, SitrepBase } from "./types";

export interface MissionAoi {
  id: string;                       // slug, e.g. "iran-hormuz"
  name: string;                     // "Iran & Hormuz"
  aor: Aor;                         // owning COCOM
  countries: string[];              // display names
  intensity: "primary" | "watch";   // primary ⇒ SITREP candidates + I&W board
  iw: boolean;                      // instantiate an I&W warning board (primary only)
  chokepointIds: string[];          // from CHOKEPOINTS; auto-suggested, editable
}

export interface MissionProfile {
  homeIcao: string;                 // "" = unset
  theaters: Aor[];                  // COCOMs the user owns
  aois: MissionAoi[];
  excludedIds: string[];            // derived ids the user removed — never re-materialize
  materializedIds: string[];        // ids written at last apply (drift → exclusions)
  updatedAt?: string;               // ISO, set server-side
}

export const EMPTY_PROFILE: MissionProfile = {
  homeIcao: "", theaters: [], aois: [], excludedIds: [], materializedIds: [],
};

// Everything one apply writes, grouped for the review screen.
export interface DerivedTracking {
  countries: CountryWatch[];        // ids mp-c-*
  bases: ForceLocation[];           // ids mp-b-*
  weatherPoints: TrackedLocation[]; // ids mp-w-*
  metarStations: MetarStation[];
  sitrepCandidates: SitrepBase[];   // home + per-primary-AOI picks, ≤4 suggested
  watchlistSeeds: string[];
  // Phase-2 consumers (I&W templating); derived now so the review shows them.
  warningProblems: { id: string; name: string; aor: Aor; countries: string[]; chokepointId: string | null }[];
}

const VALID_AORS: Aor[] = ["NORTHCOM", "SOUTHCOM", "EUCOM", "CENTCOM", "AFRICOM", "INDOPACOM"];
const MAX_AOIS = 8;
const MAX_AOI_COUNTRIES = 25;
const BASES_PER_AOI = 6;
const NEAR_BASE_KM = 1800;          // "supports this AOI" radius for theater hubs
const NEAR_CHOKE_KM = 2500;         // chokepoint relevance radius
export const SITREP_MAX = 4;

export const slugify = (s: string): string =>
  s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "aoi";

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const titleCase = (s: string): string =>
  s.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, "of").replace(/\bAnd\b/g, "and");

// ── Sanitizer (route + storage guard) ───────────────────────────────────────
export function sanitizeMissionProfile(raw: unknown): MissionProfile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_PROFILE };
  const r = raw as Record<string, unknown>;
  const strArr = (v: unknown, cap: number, maxLen = 80): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, maxLen)).slice(0, cap) : [];
  const aois: MissionAoi[] = [];
  if (Array.isArray(r.aois)) {
    for (const a of r.aois.slice(0, MAX_AOIS)) {
      if (!a || typeof a !== "object") continue;
      const o = a as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name.trim().slice(0, 60) : "";
      if (!name) continue;
      const aor = VALID_AORS.includes(o.aor as Aor) ? (o.aor as Aor) : "UNKNOWN" as Aor;
      const chokeIds = new Set(CHOKEPOINTS.map((c) => c.id));
      aois.push({
        id: typeof o.id === "string" && o.id ? slugify(o.id) : slugify(name),
        name,
        aor,
        countries: strArr(o.countries, MAX_AOI_COUNTRIES, 60),
        intensity: o.intensity === "watch" ? "watch" : "primary",
        iw: o.iw !== false,
        chokepointIds: strArr(o.chokepointIds, 4, 24).filter((id) => chokeIds.has(id)),
      });
    }
  }
  // Dedupe AOI ids (second occurrence gets a suffix).
  const seen = new Set<string>();
  for (const a of aois) {
    let id = a.id, n = 2;
    while (seen.has(id)) id = `${a.id}-${n++}`;
    a.id = id; seen.add(id);
  }
  return {
    homeIcao: typeof r.homeIcao === "string" ? r.homeIcao.trim().toUpperCase().slice(0, 4) : "",
    theaters: strArr(r.theaters, 6, 12).filter((t): t is Aor => VALID_AORS.includes(t as Aor)),
    aois,
    excludedIds: strArr(r.excludedIds, 400, 60),
    materializedIds: strArr(r.materializedIds, 400, 60),
    ...(typeof r.updatedAt === "string" ? { updatedAt: r.updatedAt } : {}),
  };
}

// ── Suggestions ─────────────────────────────────────────────────────────────
// Chokepoints within reach of an AOI's countries, nearest first.
export function suggestChokepoints(countries: string[]): Chokepoint[] {
  const cens = countries.map((c) => countryCentroid(c)).filter((x): x is [number, number] => x != null);
  if (!cens.length) return [];
  return CHOKEPOINTS
    .map((cp) => ({ cp, km: Math.min(...cens.map(([la, lo]) => haversineKm(la, lo, cp.lat, cp.lon))) }))
    .filter((x) => x.km <= NEAR_CHOKE_KM)
    .sort((a, b) => a.km - b.km)
    .map((x) => x.cp);
}

// ── The derivation ──────────────────────────────────────────────────────────
export function deriveTracking(profile: MissionProfile): DerivedTracking {
  const excluded = new Set(profile.excludedIds);
  const countries: CountryWatch[] = [];
  const bases: ForceLocation[] = [];
  const seenCountry = new Set<string>();
  const seenBase = new Set<string>();
  const watchlistSeeds: string[] = [];
  const warningProblems: DerivedTracking["warningProblems"] = [];

  for (const aoi of profile.aois) {
    // Countries → posture watch.
    for (const c of aoi.countries) {
      const key = c.trim().toLowerCase();
      if (!key || seenCountry.has(key)) continue;
      seenCountry.add(key);
      const id = `mp-c-${slugify(c)}`;
      if (excluded.has(id)) continue;
      countries.push({ id, country: titleCase(key), cocom: classifyAor({ name: c }), note: `AOI: ${aoi.name}` });
    }

    // Bases: curated hubs/gateways in the AOI's countries, or in-theater within
    // reach of the AOI's country centroids. AMC hubs outrank gateways; then by
    // proximity to the AOI.
    const cens = aoi.countries.map((c) => countryCentroid(c)).filter((x): x is [number, number] => x != null);
    const cSet = new Set(aoi.countries.map((c) => c.trim().toLowerCase()));
    const scored: { a: MobilityAirfield; km: number }[] = [];
    for (const a of ALL_AIRFIELDS) {
      const km = cens.length ? Math.min(...cens.map(([la, lo]) => haversineKm(la, lo, a.lat, a.lon))) : Infinity;
      const inCountry = !!a.country && cSet.has(a.country.trim().toLowerCase());
      const inTheaterNear = classifyAor({ lat: a.lat, lon: a.lon }) === aoi.aor && km <= NEAR_BASE_KM;
      if (inCountry || inTheaterNear) scored.push({ a, km: inCountry ? Math.min(km, 0) : km });
    }
    scored.sort((x, y) =>
      (x.a.kind === "amc-hub" ? 0 : 1) - (y.a.kind === "amc-hub" ? 0 : 1) || x.km - y.km);
    for (const { a } of scored.slice(0, BASES_PER_AOI)) {
      if (seenBase.has(a.icao)) continue;
      seenBase.add(a.icao);
      const id = `mp-b-${a.icao}`;
      if (excluded.has(id)) continue;
      bases.push({
        id, label: a.name, icao: a.icao, lat: a.lat, lon: a.lon,
        country: a.country ?? "", cocom: classifyAor({ lat: a.lat, lon: a.lon }),
        kind: "base", note: `AOI: ${aoi.name}`,
      });
    }

    // Watchlist seeds: the AOI's name + its chokepoints.
    watchlistSeeds.push(aoi.name);
    for (const cid of aoi.chokepointIds) {
      const cp = CHOKEPOINTS.find((c) => c.id === cid);
      if (cp) watchlistSeeds.push(cp.name);
    }

    // Warning board per primary AOI that wants one (Phase-2 consumer).
    if (aoi.intensity === "primary" && aoi.iw) {
      warningProblems.push({
        id: `mp-${aoi.id}`, name: aoi.name, aor: aoi.aor,
        countries: [...aoi.countries], chokepointId: aoi.chokepointIds[0] ?? null,
      });
    }
  }

  // Weather points + METAR stations follow the derived bases.
  const weatherPoints: TrackedLocation[] = bases.slice(0, 8)
    .map((b) => ({ id: `mp-w-${b.icao}`, label: b.label, lat: b.lat, lon: b.lon }))
    .filter((w) => !excluded.has(w.id));
  const metarStations: MetarStation[] = bases
    .filter((b) => !!b.icao)
    .map((b) => ({ icao: b.icao as string, label: b.label }));

  // SITREP candidates: home station first, then per-primary-AOI best hubs.
  const sitrepCandidates: SitrepBase[] = [];
  const sitSeen = new Set<string>();
  const home = profile.homeIcao ? ALL_AIRFIELDS.find((a) => a.icao === profile.homeIcao) : undefined;
  if (home) {
    sitSeen.add(home.icao);
    sitrepCandidates.push({ icao: home.icao, label: home.name, lat: home.lat, lon: home.lon, country: home.country ?? "United States", place: home.name });
  }
  for (const aoi of profile.aois.filter((a) => a.intensity === "primary")) {
    for (const b of bases.filter((x) => x.note === `AOI: ${aoi.name}`).slice(0, 2)) {
      if (!b.icao || sitSeen.has(b.icao) || sitrepCandidates.length >= SITREP_MAX + 2) continue;
      sitSeen.add(b.icao);
      sitrepCandidates.push({ icao: b.icao, label: b.label, lat: b.lat, lon: b.lon, country: b.country, place: b.label });
    }
  }

  return {
    countries, bases, weatherPoints, metarStations, sitrepCandidates,
    watchlistSeeds: [...new Set(watchlistSeeds)],
    warningProblems,
  };
}

// All ids a derivation would materialize — used for exclusion drift detection.
export function derivedIds(d: DerivedTracking): string[] {
  return [
    ...d.countries.map((c) => c.id),
    ...d.bases.map((b) => b.id),
    ...d.weatherPoints.map((w) => w.id),
  ];
}

export const isDerivedId = (id: string): boolean => id.startsWith("mp-");
