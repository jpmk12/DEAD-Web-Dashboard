// Shared ICAO → airfield resolution — SERVER-ONLY (OurAirports fetch).
// Curated sets first (AMC hubs, gateways — they carry good display names),
// then the OurAirports global CSV. Used by the SITREP base picker, the
// Mission Profile spoke editor, and anything else that turns a bare ICAO
// into a labeled point.

import { ALL_AIRFIELDS } from "./airfields";
import { AMC_HUBS } from "./amcHubs";
import { airportByIdent } from "./ourAirports";

export interface ResolvedAirfield {
  icao: string;
  label: string;
  lat: number;
  lon: number;
  country: string;
  place: string;
}

export async function resolveAirfield(icaoRaw: string): Promise<ResolvedAirfield | null> {
  const icao = icaoRaw.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(icao)) return null;

  for (const region of AMC_HUBS) {
    const hub = region.hubs.find((h) => h.icao === icao);
    if (hub) {
      const country = /^K|^P[AHG]/.test(icao) ? "United States" : "";
      return { icao, label: hub.name, lat: hub.lat, lon: hub.lon, country, place: hub.name };
    }
  }
  const gw = ALL_AIRFIELDS.find((a) => a.icao === icao);
  if (gw) {
    return { icao, label: gw.name, lat: gw.lat, lon: gw.lon, country: gw.country ?? "", place: gw.name };
  }
  const oa = await airportByIdent(icao).catch(() => null);
  if (oa) {
    // OurAirports carries an ISO2 country code; "US" is the one worth
    // expanding (State-advisory matching), the rest pass through as-is.
    const country = oa.country === "US" ? "United States" : oa.country;
    return { icao, label: oa.name.slice(0, 80), lat: oa.lat, lon: oa.lon, country, place: oa.name.slice(0, 120) };
  }
  return null;
}
