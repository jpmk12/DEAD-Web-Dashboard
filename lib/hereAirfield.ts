// Which tracked airfield the Glance "Where you are" strip reads — PURE,
// client-safe, tested (tests/hereAirfield.test.ts).
//
// Why this exists (2026-11-04, "why does LLBG show up here instead of any of
// my hubs?"): the strip took the NEAREST tracked field to the effective
// location, whatever its role. A TDY typed as a country ("Jordan") geocodes to
// the country's CENTROID, out in the desert, and Ben Gurion sat closer to that
// point than the declared hub at the far end of the country. Nearest-to-a-
// centroid is not "the field that matters where you are". The rule now:
//   1. your own hub, then your spokes, then your ★ fields — those within
//      NEAR_KM of the point or in the trip's country;
//   2. else any tracked field in the trip's country;
//   3. else the nearest tracked field within NEAR_KM.
// Nearest wins inside a tier. The pick carries WHY, and the strip says it.

import { knownCountryNames, normalizeCountryName, sameCountry } from "./countryNames";

export const NEAR_KM = 300;
/** A field "in the trip's country" further than this from the point is not
 *  credible (a mis-tagged country) and is left out. */
export const COUNTRY_MAX_KM = 1500;

export interface HereField {
  icao: string;
  label: string;
  lat: number;
  lon: number;
  country: string;
  own: "hub" | "spoke" | null;
  star: boolean;
}

export type HereWhy = "hub" | "spoke" | "star" | "country" | "nearest";

export interface HerePick extends HereField { km: number; why: HereWhy }

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

let KNOWN: Set<string> | null = null;
/** The country a trip names — its label's last comma part, else its raw
 *  location's — only when it IS a country ("Amman" alone names none). */
export function tripCountry(...texts: (string | null | undefined)[]): string | null {
  KNOWN ??= new Set(knownCountryNames().map((n) => n.toLowerCase()));
  for (const t of texts) {
    const last = (t ?? "").split(",").pop()?.trim() ?? "";
    if (!last) continue;
    const n = normalizeCountryName(last);
    if (n && KNOWN.has(n.toLowerCase())) return n;
  }
  return null;
}

const TIER: Record<HereWhy, number> = { hub: 0, spoke: 1, star: 2, country: 3, nearest: 4 };

export function pickHereAirfield(
  p: { lat: number; lon: number },
  fields: HereField[],
  country: string | null = null,
): HerePick | null {
  let best: HerePick | null = null;
  for (const f of fields) {
    if (!f.icao || (!f.lat && !f.lon)) continue;
    const km = haversineKm(p.lat, p.lon, f.lat, f.lon);
    const near = km <= NEAR_KM;
    const inCountry = !!country && sameCountry(f.country, country) && km <= COUNTRY_MAX_KM;
    if (!near && !inCountry) continue;
    const why: HereWhy = f.own === "hub" ? "hub" : f.own === "spoke" ? "spoke" : f.star ? "star" : inCountry ? "country" : "nearest";
    const cand: HerePick = { ...f, km, why };
    if (!best || TIER[why] < TIER[best.why] || (TIER[why] === TIER[best.why] && km < best.km)) best = cand;
  }
  return best;
}

/** The few words the strip shows beside the ICAO. */
export function hereWhyLabel(why: HereWhy, country: string | null): string {
  switch (why) {
    case "hub": return "your hub";
    case "spoke": return "your spoke";
    case "star": return "★ must-track";
    case "country": return country ? `tracked field in ${country}` : "tracked field";
    default: return "nearest tracked field";
  }
}
