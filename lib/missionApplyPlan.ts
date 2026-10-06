// The Apply computation, PURE: given the stored prefs, the declaration and
// the SITREP picks, what will every list look like afterwards, what changes,
// and which derived ids were ACTUALLY written. lib/missionProfileApply.ts
// (server) loads, calls this, and saves — or, with dryRun, returns the diff
// for the editor's confirmation screen.
//
// The materializedIds fix: the previous apply recorded every id the
// derivation PRODUCED, including rows that were never written because a
// manual row held the natural key or a cap cut them. The drift check on the
// next apply then found those ids "missing" and excluded them — a base the
// operator never saw was silently banned from every future Apply. Here
// `materializedIds` is exactly the set of derived ids present in the lists
// being saved.

import {
  deriveTracking, isDerivedId, slugify, SITREP_MAX,
  type MissionProfile, type DerivedTracking,
} from "./missionProfile";
import { sameCountry } from "./countryNames";
import type { TrackingPrefs } from "./trackingRegistry";
import { CAPS } from "./trackingRegistry";

export interface ApplyDiff {
  countriesAdd: string[];
  countriesDrop: string[];
  basesAdd: string[];
  basesDrop: string[];
  metarAdd: string[];
  metarDrop: string[];
  watchlistAdd: string[];
  sitrep: { from: string[]; to: string[] };
  /** Derived ids newly excluded by drift (deleted somewhere since the last apply). */
  drifted: string[];
  /** Nothing in any list changes. */
  empty: boolean;
}

export interface ApplyPlan {
  profile: MissionProfile;
  derived: DerivedTracking;
  next: TrackingPrefs;
  diff: ApplyDiff;
  counts: { countries: number; bases: number; metarStations: number; sitrepBases: number; watchlistAdded: number };
}

const upper = (s: string | undefined | null) => (s ?? "").trim().toUpperCase();

export function planApply(prefs: TrackingPrefs, profileIn: MissionProfile, sitrepPicks: string[]): ApplyPlan {
  const profile: MissionProfile = { ...profileIn, excludedIds: [...profileIn.excludedIds] };

  // Exclusion drift: anything materialized last time that is now missing
  // from its list was deleted by the user somewhere — keep it excluded.
  // Legacy mp-w-* weather-point ids are ignored (bases are no longer
  // materialized into trackedLocations).
  const present = new Set<string>([
    ...prefs.countriesOfInterest.map((c) => c.id),
    ...prefs.forceLocations.map((b) => b.id),
    ...prefs.metarStations.map((m) => `mp-m-${upper(m.icao)}`),
    ...prefs.watchlist.map((t) => `mp-t-${slugify(t)}`),
  ]);
  const drifted = profile.materializedIds.filter((id) => isDerivedId(id) && !id.startsWith("mp-w-") && !present.has(id) && !profile.excludedIds.includes(id));
  profile.excludedIds = [...new Set([...profile.excludedIds, ...drifted])];

  const derived = deriveTracking(profile);

  // Merge: manual rows first (never touched), then AUTO rows that don't
  // collide with a manual row's natural key. Old mp-* rows are replaced
  // wholesale by the fresh derivation.
  const manualCountries = prefs.countriesOfInterest.filter((c) => !isDerivedId(c.id));
  const countries = [
    ...manualCountries,
    ...derived.countries.filter((c) => !manualCountries.some((m) => sameCountry(m.country, c.country))),
  ].slice(0, CAPS.countries);

  const manualBases = prefs.forceLocations.filter((b) => !isDerivedId(b.id));
  const haveIcao = new Set(manualBases.map((b) => upper(b.icao)).filter(Boolean));
  const bases = [
    ...manualBases,
    ...derived.bases.filter((b) => !haveIcao.has(upper(b.icao))),
  ].slice(0, CAPS.posture);

  // Tracked locations are CIVIL places — purge legacy mp-w-* rows.
  const trackedLocations = prefs.trackedLocations.filter((w) => !isDerivedId(w.id));

  const haveMetar = new Set(prefs.metarStations.map((m) => upper(m.icao)));
  const metarStations = [
    ...prefs.metarStations,
    ...derived.metarStations.filter((m) => !haveMetar.has(upper(m.icao))),
  ].slice(0, CAPS.metar);

  const haveTerm = new Set(prefs.watchlist.map((t) => t.toLowerCase()));
  const watchlistAdd = derived.watchlistSeeds.filter((t) => !haveTerm.has(t.toLowerCase()));
  const watchlist = [...prefs.watchlist, ...watchlistAdd];

  let sitrepBases = prefs.sitrepBases;
  if (sitrepPicks.length > 0) {
    const byIcao = new Map(derived.sitrepCandidates.map((s) => [s.icao, s]));
    const picked = sitrepPicks
      .map((i) => upper(i))
      .map((i) => byIcao.get(i) ?? prefs.sitrepBases.find((s) => s.icao === i))
      .filter((s): s is NonNullable<typeof s> => s != null)
      .slice(0, SITREP_MAX);
    if (picked.length > 0) sitrepBases = picked;
  }

  const next: TrackingPrefs = { countriesOfInterest: countries, forceLocations: bases, trackedLocations, metarStations, watchlist, sitrepBases };

  // Exactly what was written, by derived id.
  const materializedIds = [
    ...countries.map((c) => c.id).filter(isDerivedId),
    ...bases.map((b) => b.id).filter(isDerivedId),
    ...metarStations.filter((m) => derived.metarStations.some((d) => upper(d.icao) === upper(m.icao))).map((m) => `mp-m-${upper(m.icao)}`),
    ...watchlist.filter((t) => derived.watchlistSeeds.some((s) => s.toLowerCase() === t.toLowerCase())).map((t) => `mp-t-${slugify(t)}`),
  ];
  profile.materializedIds = [...new Set(materializedIds)];

  const beforeC = new Set(prefs.countriesOfInterest.map((c) => c.country.toLowerCase()));
  const afterC = new Set(countries.map((c) => c.country.toLowerCase()));
  const beforeB = new Set(prefs.forceLocations.map((b) => upper(b.icao) || b.id));
  const afterB = new Set(bases.map((b) => upper(b.icao) || b.id));
  const beforeM = new Set(prefs.metarStations.map((m) => upper(m.icao)));
  const afterM = new Set(metarStations.map((m) => upper(m.icao)));
  const diff: ApplyDiff = {
    countriesAdd: countries.filter((c) => !beforeC.has(c.country.toLowerCase())).map((c) => c.country),
    countriesDrop: prefs.countriesOfInterest.filter((c) => !afterC.has(c.country.toLowerCase())).map((c) => c.country),
    basesAdd: bases.filter((b) => !beforeB.has(upper(b.icao) || b.id)).map((b) => b.icao ? `${b.label} (${b.icao})` : b.label),
    basesDrop: prefs.forceLocations.filter((b) => !afterB.has(upper(b.icao) || b.id)).map((b) => b.icao ? `${b.label} (${b.icao})` : b.label),
    metarAdd: metarStations.filter((m) => !beforeM.has(upper(m.icao))).map((m) => m.icao),
    metarDrop: prefs.metarStations.filter((m) => !afterM.has(upper(m.icao))).map((m) => m.icao),
    watchlistAdd,
    sitrep: { from: prefs.sitrepBases.map((b) => b.icao), to: sitrepBases.map((b) => b.icao) },
    drifted,
    empty: false,
  };
  diff.empty =
    !diff.countriesAdd.length && !diff.countriesDrop.length && !diff.basesAdd.length && !diff.basesDrop.length &&
    !diff.metarAdd.length && !diff.metarDrop.length && !diff.watchlistAdd.length &&
    diff.sitrep.from.join(",") === diff.sitrep.to.join(",") &&
    trackedLocations.length === prefs.trackedLocations.length;

  return {
    profile, derived, next, diff,
    counts: { countries: countries.length, bases: bases.length, metarStations: metarStations.length, sitrepBases: sitrepBases.length, watchlistAdded: watchlistAdd.length },
  };
}
