// Country display names — ONE normalisation, PURE, client-safe, tested.
//
// Country strings reach the app from four shapes: the operator's typing
// ("jordan"), the airfield resolver (OurAirports ISO2 — "JO", "QA"; AMC hubs
// "" for everything outside the US), the derivation (title-cased from the
// centroid catalogue — "Dr Congo"), and the feeds (full names). Every
// country-keyed join — posture rows to SITREP bases, ★ countries to command
// rows, the manual-vs-AUTO collision check at Apply — compares strings, so a
// base whose country is "JO" never joined its "Jordan" posture row.
// `normalizeCountryName` is applied at the two boundaries where strings enter
// storage (the resolver and the prefs sanitiser) and wherever a name is
// compared, so the rest of the app can keep comparing with `toLowerCase()`.

const ISO2: Record<string, string> = {
  US: "United States", CA: "Canada", MX: "Mexico", GB: "United Kingdom", IE: "Ireland", FR: "France", DE: "Germany",
  ES: "Spain", PT: "Portugal", IT: "Italy", GR: "Greece", NO: "Norway", SE: "Sweden", FI: "Finland", DK: "Denmark",
  IS: "Iceland", PL: "Poland", NL: "Netherlands", BE: "Belgium", CH: "Switzerland", AT: "Austria", CZ: "Czech Republic",
  SK: "Slovakia", HU: "Hungary", RO: "Romania", BG: "Bulgaria", RS: "Serbia", HR: "Croatia", BA: "Bosnia and Herzegovina",
  AL: "Albania", SI: "Slovenia", MK: "North Macedonia", ME: "Montenegro", XK: "Kosovo", MD: "Moldova", BY: "Belarus",
  LT: "Lithuania", LV: "Latvia", EE: "Estonia", UA: "Ukraine", RU: "Russia", GE: "Georgia", AM: "Armenia", AZ: "Azerbaijan",
  TR: "Turkey", CY: "Cyprus", MT: "Malta", LU: "Luxembourg",
  EG: "Egypt", IR: "Iran", IQ: "Iraq", SY: "Syria", LB: "Lebanon", JO: "Jordan", IL: "Israel", PS: "Palestine",
  SA: "Saudi Arabia", YE: "Yemen", OM: "Oman", AE: "United Arab Emirates", QA: "Qatar", BH: "Bahrain", KW: "Kuwait",
  AF: "Afghanistan", PK: "Pakistan", KZ: "Kazakhstan", UZ: "Uzbekistan", TM: "Turkmenistan", TJ: "Tajikistan", KG: "Kyrgyzstan",
  NG: "Nigeria", ET: "Ethiopia", KE: "Kenya", SO: "Somalia", SS: "South Sudan", SD: "Sudan", CD: "Democratic Republic of the Congo",
  CG: "Congo", TZ: "Tanzania", UG: "Uganda", DZ: "Algeria", MA: "Morocco", TN: "Tunisia", LY: "Libya", TD: "Chad", NE: "Niger",
  ML: "Mali", MR: "Mauritania", SN: "Senegal", GH: "Ghana", CI: "Cote d'Ivoire", CM: "Cameroon", AO: "Angola", MZ: "Mozambique",
  ZM: "Zambia", ZW: "Zimbabwe", ZA: "South Africa", MG: "Madagascar", RW: "Rwanda", BI: "Burundi", MW: "Malawi", BW: "Botswana",
  NA: "Namibia", ER: "Eritrea", DJ: "Djibouti", SL: "Sierra Leone", LR: "Liberia", GW: "Guinea-Bissau", GQ: "Equatorial Guinea",
  GN: "Guinea", BF: "Burkina Faso", BJ: "Benin", TG: "Togo", GA: "Gabon", CF: "Central African Republic", GM: "Gambia",
  CV: "Cape Verde", SC: "Seychelles", MU: "Mauritius",
  PG: "Papua New Guinea", KP: "North Korea", KR: "South Korea", JP: "Japan", CN: "China", TW: "Taiwan", MN: "Mongolia",
  IN: "India", NP: "Nepal", BT: "Bhutan", BD: "Bangladesh", LK: "Sri Lanka", MV: "Maldives", MM: "Myanmar", TH: "Thailand",
  VN: "Vietnam", KH: "Cambodia", LA: "Laos", MY: "Malaysia", SG: "Singapore", ID: "Indonesia", PH: "Philippines", BN: "Brunei",
  TL: "Timor-Leste", AU: "Australia", NZ: "New Zealand", FJ: "Fiji", VU: "Vanuatu", SB: "Solomon Islands", TO: "Tonga",
  WS: "Samoa", FM: "Micronesia", PW: "Palau", MH: "Marshall Islands", KI: "Kiribati", GU: "Guam", MP: "Northern Mariana Islands",
  GT: "Guatemala", BZ: "Belize", HN: "Honduras", SV: "El Salvador", NI: "Nicaragua", CR: "Costa Rica", PA: "Panama",
  CO: "Colombia", VE: "Venezuela", GY: "Guyana", SR: "Suriname", EC: "Ecuador", PE: "Peru", BR: "Brazil", BO: "Bolivia",
  PY: "Paraguay", CL: "Chile", AR: "Argentina", UY: "Uruguay", CU: "Cuba", HT: "Haiti", DO: "Dominican Republic",
  JM: "Jamaica", TT: "Trinidad and Tobago", PR: "Puerto Rico", BS: "Bahamas", BB: "Barbados", GD: "Grenada", GL: "Greenland",
};

/** Names where the feeds' spelling and the catalogue's disagree — one
 *  canonical display form each (lower-cased key). */
const ALIASES: Record<string, string> = {
  "usa": "United States", "u.s.": "United States", "u.s.a.": "United States", "united states of america": "United States",
  "uk": "United Kingdom", "great britain": "United Kingdom", "türkiye": "Turkey", "turkiye": "Turkey",
  "burma": "Myanmar", "myanmar (burma)": "Myanmar", "dr congo": "Democratic Republic of the Congo",
  "congo, dem. rep.": "Democratic Republic of the Congo", "congo, rep.": "Congo",
  "iran, islamic rep.": "Iran", "islamic republic of iran": "Iran", "egypt, arab rep.": "Egypt", "yemen, rep.": "Yemen",
  "syrian arab republic": "Syria", "russian federation": "Russia", "venezuela, rb": "Venezuela",
  "korea, dem. people's rep.": "North Korea", "korea, rep.": "South Korea", "republic of korea": "South Korea",
  "lao pdr": "Laos", "kyrgyz republic": "Kyrgyzstan", "slovak republic": "Slovakia", "czechia": "Czech Republic",
  "gambia, the": "Gambia", "bahamas, the": "Bahamas", "west bank and gaza": "Palestine", "uae": "United Arab Emirates",
  "ivory coast": "Cote d'Ivoire", "côte d'ivoire": "Cote d'Ivoire", "east timor": "Timor-Leste", "eswatini": "Eswatini",
};

const SMALL = new Set(["of", "and", "the", "da", "de", "del", "la", "des"]);

/** Title-case a free-text name the way the catalogue does ("south sudan" → "South Sudan", "dr congo" is aliased first). */
export function titleCaseCountry(s: string): string {
  return s.trim().toLowerCase().split(/\s+/).map((w, i) =>
    SMALL.has(w) && i > 0 ? w : w.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("-"),
  ).join(" ").replace(/\b(d')(\w)/g, (_m, d: string, c: string) => d + c.toUpperCase());
}

/**
 * One display name for a country string in any of the shapes the app meets:
 * ISO2 ("JO"), an alias ("Türkiye"), a catalogue key ("saudi arabia"), or a
 * full name. "" stays "" — a blank is a fact (the resolver did not know), not
 * a country to invent.
 */
export function normalizeCountryName(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  if (/^[A-Za-z]{2}$/.test(s)) {
    const hit = ISO2[s.toUpperCase()];
    if (hit) return hit;
  }
  const alias = ALIASES[s.toLowerCase()];
  if (alias) return alias;
  return titleCaseCountry(s);
}

/** Every display name this module can produce from a code or alias — the
 *  candidate pool for a country search (deduped, sorted). */
export function knownCountryNames(extra: string[] = []): string[] {
  const set = new Set<string>([...Object.values(ISO2), ...Object.values(ALIASES), ...extra.map(normalizeCountryName)]);
  set.delete("");
  return [...set].sort();
}

/** Case-insensitive equality on the normalised form. */
export function sameCountry(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeCountryName(a).toLowerCase();
  const y = normalizeCountryName(b).toLowerCase();
  return !!x && x === y;
}
