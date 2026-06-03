// Maps a disaster's location to a U.S. geographic combatant command Area of
// Responsibility (UCP-aligned). This is a COARSE situational-awareness
// classification, not an authoritative boundary: coastal/border cases near
// AOR seams (e.g. Egypt/Libya, Turkey/Syria, the Caucasus) are approximate.
// Coords are preferred when present (geography is unambiguous); a country/
// place-name lookup backstops coord-less events (e.g. ReliefWeb epidemics).

export type Aor = "NORTHCOM" | "SOUTHCOM" | "EUCOM" | "CENTCOM" | "AFRICOM" | "INDOPACOM" | "UNKNOWN";

export const AOR_LABELS: Record<Aor, string> = {
  NORTHCOM: "USNORTHCOM",
  SOUTHCOM: "USSOUTHCOM",
  EUCOM: "USEUCOM",
  CENTCOM: "USCENTCOM",
  AFRICOM: "USAFRICOM",
  INDOPACOM: "USINDOPACOM",
  UNKNOWN: "Unknown AOR",
};

// Country / region tokens → AOR. Longest token wins (checked length-desc) so
// "papua new guinea" beats "guinea" and "equatorial guinea" beats "guinea".
const COUNTRY_AOR: Record<Aor, string[]> = {
  NORTHCOM: ["united states", "u.s.a", "usa", "canada", "mexico", "greenland", "bahamas"],
  SOUTHCOM: [
    "guatemala", "belize", "honduras", "el salvador", "nicaragua", "costa rica", "panama",
    "colombia", "venezuela", "guyana", "suriname", "ecuador", "peru", "brazil", "bolivia",
    "paraguay", "chile", "argentina", "uruguay", "cuba", "haiti", "dominican republic",
    "jamaica", "trinidad", "puerto rico", "caribbean", "barbados", "grenada",
  ],
  EUCOM: [
    "russia", "ukraine", "turkey", "türkiye", "united kingdom", "ireland", "france", "germany",
    "spain", "portugal", "italy", "greece", "norway", "sweden", "finland", "denmark", "iceland",
    "poland", "netherlands", "belgium", "switzerland", "austria", "czech", "slovakia", "hungary",
    "romania", "bulgaria", "serbia", "croatia", "bosnia", "albania", "slovenia", "north macedonia",
    "macedonia", "montenegro", "kosovo", "moldova", "belarus", "lithuania", "latvia", "estonia",
    "georgia", "armenia", "azerbaijan", "cyprus", "malta", "luxembourg", "europe",
  ],
  CENTCOM: [
    "egypt", "iran", "iraq", "syria", "lebanon", "jordan", "israel", "palestine", "west bank",
    "gaza", "saudi arabia", "yemen", "oman", "united arab emirates", "u.a.e", "uae", "qatar",
    "bahrain", "kuwait", "afghanistan", "pakistan", "kazakhstan", "uzbekistan", "turkmenistan",
    "tajikistan", "kyrgyzstan",
  ],
  AFRICOM: [
    "nigeria", "ethiopia", "kenya", "somalia", "south sudan", "sudan", "dr congo",
    "democratic republic of the congo", "congo", "tanzania", "uganda", "algeria", "morocco",
    "tunisia", "libya", "chad", "niger", "mali", "mauritania", "senegal", "ghana",
    "cote d'ivoire", "ivory coast", "cameroon", "angola", "mozambique", "zambia", "zimbabwe",
    "south africa", "madagascar", "rwanda", "burundi", "malawi", "botswana", "namibia",
    "eritrea", "djibouti", "sierra leone", "liberia", "guinea-bissau", "equatorial guinea",
    "guinea", "burkina faso", "benin", "togo", "gabon", "central african republic", "eswatini",
    "lesotho", "gambia", "cape verde", "seychelles", "mauritius", "comoros", "africa",
  ],
  INDOPACOM: [
    "papua new guinea", "north korea", "south korea", "korea", "japan", "china", "taiwan",
    "mongolia", "india", "nepal", "bhutan", "bangladesh", "sri lanka", "maldives", "myanmar",
    "burma", "thailand", "vietnam", "cambodia", "laos", "malaysia", "singapore", "indonesia",
    "philippines", "brunei", "timor-leste", "east timor", "australia", "new zealand", "fiji",
    "vanuatu", "solomon islands", "tonga", "samoa", "micronesia", "palau", "marshall islands",
    "kiribati", "tuvalu", "nauru", "guam", "hawaii", "northern mariana",
  ],
  UNKNOWN: [],
};

// Pre-sorted [token, aor] pairs, longest first, for unambiguous substring match.
const NAME_INDEX: { token: string; aor: Aor }[] = (Object.keys(COUNTRY_AOR) as Aor[])
  .flatMap((aor) => COUNTRY_AOR[aor].map((token) => ({ token, aor })))
  .sort((a, b) => b.token.length - a.token.length);

export function aorFromName(name: string): Aor {
  const t = name.toLowerCase();
  for (const { token, aor } of NAME_INDEX) {
    if (t.includes(token)) return aor;
  }
  return "UNKNOWN";
}

export function aorFromCoords(lat: number, lon: number): Aor {
  const L = (((lon + 180) % 360) + 360) % 360 - 180; // normalize to [-180,180)

  // The Aleutian chain straddles the dateline but is Alaska → NORTHCOM. Bounded
  // to lat 50–60 so far-NE Russia (Chukotka, higher lat) isn't swept in.
  if (lat >= 50 && lat <= 60 && (L <= -130 || L >= 172)) return "NORTHCOM";
  // Chukotka (far-NE Russia) wraps past the dateline to negative lon → EUCOM.
  if (lat >= 60 && L <= -170) return "EUCOM";

  // Mid-Pacific islands east of the mainland (Hawaii, Polynesia) → INDOPACOM.
  if (L <= -125 && lat <= 30 && lat >= -55) return "INDOPACOM";

  // The Americas.
  if (L <= -30 && L >= -170) {
    if (lat >= 23.5) return "NORTHCOM";               // US / Canada / Alaska / N. Mexico
    if (lat >= 14 && L <= -86) return "NORTHCOM";      // most of Mexico
    return "SOUTHCOM";                                 // Caribbean, Central & South America
  }

  // Africa / Europe / Middle East.
  if (L > -30 && L < 63) {
    if (lat >= 36) return "EUCOM";                     // Europe & the Caucasus
    if (L >= 26 && lat >= 12 && lat <= 40) return "CENTCOM"; // Egypt, Levant, Arabia, W. Iran
    return "AFRICOM";
  }

  // CENTCOM east: Iran-east / Afghanistan / Pakistan / the Stans.
  if (L >= 63 && L < 78 && lat >= 23 && lat <= 50) return "CENTCOM";
  // Russia / Siberia.
  if (lat >= 50 && L >= 60) return "EUCOM";

  // Everything else across Asia-Pacific.
  return "INDOPACOM";
}

// Classify by coords when available (geography is unambiguous), else by name.
export function classifyAor(opts: { lat?: number | null; lon?: number | null; name?: string }): Aor {
  if (opts.lat != null && opts.lon != null) return aorFromCoords(opts.lat, opts.lon);
  if (opts.name) return aorFromName(opts.name);
  return "UNKNOWN";
}
