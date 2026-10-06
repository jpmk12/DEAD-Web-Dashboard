// The tracking registry — ONE view of everything the app tracks, and ONE
// command that changes it. PURE, client-safe, unit-tested.
//
// Storage is unchanged on purpose (the derive-and-materialize decision in
// lib/missionProfile.ts): an airfield still lives in up to four lists
// (forceLocations / metarStations / sitrepBases / mustTrack.icaos) and a
// country in two (countriesOfInterest / mustTrack.countries). What was
// clunky was that each list had its own editor, its own door and its own
// id scheme, so "track Amman" meant four forms and "why is OJAQ still on the
// map" had no single answer. `buildRegistry` folds the lists into one record
// per airfield / country with its ROLES, and `planTrack` / `planRestore`
// compute the next state of every list for one request — the server only
// loads, calls, and saves.
//
// Disciplines:
// - A manual row written here carries a `tr-` id; derived rows keep `mp-`.
//   Removing an AUTO row records the matching exclusion so the next Apply
//   does not resurrect it (the same contract the drawer editors had);
//   tracking something that is excluded lifts the exclusion.
// - Nothing here guesses: a request names the airfield (ICAO + coords, as
//   resolved by the server) — the planner never looks a field up.
// - Caps are the sanitisers' caps (posture 30 / countries 40 / METAR 12 /
//   SITREP SITREP_MAX / places 10). A full list is a WARNING with the thing
//   not added, never a silent drop of something else.

import { classifyAor, type Aor } from "./aor";
import {
  deriveTracking, isDerivedId, slugify, sitrepBasesForStars, isStarCountry, toggleMustTrack, SITREP_MAX,
  type MissionProfile,
} from "./missionProfile";
import { normalizeCountryName, sameCountry } from "./countryNames";
import type { CountryWatch, ForceLocation, MetarStation, SitrepBase, TrackedLocation } from "./types";

export const CAPS = { posture: 30, countries: 40, metar: 12, sitrep: SITREP_MAX, places: 10 } as const;

/** The five prefs lists the registry reads and the planner rewrites. */
export interface TrackingPrefs {
  forceLocations: ForceLocation[];
  countriesOfInterest: CountryWatch[];
  metarStations: MetarStation[];
  sitrepBases: SitrepBase[];
  trackedLocations: TrackedLocation[];
  watchlist: string[];
}

export interface TrackRoles { posture: boolean; metar: boolean; sitrep: boolean; star: boolean }

export interface AirfieldRecord {
  /** ICAO when known; "" for a lat/lon-only posture row (key falls back to forceId). */
  icao: string;
  key: string;
  label: string;
  lat: number;
  lon: number;
  country: string;
  aor: Aor;
  roles: TrackRoles;
  /** Own-force role from the Mission Profile declaration. */
  own: "hub" | "spoke" | null;
  /** The posture row was written by Apply (mp-), not by hand. */
  auto: boolean;
  forceId?: string;
  note?: string;
}

export interface CountryRecord {
  country: string;
  aor: Aor;
  roles: { posture: boolean; star: boolean };
  /** The AOI that declared it (from the derived row's note), when AUTO. */
  aoi: string | null;
  auto: boolean;
  id?: string;
  note?: string;
}

export interface PlaceRecord { id: string; label: string; lat: number; lon: number }

export interface ExcludedRecord {
  id: string;
  kind: "country" | "base" | "metar" | "term" | "board" | "other";
  label: string;
}

export interface TrackingRegistry {
  airfields: AirfieldRecord[];
  countries: CountryRecord[];
  places: PlaceRecord[];
  excluded: ExcludedRecord[];
  counts: { airfields: number; sitrep: number; starIcaos: number; countries: number; starCountries: number; places: number; excluded: number };
  summary: string;
}

const upper = (s: string | undefined | null): string => (s ?? "").trim().toUpperCase();

function hubAndSpokes(profile: MissionProfile): Map<string, "hub" | "spoke"> {
  const m = new Map<string, "hub" | "spoke">();
  const hub = profile.home?.icao ?? profile.homeIcao;
  if (hub) m.set(upper(hub), "hub");
  for (const s of profile.spokes) if (!m.has(upper(s.icao))) m.set(upper(s.icao), "spoke");
  return m;
}

/** Human labels for the exclusion ids a profile carries. */
export function describeExclusions(profile: MissionProfile): ExcludedRecord[] {
  if (!profile.excludedIds.length) return [];
  const full = deriveTracking({ ...profile, excludedIds: [] });
  const out: ExcludedRecord[] = [];
  for (const id of profile.excludedIds) {
    if (id.startsWith("mp-c-")) {
      const c = full.countries.find((x) => x.id === id);
      out.push({ id, kind: "country", label: c?.country ?? id.slice(5) });
    } else if (id.startsWith("mp-b-")) {
      const b = full.bases.find((x) => x.id === id);
      out.push({ id, kind: "base", label: b ? `${b.label} (${b.icao})` : id.slice(5) });
    } else if (id.startsWith("mp-m-")) {
      out.push({ id, kind: "metar", label: `METAR ${id.slice(5)}` });
    } else if (id.startsWith("mp-t-")) {
      const t = full.watchlistSeeds.find((s) => `mp-t-${slugify(s)}` === id);
      out.push({ id, kind: "term", label: `watchlist “${t ?? id.slice(5)}”` });
    } else if (id.startsWith("mp-")) {
      const w = full.warningProblems.find((p) => p.id === id);
      out.push({ id, kind: w ? "board" : "other", label: w ? `I&W board “${w.name}”` : id });
    } else {
      out.push({ id, kind: "other", label: id });
    }
  }
  return out;
}

export function buildRegistry(prefs: TrackingPrefs, profile: MissionProfile): TrackingRegistry {
  const own = hubAndSpokes(profile);
  const stars = new Set((profile.mustTrack?.icaos ?? []).map(upper));
  const metar = new Map(prefs.metarStations.map((m) => [upper(m.icao), m]));
  const sitrep = new Map(prefs.sitrepBases.map((b) => [upper(b.icao), b]));

  const byKey = new Map<string, AirfieldRecord>();
  const ensure = (key: string, seed: Omit<AirfieldRecord, "key" | "roles" | "own" | "auto" | "aor">): AirfieldRecord => {
    const have = byKey.get(key);
    if (have) return have;
    const rec: AirfieldRecord = {
      ...seed, key,
      aor: classifyAor({ lat: seed.lat, lon: seed.lon }),
      roles: { posture: false, metar: false, sitrep: false, star: false },
      own: seed.icao ? own.get(seed.icao) ?? null : null,
      auto: false,
    };
    byKey.set(key, rec);
    return rec;
  };

  for (const f of prefs.forceLocations) {
    if (f.kind === "country") continue;
    const icao = upper(f.icao);
    const rec = ensure(icao || f.id, { icao, label: f.label, lat: f.lat, lon: f.lon, country: normalizeCountryName(f.country), forceId: f.id, note: f.note });
    rec.roles.posture = true;
    rec.auto = isDerivedId(f.id);
    rec.forceId = f.id;
  }
  for (const [icao, b] of sitrep) {
    const rec = ensure(icao, { icao, label: b.label, lat: b.lat, lon: b.lon, country: normalizeCountryName(b.country) });
    rec.roles.sitrep = true;
  }
  for (const [icao, m] of metar) {
    // A METAR-only station has no coordinates of its own; the catalogue is
    // not consulted here (pure). It still lists, at 0/0 with aor UNKNOWN,
    // so the operator can see and remove it.
    const rec = ensure(icao, { icao, label: m.label, lat: 0, lon: 0, country: "" });
    rec.roles.metar = true;
    if (!rec.lat && !rec.lon) rec.aor = "UNKNOWN";
  }
  for (const icao of stars) {
    const sp = profile.spokes.find((s) => upper(s.icao) === icao) ?? (profile.home && upper(profile.home.icao) === icao ? profile.home : null);
    const rec = ensure(icao, { icao, label: sp?.label ?? icao, lat: sp?.lat ?? 0, lon: sp?.lon ?? 0, country: normalizeCountryName(sp?.country) });
    rec.roles.star = true;
    if (!rec.lat && !rec.lon) rec.aor = "UNKNOWN";
  }
  // Hub/spokes with no role at all still list (declared, not yet applied).
  for (const [icao, role] of own) {
    if (byKey.has(icao)) continue;
    const sp = role === "hub" ? profile.home : profile.spokes.find((s) => upper(s.icao) === icao);
    if (!sp) continue;
    ensure(icao, { icao, label: sp.label, lat: sp.lat, lon: sp.lon, country: normalizeCountryName(sp.country) });
  }

  const roleRank = (r: AirfieldRecord) => (r.own === "hub" ? 0 : r.own === "spoke" ? 1 : r.roles.star ? 2 : r.roles.sitrep ? 3 : 4);
  const airfields = [...byKey.values()].sort((a, b) => roleRank(a) - roleRank(b) || a.label.localeCompare(b.label));

  // Countries.
  const countries: CountryRecord[] = [];
  const findCountry = (name: string) => countries.find((c) => sameCountry(c.country, name));
  for (const c of prefs.countriesOfInterest) {
    const name = normalizeCountryName(c.country);
    if (!name || findCountry(name)) continue;
    const auto = isDerivedId(c.id);
    countries.push({
      country: name, aor: classifyAor({ name }), roles: { posture: true, star: false },
      aoi: auto && c.note?.endsWith(" AOI") ? c.note.slice(0, -4) : null, auto, id: c.id, note: c.note,
    });
  }
  for (const f of prefs.forceLocations) {
    if (f.kind !== "country") continue;
    const name = normalizeCountryName(f.country || f.label);
    if (!name || findCountry(name)) continue;
    countries.push({ country: name, aor: classifyAor({ lat: f.lat, lon: f.lon }), roles: { posture: true, star: false }, aoi: null, auto: isDerivedId(f.id), id: f.id, note: f.note });
  }
  for (const s of profile.mustTrack?.countries ?? []) {
    const name = normalizeCountryName(s);
    const have = findCountry(name);
    if (have) have.roles.star = true;
    else countries.push({ country: name, aor: classifyAor({ name }), roles: { posture: false, star: true }, aoi: null, auto: false });
  }
  countries.sort((a, b) => Number(b.roles.star) - Number(a.roles.star) || a.country.localeCompare(b.country));

  const places = prefs.trackedLocations.map((t) => ({ id: t.id, label: t.label, lat: t.lat, lon: t.lon }));
  const excluded = describeExclusions(profile);
  const counts = {
    airfields: airfields.length,
    sitrep: airfields.filter((a) => a.roles.sitrep).length,
    starIcaos: airfields.filter((a) => a.roles.star).length,
    countries: countries.length,
    starCountries: countries.filter((c) => c.roles.star).length,
    places: places.length,
    excluded: excluded.length,
  };
  const parts = [
    `${counts.countries} ${counts.countries === 1 ? "country" : "countries"}${counts.starCountries ? ` (${counts.starCountries} ★)` : ""}`,
    `${counts.airfields} ${counts.airfields === 1 ? "airfield" : "airfields"} (${counts.sitrep} SITREP${counts.starIcaos ? `, ${counts.starIcaos} ★` : ""})`,
  ];
  if (counts.places) parts.push(`${counts.places} ${counts.places === 1 ? "place" : "places"}`);
  if (counts.excluded) parts.push(`${counts.excluded} excluded`);
  return { airfields, countries, places, excluded, counts, summary: parts.join(" · ") };
}

// ── The one command ─────────────────────────────────────────────────────────

export interface TrackAirfieldRequest {
  kind: "airfield";
  icao: string;
  label: string;
  lat: number;
  lon: number;
  country: string;
  place?: string;
  /** true = add the role, false = remove it, absent = leave it. */
  roles: Partial<TrackRoles>;
}
export interface TrackCountryRequest {
  kind: "country";
  country: string;
  roles: { posture?: boolean; star?: boolean };
}
export interface TrackPlaceRequest {
  kind: "place";
  label: string;
  lat: number;
  lon: number;
  remove?: boolean;
}
export type TrackRequest = TrackAirfieldRequest | TrackCountryRequest | TrackPlaceRequest;

export interface TrackPlan {
  prefs: TrackingPrefs;
  profile: MissionProfile;
  /** One line per list touched, in operator language. */
  changes: string[];
  /** Things the request asked for that could not be done, with the reason. */
  warnings: string[];
  /** The request that puts things back exactly (null when nothing changed). */
  undo: TrackRequest | null;
}

const without = (ids: string[], id: string) => ids.filter((x) => x !== id);
const withId = (ids: string[], id: string) => (ids.includes(id) ? ids : [...ids, id]);

/** Compute the next state of every tracking list for one request. */
export function planTrack(prefsIn: TrackingPrefs, profileIn: MissionProfile, req: TrackRequest): TrackPlan {
  const changes: string[] = [];
  const warnings: string[] = [];
  const prefs: TrackingPrefs = {
    forceLocations: [...prefsIn.forceLocations],
    countriesOfInterest: [...prefsIn.countriesOfInterest],
    metarStations: [...prefsIn.metarStations],
    sitrepBases: [...prefsIn.sitrepBases],
    trackedLocations: [...prefsIn.trackedLocations],
    watchlist: [...prefsIn.watchlist],
  };
  let profile: MissionProfile = { ...profileIn, excludedIds: [...profileIn.excludedIds], mustTrack: { ...profileIn.mustTrack, aors: [...profileIn.mustTrack.aors], countries: [...profileIn.mustTrack.countries], icaos: [...profileIn.mustTrack.icaos] } };

  if (req.kind === "place") {
    const label = req.label.trim().slice(0, 60);
    const near = (t: TrackedLocation) => t.label.toLowerCase() === label.toLowerCase() || (Math.abs(t.lat - req.lat) < 0.01 && Math.abs(t.lon - req.lon) < 0.01);
    const have = prefs.trackedLocations.find(near);
    if (req.remove) {
      if (!have) return { prefs, profile, changes, warnings: [`${label} is not a tracked place`], undo: null };
      prefs.trackedLocations = prefs.trackedLocations.filter((t) => !near(t));
      changes.push(`${label} removed from weather places`);
      return { prefs, profile, changes, warnings, undo: { kind: "place", label: have.label, lat: have.lat, lon: have.lon } };
    }
    if (have) return { prefs, profile, changes, warnings: [`${have.label} is already a weather place`], undo: null };
    if (prefs.trackedLocations.length >= CAPS.places) {
      return { prefs, profile, changes, warnings: [`Weather places are full (${CAPS.places}) — remove one first`], undo: null };
    }
    if (!label) return { prefs, profile, changes, warnings: ["A place needs a label"], undo: null };
    prefs.trackedLocations.push({ id: `tr-w-${slugify(label)}`, label, lat: req.lat, lon: req.lon });
    changes.push(`${label} added to weather places`);
    return { prefs, profile, changes, warnings, undo: { kind: "place", label, lat: req.lat, lon: req.lon, remove: true } };
  }

  if (req.kind === "country") {
    const name = normalizeCountryName(req.country);
    if (!name) return { prefs, profile, changes, warnings: ["A country name is required"], undo: null };
    const slug = slugify(name);
    const prior = {
      posture: prefs.countriesOfInterest.some((c) => sameCountry(c.country, name)) || prefs.forceLocations.some((f) => f.kind === "country" && sameCountry(f.country || f.label, name)),
      star: isStarCountry(profile.mustTrack, name),
    };
    const undoRoles: TrackCountryRequest["roles"] = {};
    if (req.roles.posture === true && !prior.posture) {
      if (prefs.countriesOfInterest.length >= CAPS.countries) {
        warnings.push(`Posture countries are full (${CAPS.countries}) — remove one first`);
      } else {
        prefs.countriesOfInterest.push({ id: `tr-c-${slug}`, country: name, cocom: classifyAor({ name }) });
        if (profile.excludedIds.includes(`mp-c-${slug}`)) {
          profile = { ...profile, excludedIds: without(profile.excludedIds, `mp-c-${slug}`) };
          changes.push(`${name} added to the posture watch (exclusion lifted)`);
        } else changes.push(`${name} added to the posture watch`);
        undoRoles.posture = false;
      }
    } else if (req.roles.posture === false && prior.posture) {
      const removed = prefs.countriesOfInterest.filter((c) => sameCountry(c.country, name));
      prefs.countriesOfInterest = prefs.countriesOfInterest.filter((c) => !sameCountry(c.country, name));
      prefs.forceLocations = prefs.forceLocations.filter((f) => !(f.kind === "country" && sameCountry(f.country || f.label, name)));
      const autoIds = removed.map((c) => c.id).filter(isDerivedId);
      if (autoIds.length) {
        profile = { ...profile, excludedIds: autoIds.reduce((acc, id) => withId(acc, id), profile.excludedIds) };
        changes.push(`${name} removed from the posture watch (AUTO row — excluded so Apply will not bring it back)`);
      } else changes.push(`${name} removed from the posture watch`);
      undoRoles.posture = true;
    }
    if (req.roles.star === true && !prior.star) {
      profile = { ...profile, mustTrack: toggleMustTrack(profile.mustTrack, "country", name) };
      changes.push(`★ ${name}`);
      undoRoles.star = false;
    } else if (req.roles.star === false && prior.star) {
      profile = { ...profile, mustTrack: toggleMustTrack(profile.mustTrack, "country", name) };
      changes.push(`★ removed from ${name}`);
      undoRoles.star = true;
    }
    if (req.roles.star === true && !prefs.countriesOfInterest.some((c) => sameCountry(c.country, name)) && req.roles.posture !== true) {
      warnings.push(`${name} is ★ but not in the posture watch — it orders and pins, posture stays UNKNOWN until tracked`);
    }
    const undo = Object.keys(undoRoles).length ? { kind: "country" as const, country: name, roles: undoRoles } : null;
    return { prefs, profile, changes, warnings, undo };
  }

  // Airfield.
  const icao = upper(req.icao);
  if (!/^[A-Z0-9]{4}$/.test(icao)) return { prefs, profile, changes, warnings: ["A valid 4-character ICAO is required"], undo: null };
  const label = req.label.trim().slice(0, 60) || icao;
  const country = normalizeCountryName(req.country);
  const prior: TrackRoles = {
    posture: prefs.forceLocations.some((f) => upper(f.icao) === icao),
    metar: prefs.metarStations.some((m) => upper(m.icao) === icao),
    sitrep: prefs.sitrepBases.some((b) => upper(b.icao) === icao),
    star: profile.mustTrack.icaos.includes(icao),
  };
  const undoRoles: Partial<TrackRoles> = {};
  const base: SitrepBase = { icao, label, lat: req.lat, lon: req.lon, country, place: (req.place ?? label).slice(0, 120) };

  // Posture.
  if (req.roles.posture === true && !prior.posture) {
    if (prefs.forceLocations.length >= CAPS.posture) {
      warnings.push(`Posture airfields are full (${CAPS.posture}) — remove one first`);
    } else {
      prefs.forceLocations.push({ id: `tr-b-${icao}`, label, icao, lat: req.lat, lon: req.lon, country, cocom: classifyAor({ lat: req.lat, lon: req.lon }), kind: "base" });
      if (profile.excludedIds.includes(`mp-b-${icao}`)) {
        profile = { ...profile, excludedIds: without(profile.excludedIds, `mp-b-${icao}`) };
        changes.push(`${icao} added to the posture watch (exclusion lifted)`);
      } else changes.push(`${icao} added to the posture watch`);
      undoRoles.posture = false;
    }
  } else if (req.roles.posture === false && prior.posture) {
    const removed = prefs.forceLocations.filter((f) => upper(f.icao) === icao);
    prefs.forceLocations = prefs.forceLocations.filter((f) => upper(f.icao) !== icao);
    const autoIds = removed.map((f) => f.id).filter(isDerivedId);
    if (autoIds.length) {
      profile = { ...profile, excludedIds: autoIds.reduce((acc, id) => withId(acc, id), profile.excludedIds) };
      changes.push(`${icao} removed from the posture watch (AUTO row — excluded so Apply will not bring it back)`);
    } else changes.push(`${icao} removed from the posture watch`);
    undoRoles.posture = true;
  }

  // METAR.
  if (req.roles.metar === true && !prior.metar) {
    if (prefs.metarStations.length >= CAPS.metar) {
      warnings.push(`METAR stations are full (${CAPS.metar}) — remove one first`);
    } else {
      prefs.metarStations.push({ icao, label });
      if (profile.excludedIds.includes(`mp-m-${icao}`)) profile = { ...profile, excludedIds: without(profile.excludedIds, `mp-m-${icao}`) };
      changes.push(`${icao} added to METAR/TAF`);
      undoRoles.metar = false;
    }
  } else if (req.roles.metar === false && prior.metar) {
    prefs.metarStations = prefs.metarStations.filter((m) => upper(m.icao) !== icao);
    // The derivation would write it back if a derived base still carries it.
    if (deriveTracking(profile).metarStations.some((m) => upper(m.icao) === icao)) {
      profile = { ...profile, excludedIds: withId(profile.excludedIds, `mp-m-${icao}`) };
    }
    changes.push(`${icao} removed from METAR/TAF`);
    undoRoles.metar = true;
  }

  // ★ before SITREP so an explicit sitrep:false in the same request wins.
  if (req.roles.star === true && !prior.star) {
    profile = { ...profile, mustTrack: toggleMustTrack(profile.mustTrack, "icao", icao) };
    const derived = deriveTracking(profile);
    const hubIcao = profile.home?.icao ?? profile.homeIcao;
    const nextSitrep = sitrepBasesForStars(prefs.sitrepBases, derived.sitrepCandidates, profile.mustTrack.icaos, hubIcao, { [icao]: base });
    const dropped = prefs.sitrepBases.filter((b) => !nextSitrep.some((n) => n.icao === b.icao)).map((b) => b.icao);
    const gained = nextSitrep.some((n) => n.icao === icao) && !prior.sitrep;
    prefs.sitrepBases = nextSitrep;
    changes.push(`★ ${icao}`);
    if (gained) changes.push(`${icao} takes a SITREP slot (${nextSitrep.length}/${SITREP_MAX})`);
    if (dropped.length) warnings.push(`${dropped.join(", ")} dropped from SITREP to make room (${SITREP_MAX} slots)`);
    undoRoles.star = false;
    if (gained) undoRoles.sitrep = false;
  } else if (req.roles.star === false && prior.star) {
    profile = { ...profile, mustTrack: toggleMustTrack(profile.mustTrack, "icao", icao) };
    changes.push(`★ removed from ${icao}`);
    undoRoles.star = true;
  }

  // SITREP.
  const nowSitrep = prefs.sitrepBases.some((b) => upper(b.icao) === icao);
  if (req.roles.sitrep === true && !nowSitrep) {
    if (prefs.sitrepBases.length >= CAPS.sitrep) {
      warnings.push(`SITREP slots are full (${CAPS.sitrep}/${CAPS.sitrep}) — remove one first`);
    } else {
      prefs.sitrepBases.push(base);
      changes.push(`${icao} takes a SITREP slot (${prefs.sitrepBases.length}/${SITREP_MAX})`);
      undoRoles.sitrep = false;
    }
  } else if (req.roles.sitrep === false && nowSitrep) {
    prefs.sitrepBases = prefs.sitrepBases.filter((b) => upper(b.icao) !== icao);
    changes.push(`${icao} released its SITREP slot`);
    undoRoles.sitrep = true;
  }

  const undo = Object.keys(undoRoles).length
    ? { kind: "airfield" as const, icao, label, lat: req.lat, lon: req.lon, country, place: base.place, roles: undoRoles }
    : null;
  return { prefs, profile, changes, warnings, undo };
}

/**
 * Lift one exclusion and put the row back NOW (the next Apply would also
 * bring it back, but "Restore" should not need a second step).
 */
export function planRestore(prefsIn: TrackingPrefs, profileIn: MissionProfile, id: string): TrackPlan {
  const changes: string[] = [];
  const warnings: string[] = [];
  const prefs: TrackingPrefs = { ...prefsIn, forceLocations: [...prefsIn.forceLocations], countriesOfInterest: [...prefsIn.countriesOfInterest], metarStations: [...prefsIn.metarStations], watchlist: [...prefsIn.watchlist] };
  if (!profileIn.excludedIds.includes(id)) return { prefs, profile: profileIn, changes, warnings: [`${id} is not excluded`], undo: null };
  const profile: MissionProfile = { ...profileIn, excludedIds: without(profileIn.excludedIds, id) };
  const derived = deriveTracking(profile);
  if (id.startsWith("mp-c-")) {
    const c = derived.countries.find((x) => x.id === id);
    if (c && !prefs.countriesOfInterest.some((x) => sameCountry(x.country, c.country))) {
      if (prefs.countriesOfInterest.length >= CAPS.countries) warnings.push(`Posture countries are full (${CAPS.countries}) — exclusion lifted, row not added`);
      else { prefs.countriesOfInterest.push(c); changes.push(`${c.country} restored to the posture watch`); }
    } else changes.push(`exclusion lifted for ${c?.country ?? id}`);
  } else if (id.startsWith("mp-b-")) {
    const b = derived.bases.find((x) => x.id === id);
    if (b && !prefs.forceLocations.some((x) => upper(x.icao) === upper(b.icao))) {
      if (prefs.forceLocations.length >= CAPS.posture) warnings.push(`Posture airfields are full (${CAPS.posture}) — exclusion lifted, row not added`);
      else { prefs.forceLocations.push(b); changes.push(`${b.icao} restored to the posture watch`); }
    } else changes.push(`exclusion lifted for ${b?.icao ?? id}`);
  } else if (id.startsWith("mp-m-")) {
    const m = derived.metarStations.find((x) => `mp-m-${x.icao}` === id);
    if (m && !prefs.metarStations.some((x) => upper(x.icao) === upper(m.icao))) {
      if (prefs.metarStations.length >= CAPS.metar) warnings.push(`METAR stations are full (${CAPS.metar}) — exclusion lifted, row not added`);
      else { prefs.metarStations.push(m); changes.push(`${m.icao} restored to METAR/TAF`); }
    } else changes.push(`exclusion lifted for ${id.slice(5)}`);
  } else if (id.startsWith("mp-t-")) {
    const t = derived.watchlistSeeds.find((s) => `mp-t-${slugify(s)}` === id);
    if (t && !prefs.watchlist.some((x) => x.toLowerCase() === t.toLowerCase())) { prefs.watchlist.push(t); changes.push(`“${t}” restored to the watchlist`); }
    else changes.push(`exclusion lifted for ${t ?? id}`);
  } else {
    changes.push(`exclusion lifted for ${id}`);
  }
  return { prefs, profile, changes, warnings, undo: null };
}
