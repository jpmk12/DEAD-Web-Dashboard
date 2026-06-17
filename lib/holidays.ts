// Public holidays for the Regional dossier (Ground Truth), via Nager.Date
// (date.nager.at) — keyless, HTTPS. Host-nation public holidays matter for crew
// planning: closed government offices, customs/ports, banks, reduced ramp/ATC
// staffing. Fills the gap the curated lib/civilCalendar.ts (observances/national
// days/elections/anniversaries) doesn't cover country-by-country.
//
// Kept OUT of civilCalendar.ts on purpose: that module is pure/synchronous and
// imported widely; Nager.Date is a network call, so it lives here and is merged
// into the dossier's civil section server-side. The filter (upcomingHolidays) is
// pure and unit-tested; the fetch is cached in-process (holidays change rarely).
// Pure fetch — no new npm dep, so esbuild count stays 0.

export interface Holiday { date: string; name: string; localName: string; global: boolean }
export interface UpcomingHoliday { label: string; date: string; daysUntil: number; active: boolean }

const DAY = 86_400_000;
const API = "https://date.nager.at/api/v3/PublicHolidays";
const UA = "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)";
const TTL = 24 * 60 * 60 * 1000;

// Country name → ISO 3166-1 alpha-2 (Nager.Date's country code). Lowercased keys;
// covers the mobility / crisis set the dashboard watches (mirrors the
// countryCentroids coverage). Unknown names resolve to null → no holidays.
const ISO2: Record<string, string> = {
  afghanistan: "AF", albania: "AL", algeria: "DZ", armenia: "AM", australia: "AU",
  austria: "AT", azerbaijan: "AZ", bahrain: "BH", bangladesh: "BD", belarus: "BY",
  belgium: "BE", "bosnia and herzegovina": "BA", bulgaria: "BG", "burkina faso": "BF",
  cameroon: "CM", canada: "CA", "central african republic": "CF", chad: "TD",
  chile: "CL", china: "CN", colombia: "CO", congo: "CG",
  "democratic republic of the congo": "CD", "dr congo": "CD", croatia: "HR", cuba: "CU",
  cyprus: "CY", "czech republic": "CZ", czechia: "CZ", denmark: "DK", ecuador: "EC",
  egypt: "EG", "el salvador": "SV", estonia: "EE", ethiopia: "ET", finland: "FI",
  france: "FR", georgia: "GE", germany: "DE", greece: "GR", guatemala: "GT",
  guinea: "GN", haiti: "HT", honduras: "HN", hungary: "HU", india: "IN",
  indonesia: "ID", iran: "IR", iraq: "IQ", ireland: "IE", israel: "IL", italy: "IT",
  japan: "JP", jordan: "JO", kazakhstan: "KZ", kenya: "KE", kuwait: "KW",
  kyrgyzstan: "KG", latvia: "LV", lebanon: "LB", libya: "LY", lithuania: "LT",
  luxembourg: "LU", madagascar: "MG", malaysia: "MY", mali: "ML", malta: "MT",
  mauritania: "MR", mexico: "MX", moldova: "MD", mongolia: "MN", montenegro: "ME",
  morocco: "MA", mozambique: "MZ", myanmar: "MM", burma: "MM", nepal: "NP",
  netherlands: "NL", "new zealand": "NZ", nicaragua: "NI", niger: "NE", nigeria: "NG",
  "north korea": "KP", "north macedonia": "MK", norway: "NO", oman: "OM",
  pakistan: "PK", panama: "PA", "papua new guinea": "PG", peru: "PE", philippines: "PH",
  poland: "PL", portugal: "PT", qatar: "QA", romania: "RO", russia: "RU",
  rwanda: "RW", "saudi arabia": "SA", senegal: "SN", serbia: "RS", singapore: "SG",
  slovakia: "SK", slovenia: "SI", somalia: "SO", "south africa": "ZA",
  "south korea": "KR", "south sudan": "SS", spain: "ES", "sri lanka": "LK", sudan: "SD",
  sweden: "SE", switzerland: "CH", syria: "SY", taiwan: "TW", tajikistan: "TJ",
  tanzania: "TZ", thailand: "TH", tunisia: "TN", turkey: "TR", "türkiye": "TR",
  turkmenistan: "TM", uganda: "UG", ukraine: "UA", "united arab emirates": "AE",
  uae: "AE", "united kingdom": "GB", "united states": "US", uruguay: "UY",
  uzbekistan: "UZ", venezuela: "VE", vietnam: "VN", yemen: "YE", zimbabwe: "ZW",
};

// Loose country-name match (mirrors the inline helper in groundTruth.ts /
// civilCalendar.ts so a name like "Republic of Iraq" resolves to "iraq").
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\b(the|of|republic|democratic|peoples?)\b/g, "").trim();
}
function countryMatch(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

// Country name → ISO2 (case-insensitive, loose match against the table).
export function countryIso2(country: string): string | null {
  const c = country.trim().toLowerCase();
  if (!c) return null;
  if (ISO2[c]) return ISO2[c];
  // loose match (handles "the …", "republic of …" etc. via countryMatch)
  for (const [name, code] of Object.entries(ISO2)) if (countryMatch(name, c)) return code;
  return null;
}

// PURE: upcoming public holidays within the lookahead window, soonest first.
// `active` = the holiday is today (UTC). Deterministic given `nowMs`.
export function upcomingHolidays(holidays: Holiday[], nowMs: number, lookaheadDays = 30): UpcomingHoliday[] {
  const today = Math.floor(nowMs / DAY) * DAY;
  const out: UpcomingHoliday[] = [];
  for (const h of holidays) {
    const t = Date.parse(`${h.date}T00:00:00Z`);
    if (!Number.isFinite(t)) continue;
    const daysUntil = Math.round((t - today) / DAY);
    if (daysUntil < 0 || daysUntil > lookaheadDays) continue;
    const label = h.localName && h.localName !== h.name ? `${h.name} (${h.localName})` : (h.name || h.localName);
    if (!label) continue;
    out.push({ label, date: h.date, daysUntil, active: daysUntil === 0 });
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil).slice(0, 6);
}

const cache = new Map<string, { holidays: Holiday[]; expires: number }>();

async function fetchYear(iso2: string, year: number): Promise<Holiday[]> {
  const key = `${iso2}-${year}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.holidays;
  try {
    const res = await fetch(`${API}/${year}/${iso2}`, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    const holidays: Holiday[] = (Array.isArray(rows) ? rows : []).map((r) => ({
      date: String(r.date ?? ""), name: String(r.name ?? ""),
      localName: String(r.localName ?? ""), global: r.global !== false,
    })).filter((h) => h.date);
    cache.set(key, { holidays, expires: Date.now() + TTL });
    return holidays;
  } catch {
    return hit?.holidays ?? []; // serve stale on failure; else empty (never throws)
  }
}

// Upcoming public holidays for a country. Fetches the current and next year (so
// the window spans a year boundary) and filters. [] when the country is unmapped
// or Nager.Date is unreachable (the dossier just omits the section).
export async function getCountryHolidays(country: string, nowMs: number = Date.now(), lookaheadDays = 30): Promise<UpcomingHoliday[]> {
  const iso2 = countryIso2(country);
  if (!iso2) return [];
  const yr = new Date(nowMs).getUTCFullYear();
  const [a, b] = await Promise.all([fetchYear(iso2, yr), fetchYear(iso2, yr + 1)]);
  return upcomingHolidays([...a, ...b], nowMs, lookaheadDays);
}
