// Curated FIR (Flight Information Region) table for the Crisis-map "Overflight"
// layer: maps watched countries → their FIR ICAO code(s), each with an
// approximate centroid for plotting the FIR's enroute/airspace NOTAM marker.
//
// This is the airspace analog of lib/airfields.ts and MUST stay PURE data + math
// (no node:* / fetch imports). CrisisMap.tsx is a client component and the API
// route is server-side; keeping this dependency-free means it's safe to import
// from either without dragging Node-only modules into the client bundle, and it
// adds no npm dep (grep -c esbuild package-lock.json stays 0).
//
// Coverage is the mobility / conflict-overflight set (CENTCOM, EUCOM east,
// Africa, INDOPACOM hot spots), not the whole world — unknown countries simply
// resolve to no FIR (the layer skips them). FIR codes are the ICAO FIR/ACC
// identifiers DAIP's FIR_ARTCC query accepts in `locs`; centroids are rough
// geographic centers for pin placement only, not airspace boundaries.

export interface FirInfo {
  code: string;          // ICAO FIR identifier (DAIP `locs` value)
  name: string;          // human label
  lat: number;
  lon: number;
  countries: string[];   // lowercased country names this FIR serves
}

// One row per FIR. Multi-FIR countries (Russia, Ukraine) list several; a single
// country name may therefore map to more than one FIR.
export const FIRS: FirInfo[] = [
  // ── CENTCOM / Middle East ──────────────────────────────────────────────
  { code: "OSTT", name: "Damascus FIR", lat: 34.8, lon: 38.0, countries: ["syria"] },
  { code: "ORBB", name: "Baghdad FIR", lat: 33.2, lon: 43.7, countries: ["iraq"] },
  { code: "OIIX", name: "Tehran FIR", lat: 32.6, lon: 53.7, countries: ["iran"] },
  { code: "OLBB", name: "Beirut FIR", lat: 33.9, lon: 35.5, countries: ["lebanon"] },
  { code: "LLLL", name: "Tel Aviv FIR", lat: 31.5, lon: 34.9, countries: ["israel", "west bank", "gaza"] },
  { code: "OJAC", name: "Amman FIR", lat: 31.2, lon: 36.5, countries: ["jordan"] },
  { code: "OEJD", name: "Jeddah FIR", lat: 24.0, lon: 44.0, countries: ["saudi arabia"] },
  { code: "OYSC", name: "Sanaa FIR", lat: 15.6, lon: 47.5, countries: ["yemen"] },
  { code: "OOMM", name: "Muscat FIR", lat: 21.5, lon: 56.5, countries: ["oman", "united arab emirates", "uae"] },
  { code: "OBBB", name: "Bahrain FIR", lat: 26.5, lon: 50.6, countries: ["bahrain", "qatar"] },
  { code: "OKAC", name: "Kuwait FIR", lat: 29.3, lon: 47.7, countries: ["kuwait"] },
  { code: "OAKX", name: "Kabul FIR", lat: 34.3, lon: 66.0, countries: ["afghanistan"] },
  { code: "OPKR", name: "Karachi FIR", lat: 26.0, lon: 67.5, countries: ["pakistan"] },
  { code: "OPLR", name: "Lahore FIR", lat: 31.5, lon: 73.0, countries: ["pakistan"] },

  // ── Türkiye / Caucasus ─────────────────────────────────────────────────
  { code: "LTAA", name: "Ankara FIR", lat: 39.0, lon: 35.2, countries: ["turkey", "türkiye"] },
  { code: "LTBB", name: "Istanbul FIR", lat: 40.5, lon: 29.0, countries: ["turkey", "türkiye"] },
  { code: "UGGG", name: "Tbilisi FIR", lat: 42.0, lon: 43.5, countries: ["georgia"] },
  { code: "UDDD", name: "Yerevan FIR", lat: 40.2, lon: 44.9, countries: ["armenia"] },
  { code: "UBBA", name: "Baku FIR", lat: 40.3, lon: 48.0, countries: ["azerbaijan"] },

  // ── Eastern Europe / Russia ────────────────────────────────────────────
  { code: "UKBV", name: "Kyiv FIR", lat: 50.0, lon: 30.5, countries: ["ukraine"] },
  { code: "UKOV", name: "Odesa FIR", lat: 46.5, lon: 30.7, countries: ["ukraine"] },
  { code: "UKFV", name: "Dnipro FIR", lat: 48.4, lon: 35.0, countries: ["ukraine"] },
  { code: "UKLV", name: "Lviv FIR", lat: 49.8, lon: 24.0, countries: ["ukraine"] },
  { code: "UMMV", name: "Minsk FIR", lat: 53.7, lon: 27.9, countries: ["belarus"] },
  { code: "UUWV", name: "Moscow FIR", lat: 55.5, lon: 37.5, countries: ["russia"] },
  { code: "URRV", name: "Rostov FIR", lat: 47.3, lon: 40.0, countries: ["russia"] },
  { code: "USSV", name: "Yekaterinburg FIR", lat: 56.8, lon: 60.6, countries: ["russia"] },
  { code: "EYVL", name: "Vilnius FIR", lat: 55.2, lon: 23.9, countries: ["lithuania"] },
  { code: "EVRR", name: "Riga FIR", lat: 56.9, lon: 24.6, countries: ["latvia"] },
  { code: "EETT", name: "Tallinn FIR", lat: 58.6, lon: 25.0, countries: ["estonia"] },
  { code: "EPWW", name: "Warsaw FIR", lat: 52.0, lon: 19.1, countries: ["poland"] },
  { code: "LRBB", name: "Bucharest FIR", lat: 45.9, lon: 24.9, countries: ["romania"] },
  { code: "LBSR", name: "Sofia FIR", lat: 42.7, lon: 25.5, countries: ["bulgaria"] },
  { code: "LUUU", name: "Chisinau FIR", lat: 47.4, lon: 28.4, countries: ["moldova"] },

  // ── Africa ─────────────────────────────────────────────────────────────
  { code: "HECC", name: "Cairo FIR", lat: 26.8, lon: 30.8, countries: ["egypt"] },
  { code: "HLLL", name: "Tripoli FIR", lat: 27.0, lon: 17.5, countries: ["libya"] },
  { code: "HSSS", name: "Khartoum FIR", lat: 15.5, lon: 30.5, countries: ["sudan", "south sudan"] },
  { code: "HCSM", name: "Mogadishu FIR", lat: 5.0, lon: 46.0, countries: ["somalia"] },
  { code: "HAAA", name: "Addis Ababa FIR", lat: 9.1, lon: 40.0, countries: ["ethiopia", "eritrea"] },
  { code: "DRRR", name: "Niamey FIR", lat: 16.5, lon: 8.0, countries: ["niger", "chad"] },
  { code: "GAAA", name: "Bamako FIR", lat: 17.0, lon: -3.5, countries: ["mali"] },
  { code: "DNKK", name: "Kano FIR", lat: 10.5, lon: 8.5, countries: ["nigeria", "burkina faso"] },

  // ── INDOPACOM hot spots ────────────────────────────────────────────────
  { code: "ZKKP", name: "Pyongyang FIR", lat: 39.5, lon: 127.0, countries: ["north korea"] },
  { code: "RKRR", name: "Incheon FIR", lat: 36.5, lon: 127.5, countries: ["south korea"] },
  { code: "VYMD", name: "Yangon FIR", lat: 21.0, lon: 96.0, countries: ["myanmar", "burma"] },
  { code: "RCAA", name: "Taipei FIR", lat: 24.0, lon: 121.0, countries: ["taiwan"] },
];

const BY_CODE = new Map(FIRS.map((f) => [f.code, f]));

// FIR by exact ICAO code (case-insensitive).
export function firByCode(code: string): FirInfo | undefined {
  return BY_CODE.get(code.trim().toUpperCase());
}

// All FIRs serving a country (case-insensitive, trimmed). [] if uncovered.
export function firsForCountry(country: string): FirInfo[] {
  const c = country.trim().toLowerCase();
  if (!c) return [];
  return FIRS.filter((f) => f.countries.includes(c));
}

// Resolve a mixed list of country names and/or FIR codes to a de-duped FIR set.
// Tokens matching a FIR code resolve directly; others are treated as country
// names. Unknown tokens are dropped.
export function resolveFirs(tokens: string[]): FirInfo[] {
  const out = new Map<string, FirInfo>();
  for (const t of tokens) {
    const tok = t.trim();
    if (!tok) continue;
    const direct = firByCode(tok);
    if (direct) { out.set(direct.code, direct); continue; }
    for (const f of firsForCountry(tok)) out.set(f.code, f);
  }
  return [...out.values()];
}
