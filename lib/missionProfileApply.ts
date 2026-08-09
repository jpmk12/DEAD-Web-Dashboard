// Mission Profile persistence + the materializer — SERVER-ONLY (imports the
// DB). The pure model/derivation lives in lib/missionProfile.ts.
//
// applyMissionProfile() is the one write path: it re-derives, detects
// exclusion drift (previously-materialized ids the user has since deleted in
// any editor stay deleted), merges AUTO items under the user's MANUAL items
// (manual always wins on natural key: country name / ICAO), enforces the
// existing per-list caps, and saves through saveUserPrefs so every downstream
// consumer keeps reading the fields it already reads.

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { getUserPrefs, saveUserPrefs } from "./userPrefs";
import {
  sanitizeMissionProfile, deriveTracking, derivedIds, isDerivedId, SITREP_MAX,
  type MissionProfile, type DerivedTracking,
} from "./missionProfile";
import type { UserPrefs } from "./types";

const CAPS = { countries: 40, bases: 30, weather: 10, metar: 12 };

interface Row extends RowDataPacket { mission_profile: unknown }

export async function getMissionProfile(): Promise<MissionProfile> {
  const pool = await getDb();
  const [rows] = await pool.query<Row[]>("SELECT mission_profile FROM user_prefs WHERE id = 1");
  const raw = rows[0]?.mission_profile;
  const parsed = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  return sanitizeMissionProfile(parsed);
}

export async function saveMissionProfile(profile: MissionProfile): Promise<void> {
  const pool = await getDb();
  await pool.execute(
    "UPDATE user_prefs SET mission_profile = CAST(? AS JSON), last_updated = NOW() WHERE id = 1",
    [JSON.stringify({ ...profile, updatedAt: new Date().toISOString() })],
  );
}

export interface ApplyResult {
  profile: MissionProfile;
  derived: DerivedTracking;
  counts: { countries: number; bases: number; weatherPoints: number; metarStations: number; sitrepBases: number; watchlistAdded: number };
}

// sitrepPicks: the ICAOs the user confirmed for full SITREP treatment (≤4).
// Empty array = leave the current SITREP bases untouched.
export async function applyMissionProfile(rawProfile: unknown, sitrepPicks: string[]): Promise<ApplyResult> {
  const profile = sanitizeMissionProfile(rawProfile);
  const prefs = await getUserPrefs(); // owner/shared row — apply is owner-gated at the route

  // Exclusion drift: anything we materialized last time that is now missing
  // from the lists was deleted by the user somewhere — keep it excluded.
  const present = new Set<string>([
    ...prefs.countriesOfInterest.map((c) => c.id),
    ...prefs.forceLocations.map((b) => b.id),
    ...prefs.trackedLocations.map((w) => w.id),
  ]);
  const drifted = profile.materializedIds.filter((id) => isDerivedId(id) && !present.has(id));
  profile.excludedIds = [...new Set([...profile.excludedIds, ...drifted])];

  const derived = deriveTracking(profile);

  // Merge: manual rows first (never touched), then AUTO rows that don't
  // collide with a manual row's natural key. Old mp-* rows are replaced
  // wholesale by the fresh derivation.
  const manualCountries = prefs.countriesOfInterest.filter((c) => !isDerivedId(c.id));
  const haveCountry = new Set(manualCountries.map((c) => c.country.trim().toLowerCase()));
  const countries = [
    ...manualCountries,
    ...derived.countries.filter((c) => !haveCountry.has(c.country.trim().toLowerCase())),
  ].slice(0, CAPS.countries);

  const manualBases = prefs.forceLocations.filter((b) => !isDerivedId(b.id));
  const haveIcao = new Set(manualBases.map((b) => (b.icao ?? "").toUpperCase()).filter(Boolean));
  const bases = [
    ...manualBases,
    ...derived.bases.filter((b) => !haveIcao.has((b.icao ?? "").toUpperCase())),
  ].slice(0, CAPS.bases);

  const manualWeather = prefs.trackedLocations.filter((w) => !isDerivedId(w.id));
  const weather = [...manualWeather, ...derived.weatherPoints].slice(0, CAPS.weather);

  // METAR stations have no id — merge by ICAO, existing first.
  const haveMetar = new Set(prefs.metarStations.map((m) => m.icao.toUpperCase()));
  const metar = [
    ...prefs.metarStations,
    ...derived.metarStations.filter((m) => !haveMetar.has(m.icao.toUpperCase())),
  ].slice(0, CAPS.metar);

  // Watchlist: append missing seeds (personal-ish field but lives on the
  // shared row for the owner; seeds are additive and short).
  const haveTerm = new Set(prefs.watchlist.map((t) => t.toLowerCase()));
  const newTerms = derived.watchlistSeeds.filter((t) => !haveTerm.has(t.toLowerCase()));
  const watchlist = [...prefs.watchlist, ...newTerms];

  // SITREP bases: only when the user confirmed picks on the review screen.
  let sitrepBases = prefs.sitrepBases;
  if (sitrepPicks.length > 0) {
    const byIcao = new Map(derived.sitrepCandidates.map((s) => [s.icao, s]));
    const picked = sitrepPicks
      .map((i) => i.toUpperCase())
      .map((i) => byIcao.get(i) ?? prefs.sitrepBases.find((s) => s.icao === i))
      .filter((s): s is NonNullable<typeof s> => s != null)
      .slice(0, SITREP_MAX);
    if (picked.length > 0) sitrepBases = picked;
  }

  const next: Omit<UserPrefs, "lastUpdated"> = {
    ...prefs,
    countriesOfInterest: countries,
    forceLocations: bases,
    trackedLocations: weather,
    metarStations: metar,
    watchlist,
    sitrepBases,
  };
  await saveUserPrefs(next);

  profile.materializedIds = derivedIds(derived);
  await saveMissionProfile(profile);

  return {
    profile,
    derived,
    counts: {
      countries: countries.length,
      bases: bases.length,
      weatherPoints: weather.length,
      metarStations: metar.length,
      sitrepBases: sitrepBases.length,
      watchlistAdded: newTerms.length,
    },
  };
}
