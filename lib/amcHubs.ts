// AMC en route / staging hub presets for the Weather tab.
//
// Air Mobility Command's global reach runs through a known set of mobility
// bases and en route stops. These let the user one-tap-add a hub as a tracked
// location (map + AOR threat board) AND register its ICAO for global METAR/TAF
// — the aviation weather that actually governs airlift (ceilings, visibility,
// winds, crosswind), which works worldwide even where NWS (US-only) forecasts
// don't.
//
// Coordinates are airfield reference points — good enough for a weather point
// lookup, not for navigation. This is coarse situational awareness, not an
// authoritative airfield database.

export interface AmcHub {
  icao: string;
  name: string;
  lat: number;
  lon: number;
  // Contingency-response ("open the airfield") force home-stationed here, if any.
  // The CRG/CRW + AMOW associations are coarse/illustrative SA, not authoritative.
  crf?: string;
}

// Ordered regions → hubs. Region labels double as the chip-group headers.
export const AMC_HUBS: { region: string; hubs: AmcHub[] }[] = [
  {
    region: "CONUS & Alaska",
    hubs: [
      { icao: "KSUU", name: "Travis AFB, CA", lat: 38.2627, lon: -121.927, crf: "821 CRG" },
      { icao: "KDOV", name: "Dover AFB, DE", lat: 39.1296, lon: -75.467 },
      { icao: "KCHS", name: "JB Charleston, SC", lat: 32.8986, lon: -80.0405 },
      { icao: "KWRI", name: "JB MDL (McGuire), NJ", lat: 40.0155, lon: -74.5917, crf: "621 CRW" },
      { icao: "KBLV", name: "Scott AFB, IL", lat: 38.5452, lon: -89.8351 },
      { icao: "KLTS", name: "Altus AFB, OK", lat: 34.6671, lon: -99.2668 },
      { icao: "KTCM", name: "JB Lewis-McChord, WA", lat: 47.1377, lon: -122.4843 },
      { icao: "KMCF", name: "MacDill AFB, FL", lat: 27.8493, lon: -82.5211 },
      { icao: "KADW", name: "JB Andrews, MD", lat: 38.8108, lon: -76.867 },
      { icao: "PAED", name: "JB Elmendorf, AK", lat: 61.251, lon: -149.806 },
    ],
  },
  {
    region: "Europe & Atlantic",
    hubs: [
      { icao: "ETAR", name: "Ramstein AB, DE", lat: 49.4369, lon: 7.6003, crf: "521 AMOW" },
      { icao: "LERT", name: "NS Rota, ES", lat: 36.6453, lon: -6.3495 },
      { icao: "LICZ", name: "NAS Sigonella, IT", lat: 37.4017, lon: 14.9224 },
      { icao: "LIPA", name: "Aviano AB, IT", lat: 46.0319, lon: 12.5965 },
      { icao: "EGUN", name: "RAF Mildenhall, UK", lat: 52.3619, lon: 0.4864 },
      { icao: "LPLA", name: "Lajes Field, Azores", lat: 38.7618, lon: -27.0908 },
    ],
  },
  {
    region: "CENTCOM",
    hubs: [
      { icao: "OTBH", name: "Al Udeid AB, QA", lat: 25.1173, lon: 51.315 },
      { icao: "OKAS", name: "Ali Al Salem AB, KW", lat: 29.3467, lon: 47.5208 },
      { icao: "LTAG", name: "Incirlik AB, TR", lat: 37.0021, lon: 35.4259 },
    ],
  },
  {
    region: "Africa",
    hubs: [
      { icao: "HDAM", name: "Camp Lemonnier, DJ", lat: 11.5472, lon: 43.1595 },
    ],
  },
  {
    region: "Indo-Pacific",
    hubs: [
      { icao: "PHIK", name: "JB Pearl Harbor-Hickam, HI", lat: 21.3187, lon: -157.9224, crf: "515 AMOW" },
      { icao: "PGUA", name: "Andersen AFB, Guam", lat: 13.584, lon: 144.93, crf: "36 CRG" },
      { icao: "RJTY", name: "Yokota AB, JP", lat: 35.7485, lon: 139.3486 },
      { icao: "RODN", name: "Kadena AB, JP", lat: 26.3556, lon: 127.7692 },
      { icao: "RKSO", name: "Osan AB, KR", lat: 37.0906, lon: 127.0297 },
      { icao: "FJDG", name: "Diego Garcia", lat: -7.3133, lon: 72.4111 },
    ],
  },
];
