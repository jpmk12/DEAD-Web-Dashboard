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
  const day = 86_400_000;
  // The sample is a page of ALL launches (Launch Library returns the newest
  // 100), so the history it actually covers can be shorter than asked — a
  // busy quarter fits fewer days into the page. The cadence divides by the
  // span COVERED, never by the nominal window, or a short page reads as a
  // quiet actor and today's count as a surge.
  const pastAll = launches.map((l) => Date.parse(l.net)).filter((t) => Number.isFinite(t) && t <= todayMs);
  const oldest = pastAll.length ? Math.min(...pastAll) : todayMs;
  const covered = Math.min(historyDays, Math.max(0, (todayMs - oldest) / day));
  const mine = launches.filter((l) => want.has(l.country));
  const past = mine.filter((l) => { const t = Date.parse(l.net); return Number.isFinite(t) && t <= todayMs && t >= todayMs - covered * day; });
  const last14 = past.filter((l) => Date.parse(l.net) >= todayMs - 14 * day).length;
  const next14 = mine.filter((l) => { const t = Date.parse(l.net); return Number.isFinite(t) && t > todayMs && t <= todayMs + 14 * day; }).length;
  const per14 = covered >= 28 ? (past.length / covered) * 14 : null;
  return { last14, per14, historyDays: Math.round(covered), next14 };
}

export interface Conjunction {
  primary: string;
  secondary: string;
  tcaISO: string;
  minRangeKm: number | null;
  maxProb: number | null;
  /** SOCRATES' own marker: true "[+]" payload, false "[-]" debris / rocket
   *  body, absent when the row carried no marker. */
  payload1?: boolean;
  payload2?: boolean;
}

const US_MIL_PAYLOAD = /\b(USA \d+|WGS(?: |-)?\d*|MUOS|AEHF|SBIRS|NAVSTAR|GPS (?:II|III)|NROL|MILSTAR|DSCS|GSSAP|X-37B|OTV-\d|DMSP|WSF-M|TDRS)\b/i;

const splitLine = (line: string): string[] => line.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
// SOCRATES marks objects "[+]" (payload) / "[-]" (debris/rocket body) after
// the name; the marker is not part of the name.
const cleanName = (s: string): string => s.replace(/\s*\[[+-]\]\s*$/, "").trim();
const markerOf = (s: string): boolean | undefined => (/\[\+\]\s*$/.test(s) ? true : /\[-\]\s*$/.test(s) ? false : undefined);

/** The streaming reader stops once rows pass this range — the file is sorted
 *  by minimum range, so everything that can ever count as "close" comes first.
 *  It is the range the indicator USES (`usPayloadConjunctions`' default).
 *  It was 5 km until 2026-10-29, and SOCRATES lists ONLY approaches within
 *  5 km — so the early stop never fired, the read ran to the byte cap, and
 *  the 5,000-row kept cap could drop sub-kilometre rows past it. */
export const SOCRATES_CLOSE_KM = 1;

/** Payload names per space power (ISO3), for the counterparty of a
 *  conjunction. Names, not catalogue owners — SOCRATES carries no owner
 *  column. Debris and rocket bodies never count (marker or name). */
export const SPACE_POWER_PAYLOAD: Record<string, RegExp> = {
  RUS: /\b(?:COSMOS|KOSMOS|LUCH|OLYMP|GLONASS|MOLNIYA|MERIDIAN|RESURS|KONDOR|BARS-M|LOTOS|PION|TUNDRA|BLAGOVEST|NIVELIR)\b/i,
  CHN: /\b(?:SHIJIAN|SJ-\d+|YAOGAN|TJS|TONGXIN JISHU|TIANLIAN|SHIYAN|CHUANGXIN|BEIDOU|GAOFEN|PRC TEST SPACECRAFT|CHINASAT|ZHONGXING|FENGYUN|JILIN|TIANHUI|XINYAN|TIANQI)\b/i,
  IRN: /\b(?:NOOR|KHAYYAM|NAHID|ZAFAR|SORAYA|CHAMRAN|KOWSAR|HODHOD|PARS-\d)\b/i,
  PRK: /\b(?:KWANGMYONGSONG|MALLIGYONG|CHOLLIMA)\b/i,
};
const DEBRIS_NAME = /\b(?:DEB|R\/B|AKM|PKM|COOLANT)\b/i;

export interface SocratesColumns { name1: number; name2: number; tca: number; range: number; prob: number }

/** Header-keyed column lookup (the export has changed column order and names
 *  before — the 2026-10-24 live header is `NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,
 *  NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,
 *  MAX_PROB,DILUTION`). null when the two object names cannot be found;
 *  `range` is -1 when no range column exists — a caller must then treat the
 *  rows as UNUSABLE for closeness, never as close. */
export function socratesColumns(headerLine: string): SocratesColumns | null {
  const h = splitLine(headerLine).map((x) => x.toUpperCase());
  const col = (...names: string[]) => { for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; } return -1; };
  const name1 = col("OBJECT_NAME_1", "PRIMARY_NAME", "OBJECT_NAME"), name2 = col("OBJECT_NAME_2", "SECONDARY_NAME");
  if (name1 < 0 || name2 < 0) return null;
  return {
    name1, name2,
    tca: col("TCA", "TCA_TIME"),
    range: col("TCA_RANGE", "MIN_RNG", "MIN_RANGE", "MIN_RNG_KM", "RANGE_KM"),
    prob: col("MAX_PROB", "PC", "PROBABILITY"),
  };
}

/** One data row → a conjunction, or null for a row with no two names. */
export function parseSocratesRow(cols: SocratesColumns, line: string): Conjunction | null {
  const f = splitLine(line);
  const raw1 = f[cols.name1] ?? "", raw2 = f[cols.name2] ?? "";
  const primary = cleanName(raw1), secondary = cleanName(raw2);
  if (!primary || !secondary) return null;
  const p1 = markerOf(raw1), p2 = markerOf(raw2);
  return {
    primary, secondary,
    tcaISO: cols.tca >= 0 ? (f[cols.tca] ?? "") : "",
    minRangeKm: cols.range >= 0 ? num(f[cols.range]) : null,
    maxProb: cols.prob >= 0 ? num(f[cols.prob]) : null,
    ...(p1 !== undefined ? { payload1: p1 } : {}),
    ...(p2 !== undefined ? { payload2: p2 } : {}),
  };
}

/** CelesTrak SOCRATES CSV → conjunctions (whole-text form, for tests and
 *  small captures; the server streams the 20+ MB live file through
 *  `socratesColumns` / `parseSocratesRow` with an early stop). Empty when the
 *  header is unrecognised. */
export function parseSocrates(csv: string): Conjunction[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const cols = socratesColumns(lines[0]);
  if (!cols) return [];
  const out: Conjunction[] = [];
  for (let i = 1; i < lines.length; i++) { const c = parseSocratesRow(cols, lines[i]); if (c) out.push(c); }
  return out;
}

/** Conjunctions between a U.S. military payload and a SATELLITE of one of
 *  `actors` (ISO3 space powers) inside `maxRangeKm`. Both halves are
 *  required: a GPS satellite passing a Starlink or a piece of debris is
 *  traffic, not activity, and before 2026-10-29 any U.S. payload inside 1 km
 *  of anything lit space activity ACTIVE on every space-power board (it never
 *  fired only because SOCRATES had been unreachable). The counterparty must
 *  be a payload — SOCRATES' "[+]", or no marker and not a debris name — so a
 *  Cosmos ASAT-test fragment is environment, never an actor.
 *
 *  A row with NO range is not close — it is unknown, and an unknown range
 *  must not light the ladder (the 2026-10-24 diag: the live header's range
 *  column was unrecognised and every row parsed null). */
export function usPayloadConjunctions(all: Conjunction[], actors: string[], maxRangeKm = SOCRATES_CLOSE_KM): Conjunction[] {
  const rx = actors.map((a) => SPACE_POWER_PAYLOAD[a]).filter((r): r is RegExp => !!r);
  if (!rx.length) return [];
  const isActorSat = (name: string, payload: boolean | undefined) =>
    payload !== false && !(payload === undefined && DEBRIS_NAME.test(name)) && rx.some((r) => r.test(name));
  return all.filter((c) => {
    if (c.minRangeKm == null || c.minRangeKm > maxRangeKm) return false;
    const usFirst = US_MIL_PAYLOAD.test(c.primary) && isActorSat(c.secondary, c.payload2);
    const usSecond = US_MIL_PAYLOAD.test(c.secondary) && isActorSat(c.primary, c.payload1);
    return usFirst || usSecond;
  });
}
