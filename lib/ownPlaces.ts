// The operator's own fields as the lift-chatter grammar wants them —
// SERVER-ONLY. The tracking registry (lib/trackingRegistry, PURE) already
// folds the hub, the spokes, the SITREP bases, the posture rows and the
// METAR stations into one record per ICAO; this hands that list to
// `readChatter({ ownPlaces })` so a spotter post naming YOUR spoke places
// and carries `mine`. Three-minute cache; a failed read returns [] so the
// grammar falls back to the catalogue — a dead prefs row must never stop
// the sweep. Deliberately does not import lib/trackingOps (which imports
// lib/sitrep) so the SITREP assembler can read chatter without a cycle.

import { getUserPrefs } from "./userPrefs";
import { getMissionProfile } from "./missionProfileApply";
import { buildRegistry } from "./trackingRegistry";
import { classifyAor } from "./aor";
import type { OwnPlace } from "./mobilityChatter";

const TTL = 3 * 60 * 1000;
let cache: { at: number; places: OwnPlace[] } | null = null;

export async function getOwnPlaces(): Promise<OwnPlace[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.places;
  try {
    const [prefs, profile] = await Promise.all([getUserPrefs(), getMissionProfile()]);
    const reg = buildRegistry({
      forceLocations: prefs.forceLocations, countriesOfInterest: prefs.countriesOfInterest, metarStations: prefs.metarStations,
      sitrepBases: prefs.sitrepBases, trackedLocations: prefs.trackedLocations, watchlist: prefs.watchlist,
    }, profile);
    const places: OwnPlace[] = reg.airfields
      .filter((a) => /^[A-Z0-9]{4}$/.test(a.icao))
      .map((a) => ({
        icao: a.icao, label: a.label || a.icao,
        // A METAR-only station sits at 0/0 in the pure registry; the country still places it.
        aor: a.aor !== "UNKNOWN" ? a.aor : classifyAor({ lat: a.lat, lon: a.lon, name: a.country }),
        own: a.own, star: a.roles.star,
      }));
    cache = { at: Date.now(), places };
    return places;
  } catch {
    return cache?.places ?? [];
  }
}

export function resetOwnPlacesCache(): void { cache = null; }
