// Mission Profile — the "tell the app what you command" layer. PURE data +
// math (client-safe, unit-tested): the user declares hub/spoke airfields,
// theaters, and named Areas of Interest; deriveTracking() turns that into the
// concrete tracking lists every feature already reads. The server-side
// materializer (lib/missionProfileApply.ts) merges the derivation into
// user_prefs.
//
// ONE CHANNEL PER CONCEPT (the coherence contract):
//   airfields   -> forceLocations (posture/map) + metarStations (aviation wx)
//                  + sitrepBases (deep watch). Airfields are deliberately NOT
//                  materialized into trackedLocations - that list is for CIVIL
//                  places (home, family, TDY spots) and drives forecast cards;
//                  putting bases there double-rendered them on the map, made
//                  blank OCONUS forecast cards, and double-counted them in the
//                  brief alongside the force-protection channel.
//   countries   -> countriesOfInterest (posture watch).
//   chokepoints -> watchlist terms (headline-matchable names only).
//   primary AOI -> I&W warning board.
//
// Architecture decision (see the review doc): derive-and-materialize, NOT a
// storage rewrite. Derived items carry an "mp-" id prefix so every editor can
// badge AUTO vs MANUAL rows; deleting a derived item anywhere records an
// exclusion at the next apply (missing previously-materialized id ⇒ excluded),
// so the profile never resurrects what the user removed.

import { classifyAor, type Aor } from "./aor";
import { ALL_AIRFIELDS, type MobilityAirfield } from "./airfields";
import { CHOKEPOINTS, type Chokepoint } from "./chokepoints";
import { countryCentroid, centroidCountryNames } from "./countryCentroids";
import type { CountryWatch, ForceLocation, MetarStation, SitrepBase } from "./types";

export interface MissionAoi {
  id: string;                       // slug, e.g. "iran-hormuz"
  name: string;                     // "Iran & Hormuz"
  aor: Aor;                         // owning COCOM
  countries: string[];              // display names
  intensity: "primary" | "watch";   // primary ⇒ SITREP candidates + I&W board
  iw: boolean;                      // instantiate an I&W warning board (primary only)
  chokepointIds: string[];          // from CHOKEPOINTS; auto-suggested, editable
}

// An own-force airfield — the hub or a spoke where crews/aircraft live.
// Stored RESOLVED (the editor resolves ICAO → label/coords via
// /api/airfields/resolve at entry time) so derivation stays pure.
export interface MissionSpoke {
  icao: string;
  label: string;
  lat: number;
  lon: number;
  country: string;
}

// Spectrum dependencies — what the force depends on in the electromagnetic
// and space domains (docs/REVIEW-CYBER-SPACE.md §6). Team config, never
// derived into a tracking list, and NEVER sent to a model: missionSummaryLine
// deliberately omits it. Each field is optional; an absent declaration reads
// UNKNOWN on the surfaces that need it, never green.
export interface SpectrumDependencies {
  /** Polar / HF-dependent routes flown. Drives the S-scale and polar-cap
   *  absorption rows. null = not declared. The default is FALSE — this
   *  wing's declaration ("we don't fly polar", 2026-09-30); flip it in
   *  Preferences → Mission Profile if that changes. */
  polarRoutes: boolean | null;
  /** SATCOM in use, free text for the card (e.g. "WGS Ku · Inmarsat L-band"). */
  satcom: string;
  /** Edge-device / host-airport vendors whose KEV entries matter (names only). */
  edgeVendors: string[];
  /** Carry `space_activity` on the boards whose actor launches (China,
   *  Russia, Iran, North Korea). */
  spaceActivity: boolean;
}

export const DEFAULT_SPECTRUM: SpectrumDependencies = { polarRoutes: false, satcom: "", edgeVendors: [], spaceActivity: true };

// Must-tracks — the operator's declaration of what matters MOST (REVIEW-2026-10
// §6, decision 4). Three flat lists keyed the way each surface keys its rows:
// combatant commands by AOR id, countries by display name (case-insensitive
// match), airfields by ICAO. A ★ never ADDS tracking — a country that is not
// in the posture watch stays unwatched and the board says so — it ORDERS and
// PINS: ★ rows sort first and never fold, the primer breaks ties toward ★,
// ★ airfields take the SITREP slots (hub always first), ★ commands always
// have an AOR chip on the map. Team config, owner edits, like the rest of the
// profile.
export interface MustTrack {
  aors: Aor[];
  countries: string[];
  icaos: string[];
}

export const EMPTY_MUST_TRACK: MustTrack = { aors: [], countries: [], icaos: [] };

// The Economy tab's actor register edits (REVIEW-2026-10 §10 E6). The
// register is DERIVED from the tracking picture (AOI countries, watched
// countries, base hosts); this is the operator's overlay on it: `exclude` =
// tracked countries that must not get an actor tile, `add` = actors tracked
// nowhere else. Country display names, case-insensitive. Team config.
export interface EconomyEdits { exclude: string[]; add: string[] }

export const EMPTY_ECONOMY: EconomyEdits = { exclude: [], add: [] };

const MAX_ECONOMY_NAMES = 24;

export function sanitizeEconomyEdits(raw: unknown): EconomyEdits {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { exclude: [], add: [] };
  const r = raw as Record<string, unknown>;
  const names = (v: unknown): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const x of Array.isArray(v) ? v : []) {
      if (typeof x !== "string") continue;
      const t = x.trim().slice(0, 60);
      const k = t.toLowerCase();
      if (!t || seen.has(k)) continue;
      seen.add(k); out.push(t);
      if (out.length >= MAX_ECONOMY_NAMES) break;
    }
    return out;
  };
  return { exclude: names(r.exclude), add: names(r.add) };
}

export interface MissionProfile {
  homeIcao: string;                 // "" = unset (the HUB)
  home?: MissionSpoke | null;       // resolved hub, when the editor resolved it
  spokes: MissionSpoke[];           // hub-and-spoke: other own-force airfields
  theaters: Aor[];                  // COCOMs the user owns
  aois: MissionAoi[];
  spectrum: SpectrumDependencies;   // the spectrum / space declaration
  mustTrack: MustTrack;             // ★ commands / countries / airfields
  economy?: EconomyEdits;           // Economy actor-register overlay (exclude / add)
  excludedIds: string[];            // derived ids the user removed — never re-materialize
  materializedIds: string[];        // ids written at last apply (drift → exclusions)
  updatedAt?: string;               // ISO, set server-side
}

export const EMPTY_PROFILE: MissionProfile = {
  homeIcao: "", spokes: [], theaters: [], aois: [], spectrum: { ...DEFAULT_SPECTRUM }, mustTrack: { aors: [], countries: [], icaos: [] }, excludedIds: [], materializedIds: [],
};

const MAX_VENDORS = 24;
const MAX_STAR_COUNTRIES = 40;
const MAX_STAR_ICAOS = 24;

export function sanitizeMustTrack(raw: unknown): MustTrack {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { aors: [], countries: [], icaos: [] };
  const r = raw as Record<string, unknown>;
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const aors = [...new Set(strs(r.aors).map((a) => a.trim().toUpperCase()).filter((a): a is Aor => VALID_AORS.includes(a as Aor)))];
  const seenC = new Set<string>();
  const countries: string[] = [];
  for (const c of strs(r.countries)) {
    const t = c.trim().slice(0, 60);
    const k = t.toLowerCase();
    if (!t || seenC.has(k)) continue;
    seenC.add(k); countries.push(t);
    if (countries.length >= MAX_STAR_COUNTRIES) break;
  }
  const icaos = [...new Set(strs(r.icaos).map((i) => i.trim().toUpperCase().slice(0, 4)).filter((i) => /^[A-Z0-9]{4}$/.test(i)))].slice(0, MAX_STAR_ICAOS);
  return { aors, countries, icaos };
}

/** Case-insensitive country membership — the one comparison every ★ surface uses. */
export function isStarCountry(mt: MustTrack | undefined, country: string): boolean {
  if (!mt || !country) return false;
  const k = country.trim().toLowerCase();
  return mt.countries.some((c) => c.toLowerCase() === k);
}

/** Toggle one entry; returns a NEW MustTrack (the editor and the board's ★ taps use this). */
export function toggleMustTrack(mt: MustTrack, kind: "aor" | "country" | "icao", value: string): MustTrack {
  if (kind === "aor") {
    const v = value.toUpperCase() as Aor;
    return { ...mt, aors: mt.aors.includes(v) ? mt.aors.filter((a) => a !== v) : [...mt.aors, v] };
  }
  if (kind === "icao") {
    const v = value.toUpperCase();
    return { ...mt, icaos: mt.icaos.includes(v) ? mt.icaos.filter((i) => i !== v) : [...mt.icaos, v] };
  }
  const k = value.trim().toLowerCase();
  return isStarCountry(mt, value)
    ? { ...mt, countries: mt.countries.filter((c) => c.toLowerCase() !== k) }
    : { ...mt, countries: [...mt.countries, value.trim()] };
}

export function sanitizeSpectrum(raw: unknown): SpectrumDependencies {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_SPECTRUM };
  const r = raw as Record<string, unknown>;
  const vendors = Array.isArray(r.edgeVendors)
    ? [...new Set(r.edgeVendors.filter((v): v is string => typeof v === "string").map((v) => v.trim().slice(0, 40)).filter((v) => v.length >= 2))].slice(0, MAX_VENDORS)
    : [];
  return {
    polarRoutes: typeof r.polarRoutes === "boolean" ? r.polarRoutes : r.polarRoutes === null ? null : DEFAULT_SPECTRUM.polarRoutes,
    satcom: typeof r.satcom === "string" ? r.satcom.trim().slice(0, 120) : "",
    edgeVendors: vendors,
    spaceActivity: typeof r.spaceActivity === "boolean" ? r.spaceActivity : DEFAULT_SPECTRUM.spaceActivity,
  };
}

// Everything one apply writes, grouped for the review screen.
export interface DerivedTracking {
  countries: CountryWatch[];        // ids mp-c-*
  bases: ForceLocation[];           // ids mp-b-*
  metarStations: MetarStation[];    // exclusion pseudo-ids mp-m-<ICAO>
  sitrepCandidates: SitrepBase[];   // hub -> spokes -> theater picks
  watchlistSeeds: string[];         // exclusion pseudo-ids mp-t-<slug>
  // Consumed live by lib/warningProblems (one board per primary AOI with iw).
  // `ownHubs` = the declared hub + spokes, so a board's lift sensor reads the
  // operator's OWN fields first (REVIEW-2026-10 §6 O6), not the first eight
  // catalogue entries inside the bbox.
  warningProblems: { id: string; name: string; aor: Aor; countries: string[]; chokepointId: string | null; spaceActivity: boolean; ownHubs: { lat: number; lon: number; icao: string }[] }[];
}

const VALID_AORS: Aor[] = ["NORTHCOM", "SOUTHCOM", "EUCOM", "CENTCOM", "AFRICOM", "INDOPACOM"];
const MAX_AOIS = 8;
const MAX_AOI_COUNTRIES = 25;
const BASES_PER_AOI = 6;
const MAX_SPOKES = 8;
const NEAR_BASE_KM = 1800;          // "supports this AOI" radius for theater hubs
const NEAR_CHOKE_KM = 2500;         // chokepoint relevance radius
// Full-SITREP slots. 4 → 6 with must-tracks (REVIEW-2026-10 §6): ★ fields
// take the slots first, the hub always holds one.
export const SITREP_MAX = 6;

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
  const asSpoke = (v: unknown): MissionSpoke | null => {
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    const icao = typeof o.icao === "string" ? o.icao.trim().toUpperCase().slice(0, 4) : "";
    if (!/^[A-Z0-9]{4}$/.test(icao)) return null;
    const lat = typeof o.lat === "number" && isFinite(o.lat) ? o.lat : null;
    const lon = typeof o.lon === "number" && isFinite(o.lon) ? o.lon : null;
    if (lat == null || lon == null) return null;
    return {
      icao, lat, lon,
      label: (typeof o.label === "string" ? o.label.trim() : "").slice(0, 80) || icao,
      country: (typeof o.country === "string" ? o.country.trim() : "").slice(0, 60),
    };
  };
  const spokes: MissionSpoke[] = [];
  if (Array.isArray(r.spokes)) {
    const seenIcao = new Set<string>();
    for (const v of r.spokes.slice(0, MAX_SPOKES * 2)) {
      const sp = asSpoke(v);
      if (sp && !seenIcao.has(sp.icao) && spokes.length < MAX_SPOKES) { seenIcao.add(sp.icao); spokes.push(sp); }
    }
  }
  const home = asSpoke(r.home);
  return {
    homeIcao: typeof r.homeIcao === "string" ? r.homeIcao.trim().toUpperCase().slice(0, 4) : "",
    ...(home ? { home } : {}),
    spokes,
    theaters: strArr(r.theaters, 6, 12).filter((t): t is Aor => VALID_AORS.includes(t as Aor)),
    aois,
    spectrum: sanitizeSpectrum(r.spectrum),
    mustTrack: sanitizeMustTrack(r.mustTrack),
    ...(r.economy ? { economy: sanitizeEconomyEdits(r.economy) } : {}),
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

  // ── Own-force airfields (hub & spoke) come FIRST: crews and aircraft LIVE
  // here, so they outrank AOI theater picks for every capped list. The hub is
  // the resolved `home` object, else a curated lookup of homeIcao.
  const hub: MissionSpoke | null =
    profile.home ??
    (profile.homeIcao
      ? (() => {
          const a = ALL_AIRFIELDS.find((x) => x.icao === profile.homeIcao);
          return a ? { icao: a.icao, label: a.name, lat: a.lat, lon: a.lon, country: a.country ?? "United States" } : null;
        })()
      : null);
  const ownForce: { sp: MissionSpoke; role: "hub" | "spoke" }[] = [
    ...(hub ? [{ sp: hub, role: "hub" as const }] : []),
    ...profile.spokes.filter((s) => s.icao !== hub?.icao).map((sp) => ({ sp, role: "spoke" as const })),
  ];
  for (const { sp, role } of ownForce) {
    if (seenBase.has(sp.icao)) continue;
    seenBase.add(sp.icao);
    const id = `mp-b-${sp.icao}`;
    if (excluded.has(id)) continue;
    bases.push({
      id, label: sp.label, icao: sp.icao, lat: sp.lat, lon: sp.lon,
      country: sp.country, cocom: classifyAor({ lat: sp.lat, lon: sp.lon }),
      kind: "base", note: role === "hub" ? "Own force — hub" : "Own force — spoke",
    });
  }

  for (const aoi of profile.aois) {
    // Countries → posture watch.
    for (const c of aoi.countries) {
      const key = c.trim().toLowerCase();
      if (!key || seenCountry.has(key)) continue;
      seenCountry.add(key);
      const id = `mp-c-${slugify(c)}`;
      if (excluded.has(id)) continue;
      countries.push({ id, country: titleCase(key), cocom: classifyAor({ name: c }), note: `${aoi.name} AOI` });
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
        kind: "base", note: `${aoi.name} AOI`,
      });
    }

    // Watchlist seeds: chokepoint names only. They match real headlines
    // ("Strait of Hormuz"); AOI display names ("Iran & Hormuz") never do and
    // just polluted the keyword list. Deletions stick via mp-t-* pseudo-ids.
    for (const cid of aoi.chokepointIds) {
      const cp = CHOKEPOINTS.find((c) => c.id === cid);
      if (cp && !excluded.has(`mp-t-${slugify(cp.name)}`)) watchlistSeeds.push(cp.name);
    }

    // Warning board per primary AOI that wants one (consumed live by
    // lib/warningProblems; the AOI's iw checkbox is the opt-out, and an
    // exclusion recorded against the board id also holds).
    if (aoi.intensity === "primary" && aoi.iw && !excluded.has(`mp-${aoi.id}`)) {
      warningProblems.push({
        id: `mp-${aoi.id}`, name: aoi.name, aor: aoi.aor,
        countries: [...aoi.countries], chokepointId: aoi.chokepointIds[0] ?? null,
        spaceActivity: profile.spectrum?.spaceActivity !== false,
        ownHubs: ownForce.map(({ sp }) => ({ lat: sp.lat, lon: sp.lon, icao: sp.icao })),
      });
    }
  }

  // METAR stations follow the derived bases (aviation wx is THE weather
  // product for an airfield; forecast cards are for civil places). Exclusions
  // use mp-m-<ICAO> pseudo-ids since MetarStation has no id field.
  const metarStations: MetarStation[] = bases
    .filter((b) => !!b.icao && !excluded.has(`mp-m-${b.icao}`))
    .map((b) => ({ icao: b.icao as string, label: b.label }));

  // SITREP candidates: hub first (always), then ★ airfields in declaration
  // order, then spokes (crews live there — "can my spoke launch today" is the
  // point), then per-primary-AOI theater hubs. A ★ field that is in no list
  // yet still becomes a candidate when the catalogue knows it; one the
  // catalogue does not know is resolved at ★ time by the server (see
  // missionProfileApply.syncSitrepBasesToStars).
  const sitrepCandidates: SitrepBase[] = [];
  const sitSeen = new Set<string>();
  const pushCand = (c: SitrepBase) => {
    if (sitSeen.has(c.icao)) return;
    sitSeen.add(c.icao);
    sitrepCandidates.push(c);
  };
  if (hub) pushCand({ icao: hub.icao, label: hub.label, lat: hub.lat, lon: hub.lon, country: hub.country || "United States", place: hub.label });
  for (const icao of profile.mustTrack?.icaos ?? []) {
    const own = ownForce.find(({ sp }) => sp.icao === icao)?.sp;
    const b = bases.find((x) => x.icao === icao);
    const a = ALL_AIRFIELDS.find((x) => x.icao === icao);
    if (own) pushCand({ icao, label: own.label, lat: own.lat, lon: own.lon, country: own.country || "United States", place: own.label });
    else if (b) pushCand({ icao, label: b.label, lat: b.lat, lon: b.lon, country: b.country, place: b.label });
    else if (a) pushCand({ icao, label: a.name, lat: a.lat, lon: a.lon, country: a.country ?? "", place: a.name });
  }
  for (const { sp } of ownForce) {
    pushCand({ icao: sp.icao, label: sp.label, lat: sp.lat, lon: sp.lon, country: sp.country || "United States", place: sp.label });
  }
  for (const aoi of profile.aois.filter((a) => a.intensity === "primary")) {
    for (const b of bases.filter((x) => x.note === `${aoi.name} AOI`).slice(0, 2)) {
      if (!b.icao || sitSeen.has(b.icao) || sitrepCandidates.length >= SITREP_MAX + 6) continue;
      pushCand({ icao: b.icao, label: b.label, lat: b.lat, lon: b.lon, country: b.country, place: b.label });
    }
  }

  return {
    countries, bases, metarStations, sitrepCandidates,
    watchlistSeeds: [...new Set(watchlistSeeds)],
    warningProblems,
  };
}

// All ids a derivation would materialize — used for exclusion drift detection.
// METAR stations and watchlist terms have no id field, so they carry PSEUDO-ids
// (mp-m-<ICAO> / mp-t-<slug>): if one was materialized and is later missing
// from its list, the user deleted it somewhere — it stays excluded.
export function derivedIds(d: DerivedTracking): string[] {
  return [
    ...d.countries.map((c) => c.id),
    ...d.bases.map((b) => b.id),
    ...d.metarStations.map((m) => `mp-m-${m.icao}`),
    ...d.watchlistSeeds.map((t) => `mp-t-${slugify(t)}`),
  ];
}

export const isDerivedId = (id: string): boolean => id.startsWith("mp-");

// Compact deterministic summary of the declaration, injected into every AI
// call's user-context block (via getUserPrefs → buildUserContext) so the
// brief, chat, and all the reads reason from the declared AO without the
// user re-typing it into the role field. "" when nothing is declared.
export function missionSummaryLine(profile: MissionProfile): string {
  const parts: string[] = [];
  const hub = profile.home?.label ?? profile.homeIcao;
  if (hub) parts.push(`hub ${hub}${profile.homeIcao && profile.home ? ` (${profile.homeIcao})` : ""}`);
  if (profile.spokes.length) parts.push(`spokes ${profile.spokes.map((s) => s.icao).join("/")}`);
  if (profile.theaters.length) parts.push(`theaters ${profile.theaters.join("+")}`);
  for (const a of profile.aois) {
    const cp = a.chokepointIds.length
      ? `; chokepoints: ${a.chokepointIds.map((id) => CHOKEPOINTS.find((c) => c.id === id)?.name ?? id).join(", ")}`
      : "";
    parts.push(`AOI "${a.name}" (${a.aor}, ${a.intensity}: ${a.countries.slice(0, 8).join(", ")}${a.countries.length > 8 ? "…" : ""}${cp})`);
  }
  const mt = profile.mustTrack;
  if (mt && (mt.aors.length || mt.countries.length || mt.icaos.length)) {
    parts.push(`must-tracks ${[...mt.aors, ...mt.countries.slice(0, 8), ...mt.icaos.slice(0, 8)].join(", ")}`);
  }
  return parts.length ? `Declared AO — ${parts.join(" · ")}` : "";
}

// ── Own-force role (hub / spoke / none) as ONE change ───────────────────────
// The command board's role switch (REVIEW-2026-10 §6 follow-up, 2026-10-07):
// "make OJAQ a spoke", "KCHS is the hub now", "KADW is no longer ours" — each
// a single declaration change, computed here so the rule is testable and the
// server only resolves the field and saves. Disciplines:
//   • There is ONE hub. Promoting a field demotes the previous hub to a SPOKE
//     — never silently out of the declaration (crews still live there).
//   • A field is never in both lists.
//   • Assigning a role lifts that field's `mp-b-`/`mp-m-` exclusions: the
//     operator has just said it is own force, so Apply may materialize it.
//   • Nothing is guessed: the caller supplies the resolved field (coords +
//     label); the previous hub is kept as a spoke only when it is resolvable
//     (the stored `home` object or the curated catalogue), else a WARNING.
//   • `undo` is the exact sequence of role changes that puts things back.

export type OwnForceRole = "hub" | "spoke" | null;

export interface OwnForceOp { icao: string; role: OwnForceRole }

export interface OwnForceChange {
  profile: MissionProfile;
  changes: string[];
  warnings: string[];
  /** Role changes that reverse this one, in order (empty when nothing changed). */
  undo: OwnForceOp[];
}

const upperIcao = (s: string | undefined | null): string => (s ?? "").trim().toUpperCase();

/** The declared own-force role of an ICAO, if any. */
export function ownForceRoleOf(profile: MissionProfile, icaoRaw: string): OwnForceRole {
  const icao = upperIcao(icaoRaw);
  if (!icao) return null;
  const hub = upperIcao(profile.home?.icao || profile.homeIcao);
  if (hub && hub === icao) return "hub";
  return profile.spokes.some((s) => upperIcao(s.icao) === icao) ? "spoke" : null;
}

/** The hub as a resolved field: the stored object, else the curated catalogue. */
export function resolvedHub(profile: MissionProfile): MissionSpoke | null {
  if (profile.home) return profile.home;
  if (!profile.homeIcao) return null;
  const a = ALL_AIRFIELDS.find((x) => x.icao === upperIcao(profile.homeIcao));
  return a ? { icao: a.icao, label: a.name, lat: a.lat, lon: a.lon, country: a.country ?? "United States" } : null;
}

export function setOwnForceRole(profileIn: MissionProfile, field: MissionSpoke, role: OwnForceRole): OwnForceChange {
  const icao = upperIcao(field.icao);
  const changes: string[] = [];
  const warnings: string[] = [];
  if (!/^[A-Z0-9]{4}$/.test(icao)) return { profile: profileIn, changes, warnings: ["A valid 4-character ICAO is required"], undo: [] };
  const current = ownForceRoleOf(profileIn, icao);
  if (current === role) {
    return { profile: profileIn, changes, warnings: [role ? `${icao} is already the ${role}` : `${icao} is not an own-force field`], undo: [] };
  }
  const resolved: MissionSpoke = { icao, label: (field.label || icao).trim().slice(0, 80), lat: field.lat, lon: field.lon, country: (field.country || "").trim().slice(0, 60) };
  let profile: MissionProfile = { ...profileIn, spokes: profileIn.spokes.filter((s) => upperIcao(s.icao) !== icao), excludedIds: [...profileIn.excludedIds] };
  const undo: OwnForceOp[] = [];
  const liftExclusions = () => {
    const drop = new Set([`mp-b-${icao}`, `mp-m-${icao}`]);
    if (profile.excludedIds.some((id) => drop.has(id))) {
      profile = { ...profile, excludedIds: profile.excludedIds.filter((id) => !drop.has(id)) };
      changes.push(`${icao}'s Apply exclusion lifted`);
    }
  };

  if (role === "hub") {
    const oldHub = resolvedHub(profileIn);
    const oldHubIcao = upperIcao(profileIn.home?.icao || profileIn.homeIcao);
    profile = { ...profile, homeIcao: icao, home: resolved };
    changes.push(`${icao} is now the hub${current === "spoke" ? " (was a spoke)" : ""}`);
    if (oldHubIcao && oldHubIcao !== icao) {
      if (oldHub && !profile.spokes.some((s) => upperIcao(s.icao) === oldHubIcao)) {
        if (profile.spokes.length >= MAX_SPOKES) {
          warnings.push(`${oldHubIcao} (the previous hub) could not be kept as a spoke — spokes are full (${MAX_SPOKES}); track it again if crews still live there`);
        } else {
          profile = { ...profile, spokes: [...profile.spokes, oldHub] };
          changes.push(`${oldHubIcao} is now a spoke (was the hub)`);
        }
      } else if (!oldHub) {
        warnings.push(`${oldHubIcao} (the previous hub) is not in the catalogue and could not be kept as a spoke — track it again if needed`);
      }
      undo.push({ icao: oldHubIcao, role: "hub" });
    }
    undo.push({ icao, role: current });
    liftExclusions();
    return { profile, changes, warnings, undo };
  }

  if (role === "spoke") {
    if (profile.spokes.length >= MAX_SPOKES) {
      return { profile: profileIn, changes, warnings: [`Spokes are full (${MAX_SPOKES}) — remove one first`], undo: [] };
    }
    if (current === "hub") {
      profile = { ...profile, homeIcao: "" };
      delete (profile as { home?: MissionSpoke | null }).home;
      changes.push(`${icao} is now a spoke (was the hub — no hub is declared now)`);
    } else changes.push(`${icao} is now a spoke`);
    profile = { ...profile, spokes: [...profile.spokes, resolved] };
    undo.push({ icao, role: current });
    liftExclusions();
    return { profile, changes, warnings, undo };
  }

  // role === null — drop the declaration (tracking is the caller's call).
  if (current === "hub") {
    profile = { ...profile, homeIcao: "" };
    delete (profile as { home?: MissionSpoke | null }).home;
    changes.push(`${icao} is no longer the hub — no hub is declared now`);
  } else changes.push(`${icao} is no longer a spoke`);
  undo.push({ icao, role: current });
  return { profile, changes, warnings, undo };
}

/**
 * The SITREP base set the ★ declaration implies, given what is configured
 * today: hub first, then ★ ICAOs (declaration order), then the existing set
 * in its current order, capped at SITREP_MAX. `resolved` supplies a base for
 * any ★ ICAO neither list knows (the server resolves it; null = unknown
 * field, skipped). Pure so the ordering rule is testable; the server only
 * does the resolving and the save.
 */
export function sitrepBasesForStars(
  current: SitrepBase[],
  candidates: SitrepBase[],
  mustTrackIcaos: string[],
  hubIcao: string,
  resolved: Record<string, SitrepBase | null> = {},
): SitrepBase[] {
  const out: SitrepBase[] = [];
  const seen = new Set<string>();
  const find = (icao: string): SitrepBase | null =>
    current.find((b) => b.icao === icao) ?? candidates.find((b) => b.icao === icao) ?? resolved[icao] ?? null;
  const push = (b: SitrepBase | null) => {
    if (!b || seen.has(b.icao) || out.length >= SITREP_MAX) return;
    seen.add(b.icao); out.push(b);
  };
  if (hubIcao) push(find(hubIcao));
  for (const icao of mustTrackIcaos) push(find(icao));
  for (const b of current) push(b);
  return out;
}

// Countries the app proposes for an AOI in the given theater — the catalog's
// names classified into the AOR, minus what's already picked. The editor
// renders these as one-tap add chips so declaring an AOI doesn't require
// typing country names from memory.
export function suggestAoiCountries(aor: Aor, existing: string[]): string[] {
  const have = new Set(existing.map((c) => c.trim().toLowerCase()));
  return centroidCountryNames()
    .filter((name) => !have.has(name) && classifyAor({ name }) === aor)
    .map((name) => titleCase(name))
    .sort();
}
