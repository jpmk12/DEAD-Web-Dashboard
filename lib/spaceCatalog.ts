// Space activity — launch cadence and conjunctions. PURE, client-safe,
// unit-tested. lib/spaceSources.ts fetches; this judges.
//
// Only the SPACE POWERS carry the indicator (China, Russia, Iran, North
// Korea): a launch by anyone else is not warning for a mobility force, and
// the actor's own 90-day cadence is the baseline — cadence, not count, is
// the anomaly. Conjunctions count only when a U.S. military payload is one
// of the pair and the miss distance is small; Starlink-class traffic is
// deliberately not a signal.

export const SPACE_POWERS: Record<string, string> = {
  "china": "CHN", "russia": "RUS", "iran": "IRN", "north korea": "PRK",
};

/** ISO3 codes for the space powers among a country list ([] when none). */
export function spacePowersIn(countries: string[]): string[] {
  const out = new Set<string>();
  for (const c of countries) { const k = SPACE_POWERS[c.trim().toLowerCase()]; if (k) out.add(k); }
  return [...out];
}

export interface Launch {
  name: string;
  net: string;              // ISO
  provider: string;
  /** ISO3 of the launch provider or pad country, "" when unknown. */
  country: string;
  padName: string;
  lat: number | null;
  lon: number | null;
  status: string;           // Go / TBD / Success / Failure … (LL2 abbrev)
}

const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Launch Library 2 `results[]` → launches. Provider country_code is the
 *  actor; the pad's country is the fallback (a Soyuz from Kourou is ESA's
 *  launch, a Long March from Jiuquan is China's either way). */
export function parseLaunches(json: unknown): Launch[] {
  const arr = (json as { results?: unknown[] })?.results;
  if (!Array.isArray(arr)) return [];
  const out: Launch[] = [];
  for (const l of arr) {
    if (!l || typeof l !== "object") continue;
    const r = l as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : "";
    const net = typeof r.net === "string" ? r.net : "";
    if (!name || !net) continue;
    const lsp = (r.launch_service_provider && typeof r.launch_service_provider === "object" ? r.launch_service_provider : {}) as Record<string, unknown>;
    const pad = (r.pad && typeof r.pad === "object" ? r.pad : {}) as Record<string, unknown>;
    const loc = (pad.location && typeof pad.location === "object" ? pad.location : {}) as Record<string, unknown>;
    const status = (r.status && typeof r.status === "object" ? r.status : {}) as Record<string, unknown>;
    const cc = (v: unknown): string => {
      if (typeof v === "string") return v.trim().toUpperCase().slice(0, 3);
      if (Array.isArray(v) && typeof v[0] === "string") return String(v[0]).trim().toUpperCase().slice(0, 3);
      return "";
    };
    out.push({
      name, net,
      provider: typeof lsp.name === "string" ? lsp.name : "",
      country: cc(lsp.country_code) || cc(loc.country_code),
      padName: typeof pad.name === "string" ? pad.name : typeof loc.name === "string" ? loc.name : "",
      lat: num(pad.latitude), lon: num(pad.longitude),
      status: typeof status.abbrev === "string" ? status.abbrev : typeof status.name === "string" ? status.name : "",
    });
  }
  return out;
}

export interface Cadence {
  /** Launches by the actor in the last 14 days (net ≤ now). */
  last14: number;
  /** Mean launches per 14 days over the trailing 90 (null when the history
   *  covers fewer than 28 days — learning). */
  per14: number | null;
  /** Days of history the sample covers. */
  historyDays: number;
  /** Upcoming launches by the actor in the next 14 days. */
  next14: number;
}

/** The actor's own cadence from a launch list (past + upcoming mixed is
 *  fine — `net` decides). `historyDays` is what the caller fetched. */
export function launchCadence(launches: Launch[], iso3s: string[], todayMs: number, historyDays = 90): Cadence {
  const want = new Set(iso3s.map((s) => s.toUpperCase()));
  const mine = launches.filter((l) => want.has(l.country));
  const day = 86_400_000;
  const past = mine.filter((l) => { const t = Date.parse(l.net); return Number.isFinite(t) && t <= todayMs && t >= todayMs - historyDays * day; });
  const last14 = past.filter((l) => Date.parse(l.net) >= todayMs - 14 * day).length;
  const next14 = mine.filter((l) => { const t = Date.parse(l.net); return Number.isFinite(t) && t > todayMs && t <= todayMs + 14 * day; }).length;
  const per14 = historyDays >= 28 ? (past.length / historyDays) * 14 : null;
  return { last14, per14, historyDays, next14 };
}

export interface Conjunction {
  primary: string;
  secondary: string;
  tcaISO: string;
  minRangeKm: number | null;
  maxProb: number | null;
}

const US_MIL_PAYLOAD = /\b(USA \d+|WGS(?: |-)?\d*|MUOS|AEHF|SBIRS|NAVSTAR|GPS (?:II|III)|NROL|MILSTAR|DSCS|GSSAP|X-37B|OTV-\d|DMSP|WSF-M|TDRS)\b/i;

const splitLine = (line: string): string[] => line.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));

/** CelesTrak SOCRATES CSV → conjunctions. Header-keyed (the export has
 *  changed column order before). Empty when the header is unrecognised. */
export function parseSocrates(csv: string): Conjunction[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const h = splitLine(lines[0]).map((x) => x.toUpperCase());
  const col = (...names: string[]) => { for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; } return -1; };
  const c1 = col("OBJECT_NAME_1", "PRIMARY_NAME", "OBJECT_NAME"), c2 = col("OBJECT_NAME_2", "SECONDARY_NAME");
  const cT = col("TCA", "TCA_TIME"), cR = col("MIN_RNG", "MIN_RANGE", "MIN_RNG_KM"), cP = col("MAX_PROB", "PC", "PROBABILITY");
  if (c1 < 0 || c2 < 0) return [];
  const out: Conjunction[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = splitLine(lines[i]);
    const primary = f[c1] ?? "", secondary = f[c2] ?? "";
    if (!primary || !secondary) continue;
    out.push({
      primary, secondary,
      tcaISO: cT >= 0 ? (f[cT] ?? "") : "",
      minRangeKm: cR >= 0 ? num(f[cR]) : null,
      maxProb: cP >= 0 ? num(f[cP]) : null,
    });
  }
  return out;
}

/** Conjunctions involving a U.S. military payload inside `maxRangeKm`. */
export function usPayloadConjunctions(all: Conjunction[], maxRangeKm = 1): Conjunction[] {
  return all.filter((c) => (US_MIL_PAYLOAD.test(c.primary) || US_MIL_PAYLOAD.test(c.secondary)) && (c.minRangeKm == null || c.minRangeKm <= maxRangeKm));
}
