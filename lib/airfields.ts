// Mobility airfield set for the Crisis map's "where could we land / open / reopen
// a field near this crisis" question. Hybrid by design:
//   1. CURATED baseline (this file) — the AMC hub network plus major international
//      gateways near crisis-prone regions, all C-17/C-130-capable. Instant, no
//      fetch, so the nearest-airfield answer is always available.
//   2. (Planned) on-demand global fill from OurAirports for fields not in the
//      curated set, fetched + cached so it doesn't add load time on every view.
//
// Coordinates are airfield reference points — coarse SA, not navigation.

import { AMC_HUBS } from "./amcHubs";
import { haversineKm } from "./disasters";

export interface MobilityAirfield {
  icao: string;
  name: string;
  lat: number;
  lon: number;
  country?: string;
  kind: "amc-hub" | "gateway";
  crf?: string; // contingency-response ("open the airfield") force, for AMC hubs
}

// Major international gateways with long, hard runways, positioned to cover the
// crisis-prone peripheries the AMC hub set (mostly US bases) doesn't — East/West
// Africa, the Levant/Gulf, South & SE Asia, the Pacific, and the Caribbean/LatAm.
const GATEWAYS: MobilityAirfield[] = [
  // AFRICOM
  { icao: "HKJK", name: "Nairobi (Jomo Kenyatta), KE", lat: -1.32, lon: 36.93, country: "Kenya", kind: "gateway" },
  { icao: "HUEN", name: "Entebbe, UG", lat: 0.04, lon: 32.44, country: "Uganda", kind: "gateway" },
  { icao: "HAAB", name: "Addis Ababa (Bole), ET", lat: 8.98, lon: 38.80, country: "Ethiopia", kind: "gateway" },
  { icao: "GOBD", name: "Dakar (Blaise Diagne), SN", lat: 14.67, lon: -17.07, country: "Senegal", kind: "gateway" },
  { icao: "DGAA", name: "Accra (Kotoka), GH", lat: 5.60, lon: -0.17, country: "Ghana", kind: "gateway" },
  { icao: "DNMM", name: "Lagos (Murtala Muhammed), NG", lat: 6.58, lon: 3.32, country: "Nigeria", kind: "gateway" },
  { icao: "HECA", name: "Cairo, EG", lat: 30.11, lon: 31.41, country: "Egypt", kind: "gateway" },
  // CENTCOM
  { icao: "OJAI", name: "Amman (Queen Alia), JO", lat: 31.72, lon: 36.00, country: "Jordan", kind: "gateway" },
  { icao: "OBBI", name: "Bahrain Intl, BH", lat: 26.27, lon: 50.63, country: "Bahrain", kind: "gateway" },
  { icao: "OKBK", name: "Kuwait Intl, KW", lat: 29.23, lon: 47.97, country: "Kuwait", kind: "gateway" },
  { icao: "OERK", name: "Riyadh (King Khalid), SA", lat: 24.96, lon: 46.70, country: "Saudi Arabia", kind: "gateway" },
  { icao: "OOMS", name: "Muscat, OM", lat: 23.59, lon: 58.28, country: "Oman", kind: "gateway" },
  // EUCOM periphery
  { icao: "LCLK", name: "Larnaca, CY", lat: 34.88, lon: 33.63, country: "Cyprus", kind: "gateway" },
  { icao: "LROP", name: "Bucharest (Otopeni), RO", lat: 44.57, lon: 26.09, country: "Romania", kind: "gateway" },
  { icao: "LGAV", name: "Athens, GR", lat: 37.94, lon: 23.95, country: "Greece", kind: "gateway" },
  // INDOPACOM
  { icao: "RPLL", name: "Manila (Ninoy Aquino), PH", lat: 14.51, lon: 121.02, country: "Philippines", kind: "gateway" },
  { icao: "WSSS", name: "Singapore (Changi), SG", lat: 1.36, lon: 103.99, country: "Singapore", kind: "gateway" },
  { icao: "VTBS", name: "Bangkok (Suvarnabhumi), TH", lat: 13.69, lon: 100.75, country: "Thailand", kind: "gateway" },
  { icao: "YPDN", name: "Darwin, AU", lat: -12.41, lon: 130.88, country: "Australia", kind: "gateway" },
  { icao: "VNKT", name: "Kathmandu, NP", lat: 27.70, lon: 85.36, country: "Nepal", kind: "gateway" },
  { icao: "VGHS", name: "Dhaka, BD", lat: 23.84, lon: 90.40, country: "Bangladesh", kind: "gateway" },
  // SOUTHCOM
  { icao: "MTPP", name: "Port-au-Prince, HT", lat: 18.58, lon: -72.29, country: "Haiti", kind: "gateway" },
  { icao: "MPTO", name: "Panama City (Tocumen), PA", lat: 9.07, lon: -79.38, country: "Panama", kind: "gateway" },
  { icao: "SKBO", name: "Bogotá (El Dorado), CO", lat: 4.70, lon: -74.15, country: "Colombia", kind: "gateway" },
];

const FLAT_HUBS: MobilityAirfield[] = AMC_HUBS.flatMap((r) =>
  r.hubs.map((h) => ({ icao: h.icao, name: h.name, lat: h.lat, lon: h.lon, kind: "amc-hub" as const, crf: h.crf })),
);

// The full curated set: AMC hubs first (preferred — US/allied mobility infra),
// then international gateways.
export const ALL_AIRFIELDS: MobilityAirfield[] = [...FLAT_HUBS, ...GATEWAYS];

// Nearest curated mobility airfields to a point, with great-circle distance (km).
export function nearestAirfields(lat: number, lon: number, n = 2, maxKm = 5000): (MobilityAirfield & { km: number })[] {
  return ALL_AIRFIELDS
    .map((a) => ({ ...a, km: Math.round(haversineKm(lat, lon, a.lat, a.lon)) }))
    .filter((a) => a.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}
