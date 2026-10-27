// Cloudflare Radar — PURE parsers and the outage-level rule, client-safe,
// tested in tests/radarSignals.test.ts. lib/cloudflareRadar.ts fetches (a
// Bearer token from CLOUDFLARE_RADAR_TOKEN; the token never leaves the
// server and never appears in a prompt, a log line or a reply).
//
// Two endpoints, both published JSON:
//   GET /radar/annotations/outages   — Cloudflare's curated internet
//       outage annotations: scope (NATIONWIDE / REGIONAL / NETWORK /
//       PLATFORM), cause (GOVERNMENT_DIRECTED, MILITARY_ACTION,
//       CYBERATTACK, CABLE_CUT, POWER_OUTAGE, …), the countries, start and
//       (null while ongoing) end, and a linked write-up.
//   GET /radar/traffic_anomalies     — detected traffic drops per location
//       or AS, VERIFIED or UNVERIFIED.
//
// The level rule (`radarOutageLevel`): an ONGOING NATIONWIDE outage whose
// cause is a hostile or governmental act (military action / government
// directed / cyberattack) is RED — that is the connectivity picture of a
// country under attack or a shutdown; any other ongoing annotation, or a
// VERIFIED traffic anomaly, is AMBER; one that ENDED inside the window is a
// NOTE (still shown, never colours a cell); nothing is green by itself —
// the caller says green only when the feed ANSWERED. IODA (Georgia Tech)
// remains the first outage source; Radar is the second, independent one,
// so the USCYBERCOM Outages cell can say "two sources" instead of one.
//
// Data © Cloudflare, CC BY-NC 4.0 — attribution is rendered wherever shown.

export type RadarScope = "NATIONWIDE" | "REGIONAL" | "NETWORK" | "PLATFORM" | "UNKNOWN";

export interface RadarOutage {
  id: string;
  /** Cloudflare's own description line. */
  description: string;
  scope: RadarScope;
  /** Cloudflare's cause code, upper-cased (`MILITARY_ACTION` …), or "". */
  cause: string;
  /** ISO alpha-2 codes + names the annotation names. */
  countries: { code: string; name: string }[];
  /** Subnational places the annotation names (`entities[].entityName` of
   *  GEOLOCATION entities — "Sevastopol City", "Crimea"), the country
   *  suffix stripped; empty for a nationwide or network row. */
  places: string[];
  /** How the countries were found: `named` by the annotation's own location
   *  fields, or `asn` — PLACED at the registration country of the networks
   *  it names, because the annotation named no location (the Armstrong
   *  AS27364 row). A placement is said on every surface; null = unplaced. */
  countriesVia: "named" | "asn" | null;
  /** ASNs named (for a NETWORK-scope annotation). */
  asns: number[];
  startMs: number;
  /** null while the outage is ongoing. */
  endMs: number | null;
  url: string | null;
}

export interface RadarAnomaly {
  id: string;
  type: "LOCATION" | "AS";
  status: "VERIFIED" | "UNVERIFIED";
  country: { code: string; name: string } | null;
  /** `location` = the anomaly's own `locationDetails`; `asn` = the network's
   *  registration country from `asnDetails.location` (an AS anomaly carries
   *  `locationDetails: null` — the 2026-10-27 diag). An ASN placement lists
   *  the anomaly on the country's read but never colours it. */
  countryVia: "location" | "asn" | null;
  asn: number | null;
  startMs: number;
  endMs: number | null;
}

const HOSTILE_CAUSES = new Set(["MILITARY_ACTION", "GOVERNMENT_DIRECTED", "CYBERATTACK"]);

const ms = (s: unknown): number | null => {
  if (typeof s !== "string" || !s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};
const str = (s: unknown): string => (typeof s === "string" ? s.trim() : "");
const httpsOnly = (s: unknown): string | null => (typeof s === "string" && /^https:\/\//i.test(s) ? s.trim().slice(0, 300) : null);

/** The field names under which the Radar API has been seen (or can be
 *  expected) to carry a place: the first live outage rows (2026-10-27) had
 *  `locations: []` and `locationsDetails: []` for Ukrainian and Russian
 *  strike annotations while also carrying `entities`, `origins`,
 *  `originsDetails` and `geoIds` — fields the SDK's older schema never
 *  listed. ASN fields are deliberately NOT here: a network's registration
 *  country is a PLACEMENT, read separately and said so. */
const LOCATION_KEYS = /^(locations?|locationsDetails|locationDetails|origins?|originsDetails|entities|geoIds?|regions?)$/;

/** ISO 3166-2 subdivision id (`UA-30`, `US-PA`) → its country. */
const GEO_ID_RX = /^([A-Za-z]{2})-[A-Za-z0-9]{1,3}$/;

/** The live `entities[]` row (2026-10-27): `{ entityType: "GEOLOCATION",
 *  entityValue: "694422" (a GeoNames id), entityName: "Sevastopol City,
 *  Ukraine", entityLocation: "UA" }`. Only a GEOLOCATION-class entity
 *  NAMES a place; an ASN-class entity's `entityLocation` is a placement. */
const GEO_ENTITY_RX = /GEO|LOCATION|COUNTRY|REGION|CITY/i;

/** "Sevastopol City, Ukraine" → the country name after the last comma; a
 *  name with no comma ("Ukraine") IS the country. */
const countryOfEntityName = (name: unknown): string | undefined => {
  const n = str(name);
  const i = n.lastIndexOf(",");
  return (i > 0 ? n.slice(i + 1) : n).trim() || undefined;
};

/** Countries named anywhere under the given sources, walking only the
 *  location-shaped keys (never names, descriptions or ASN lists): a string
 *  code, a `{ code | alpha2 | iso2, name }` object, a GEOLOCATION entity's
 *  `entityLocation`, arrays of either, and nested containers such as
 *  `entities.locations`. An ISO 3166-2 geo id yields its country; a
 *  GeoNames number yields nothing. Nothing is guessed from prose. Also
 *  returns the subnational `places` the GEOLOCATION entities name. */
function countriesOf(...sources: unknown[]): { countries: { code: string; name: string }[]; places: string[] } {
  const out = new Map<string, string>();
  const placeNames: { name: string; country: string | undefined }[] = [];
  const take = (code: unknown, name?: unknown) => {
    const c = str(code).toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) return;
    const n = str(name);
    if (!out.has(c) || (n && out.get(c) === c)) out.set(c, n || out.get(c) || c);
  };
  const walk = (v: unknown, depth: number): void => {
    if (v == null || depth > 4) return;
    if (typeof v === "string") {
      if (/^[A-Za-z]{2}$/.test(v)) take(v);
      else { const m = GEO_ID_RX.exec(v.trim()); if (m) take(m[1]); }
      return;
    }
    if (Array.isArray(v)) { for (const d of v) walk(d, depth + 1); return; }
    if (typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const code = o.code ?? o.alpha2 ?? o.iso2;
    if (typeof code === "string") take(code, o.name ?? o.locationName);
    if (typeof o.entityLocation === "string" && (o.entityType == null || GEO_ENTITY_RX.test(str(o.entityType)))) {
      const country = countryOfEntityName(o.entityName);
      take(o.entityLocation, country);
      const full = str(o.entityName).slice(0, 80);
      if (full) placeNames.push({ name: full, country });
    }
    for (const [k, x] of Object.entries(o)) if (LOCATION_KEYS.test(k)) walk(x, depth + 1);
  };
  for (const s of sources) walk(s, 0);
  const countries = [...out.entries()].map(([code, name]) => ({ code, name }));
  const countryNames = new Set(countries.map((c) => c.name.toLowerCase()));
  const places = [...new Set(placeNames.map((p) => {
    // Strip the ", <country>" suffix when it names a country we took; an
    // entity that IS the country ("Ukraine") is not a subnational place.
    const suffix = p.country ? `, ${p.country}` : "";
    return suffix && p.name.toLowerCase().endsWith(suffix.toLowerCase()) ? p.name.slice(0, -suffix.length).trim() : p.name;
  }).filter((n) => n && !countryNames.has(n.toLowerCase())))].slice(0, 5);
  return { countries, places };
}

/** The registration countries of the networks an annotation / anomaly names
 *  (`asnsDetails[].location{s}` / `asnDetails.location`). A placement, not a
 *  statement of where the outage is — the caller marks it `via: "asn"`. */
function asnCountriesOf(...sources: unknown[]): { code: string; name: string }[] {
  const places: unknown[] = [];
  const push = (d: unknown) => {
    if (!d || typeof d !== "object") return;
    const o = d as Record<string, unknown>;
    places.push(o.location, o.locations, o.locationDetails, o.locationsDetails);
    // An ASN-class entity row (`entities[]` with entityType "ASN") carries
    // the network's registration country as `entityLocation`.
    if (/ASN|NETWORK/i.test(str(o.entityType)) && typeof o.entityLocation === "string") places.push(o.entityLocation);
  };
  for (const s of sources) { if (Array.isArray(s)) s.forEach(push); else push(s); }
  return countriesOf(...places).countries;
}

/** `result.annotations[]` → outages. A row with no start date or no id is
 *  dropped — never guessed. */
export function parseRadarOutages(json: unknown): RadarOutage[] {
  const rows = (json as { result?: { annotations?: unknown[] } })?.result?.annotations;
  if (!Array.isArray(rows)) return [];
  const out: RadarOutage[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const id = str(r.id);
    const startMs = ms(r.startDate);
    if (!id || startMs == null) continue;
    const outage = (r.outage ?? {}) as { outageCause?: unknown; outageType?: unknown };
    const scopeRaw = str(outage.outageType).toUpperCase();
    const scope: RadarScope = scopeRaw === "NATIONWIDE" || scopeRaw === "REGIONAL" || scopeRaw === "NETWORK" || scopeRaw === "PLATFORM" ? scopeRaw : "UNKNOWN";
    const named = countriesOf(r.locationsDetails, r.locations, r.locationDetails, r.location, r.originsDetails, r.origins, r.entities, r.geoIds);
    const placed = named.countries.length ? [] : asnCountriesOf(r.asnsDetails, r.entities);
    out.push({
      id,
      description: str(r.description).slice(0, 400),
      scope,
      cause: str(outage.outageCause).toUpperCase().slice(0, 40),
      countries: named.countries.length ? named.countries : placed,
      places: named.places,
      countriesVia: named.countries.length ? "named" : placed.length ? "asn" : null,
      asns: Array.isArray(r.asns) ? (r.asns as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0) : [],
      startMs,
      endMs: ms(r.endDate),
      url: httpsOnly(r.linkedUrl),
    });
  }
  return out.sort((a, b) => b.startMs - a.startMs);
}

/** `result.trafficAnomalies[]` → anomalies. */
export function parseRadarAnomalies(json: unknown): RadarAnomaly[] {
  const rows = (json as { result?: { trafficAnomalies?: unknown[] } })?.result?.trafficAnomalies;
  if (!Array.isArray(rows)) return [];
  const out: RadarAnomaly[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const id = str(r.uuid) || str(r.id);
    const startMs = ms(r.startDate);
    const typeRaw = str(r.type).toUpperCase();
    if (!id || startMs == null || (typeRaw !== "LOCATION" && typeRaw !== "AS")) continue;
    const ld = r.locationDetails as { code?: unknown; name?: unknown } | undefined;
    const code = str(ld?.code).toUpperCase();
    const ad = r.asnDetails as { asn?: unknown } | undefined;
    const asn = Number(ad?.asn);
    const own = /^[A-Z]{2}$/.test(code) ? { code, name: str(ld?.name) || code } : null;
    const viaAsn = own ? null : asnCountriesOf(ad)[0] ?? null;
    out.push({
      id, type: typeRaw,
      status: str(r.status).toUpperCase() === "VERIFIED" ? "VERIFIED" : "UNVERIFIED",
      country: own ?? viaAsn,
      countryVia: own ? "location" : viaAsn ? "asn" : null,
      asn: Number.isInteger(asn) && asn > 0 ? asn : null,
      startMs, endMs: ms(r.endDate),
    });
  }
  return out.sort((a, b) => b.startMs - a.startMs);
}

export type RadarLevel = "red" | "amber" | "note";

export interface RadarCountryRead {
  /** ISO2. */
  code: string;
  /** The display name the feed gave (or the caller's). */
  name: string;
  level: RadarLevel;
  /** Why, in one line — scope · cause · since / ended. */
  why: string;
  ongoing: boolean;
  outages: RadarOutage[];
  anomalies: RadarAnomaly[];
  url: string | null;
}

const fmtDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const niceCause = (c: string) => (c ? c.toLowerCase().replace(/_/g, " ") : "cause not stated");

/** The level of one outage annotation at `nowMs`. */
export function radarOutageLevel(o: RadarOutage, nowMs: number): RadarLevel {
  const ongoing = o.endMs == null || o.endMs > nowMs;
  if (!ongoing) return "note";
  if (o.scope === "NATIONWIDE" && HOSTILE_CAUSES.has(o.cause)) return "red";
  return "amber";
}

const RANK: Record<RadarLevel, number> = { note: 0, amber: 1, red: 2 };

/**
 * Per-country read for the countries asked for (ISO2 codes, upper-cased),
 * over the outages and VERIFIED anomalies that name them. Unverified
 * anomalies are listed but never colour. A country with nothing is absent
 * from the result — the CALLER decides whether absent means green (the feed
 * answered) or UNKNOWN (it did not).
 */
export function radarReadsFor(outages: RadarOutage[], anomalies: RadarAnomaly[], codes: string[], nowMs: number, windowDays = 7): RadarCountryRead[] {
  const want = new Set(codes.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)));
  const since = nowMs - windowDays * 86_400_000;
  const by = new Map<string, RadarCountryRead>();
  const get = (code: string, name: string) => {
    let r = by.get(code);
    if (!r) { r = { code, name, level: "note", why: "", ongoing: false, outages: [], anomalies: [], url: null }; by.set(code, r); }
    return r;
  };
  for (const o of outages) {
    if (o.startMs < since && o.endMs != null && o.endMs < since) continue;
    for (const c of o.countries) {
      if (!want.has(c.code)) continue;
      const r = get(c.code, c.name);
      r.outages.push(o);
      const lvl = radarOutageLevel(o, nowMs);
      if (RANK[lvl] > RANK[r.level] || !r.why) {
        r.level = lvl;
        const ongoing = lvl !== "note";
        r.why = `${o.scope === "UNKNOWN" ? "outage" : o.scope.toLowerCase() + " outage"} · ${niceCause(o.cause)}${o.places.length ? ` · ${o.places.slice(0, 3).join(", ")}` : ""} · ${ongoing ? `since ${fmtDay(o.startMs)}` : `ended ${fmtDay(o.endMs!)}`}${o.countriesVia === "asn" ? " · placed by the network's registration — the annotation names no country" : ""}`;
        r.ongoing = r.ongoing || ongoing;
        r.url = o.url ?? r.url;
      }
    }
  }
  for (const a of anomalies) {
    if (!a.country || !want.has(a.country.code)) continue;
    if (a.startMs < since && a.endMs != null && a.endMs < since) continue;
    const r = get(a.country.code, a.country.name);
    r.anomalies.push(a);
    const ongoing = a.endMs == null || a.endMs > nowMs;
    // Only a LOCATION anomaly (the country's own traffic) colours; an AS
    // anomaly placed at the network's registration country is one ISP among
    // many and is listed, never a level.
    if (a.type === "LOCATION" && a.countryVia === "location" && a.status === "VERIFIED" && ongoing && RANK.amber > RANK[r.level]) {
      r.level = "amber";
      r.why = `verified traffic anomaly · since ${fmtDay(a.startMs)}`;
      r.ongoing = true;
    } else if (!r.why) {
      const subject = a.type === "AS" ? `network anomaly${a.asn != null ? ` (AS${a.asn})` : ""}` : "traffic anomaly";
      r.why = `${a.status.toLowerCase()} ${subject} · ${ongoing ? `since ${fmtDay(a.startMs)}` : `ended ${fmtDay(a.endMs!)}`}${a.countryVia === "asn" ? " · placed by the network's registration" : ""}`;
    }
  }
  return [...by.values()].sort((a, b) => RANK[b.level] - RANK[a.level] || a.name.localeCompare(b.name));
}

/** Ordinal for the daily series (`cfout:<iso2>`, day-peak): 3 red · 2 amber · 1 note · 0 nothing. */
export const RADAR_LEVEL_ORDINAL: Record<RadarLevel, number> = { red: 3, amber: 2, note: 1 };

// ---------------------------------------------------------------------------
// Error bodies. The Cloudflare API answers every refusal as
// `{ success:false, errors:[{ code, message, error_chain?:[{code,message}] }] }`
// — and the HTTP status alone misleads: a MALFORMED Authorization header
// (a Global API Key pasted where a token belongs, a stray character) is
// HTTP 400 code 6003 "Invalid request headers" › 6111 "Invalid format for
// Authorization header", not a 401. The first production diag (2026-10-26)
// showed exactly "HTTP 400" on both endpoints with nothing else, which could
// have been the token OR an over-limit query. So the body is read, the codes
// and messages are kept (they never carry the token), and the class is named.

export type RadarErrorClass = "token" | "query" | "rate" | "other";

/**
 * The env value as the operator pasted it → the bare token. Strips the
 * paste defects that make a GOOD token read as "Authentication failed":
 * surrounding quotes, a `Bearer ` prefix, and whitespace. Returns null for
 * nothing left.
 */
export function normalizeRadarToken(raw: string | undefined | null): string | null {
  // Invisible paste defects first: zero-width characters, a byte-order mark,
  // and non-breaking spaces (as whitespace). A VISIBLE look-alike letter from
  // another alphabet is NOT repaired — a secret is never guessed; it is
  // reported by describeTokenShape instead.
  let t = (raw ?? "").replace(/[​-‍⁠﻿]/g, "").replace(/ /g, " ").trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) t = t.slice(1, -1).trim();
  t = t.replace(/^bearer\s+/i, "").trim();
  return t ? t : null;
}

/** The script a non-ASCII code point belongs to, for naming a homoglyph
 *  without printing it. */
export function scriptOf(cp: number): string {
  if (cp >= 0x0400 && cp <= 0x04ff) return "Cyrillic";
  if (cp >= 0x0370 && cp <= 0x03ff) return "Greek";
  if (cp >= 0x00c0 && cp <= 0x024f) return "Latin with a diacritic";
  if (cp >= 0xff01 && cp <= 0xff5e) return "full-width Latin";
  if (cp >= 0x2010 && cp <= 0x2015) return "typographic dash";
  if (cp >= 0x2018 && cp <= 0x201f) return "typographic quote";
  return "non-ASCII";
}

export interface NonAsciiNote {
  /** 1-based position inside the bare token. */
  position: number;
  codePoint: number;
  script: string;
}

/** The first character outside printable ASCII, named by position and
 *  script — the character itself is never returned. Node's fetch refuses a
 *  header with such a character ("Cannot convert argument to a ByteString…
 *  greater than 255"), so a transcribed token fails BEFORE reaching
 *  Cloudflare; the 2026-10-27 value carried a Cyrillic Х at position 21. */
export function firstNonAscii(bare: string): NonAsciiNote | null {
  let i = 0;
  for (const ch of bare) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 || cp > 0x7e) return { position: i + 1, codePoint: cp, script: scriptOf(cp) };
    i += 1;
  }
  return null;
}

/** True for the error Node's fetch throws on a non-Latin-1 header value. */
export function isByteStringError(message: string): boolean {
  return /ByteString|greater than 255/i.test(message);
}

export interface RadarTokenShape {
  /** Characters in the bare value. */
  length: number;
  /** A Cloudflare API Token is 40–64 chars of [A-Za-z0-9_-] (40 was the
   *  classic length; the token that verified `active` on 2026-10-27 is 53);
   *  the Global API Key is 37 hex chars; an Origin CA key starts `v1.0-` —
   *  all told apart by shape alone. */
  looksLike: "api-token" | "global-api-key" | "origin-ca-key" | "unknown";
  /** The alphabet the value uses — `token-alphabet` ([A-Za-z0-9_-]), `hex`,
   *  or `other` (a character Cloudflare's Bearer parser refuses outright:
   *  that is the 6003 › 6111 "Invalid format for Authorization header"). */
  charset: "token-alphabet" | "hex" | "other";
  /** The first character outside printable ASCII, by position and script
   *  (a look-alike letter from another alphabet — the value was retyped,
   *  not copied). Null when the value is plain ASCII. */
  nonAscii: NonAsciiNote | null;
  /** Defects stripped from the pasted value. */
  stripped: ("quotes" | "bearer-prefix" | "whitespace" | "invisible")[];
}

/** Describe the token's SHAPE for the diag — never its characters. */
export function describeTokenShape(raw: string | undefined | null): RadarTokenShape | null {
  const bare = normalizeRadarToken(raw);
  if (!bare) return null;
  const r = raw ?? "";
  const stripped: RadarTokenShape["stripped"] = [];
  if (/^\s*["']/.test(r)) stripped.push("quotes");
  if (/^\s*["']?\s*bearer\s/i.test(r)) stripped.push("bearer-prefix");
  if (r !== r.trim()) stripped.push("whitespace");
  if (/[​-‍⁠﻿ ]/.test(r)) stripped.push("invisible");
  const charset: RadarTokenShape["charset"] = /^[0-9a-f]+$/i.test(bare) ? "hex" : /^[A-Za-z0-9_-]+$/.test(bare) ? "token-alphabet" : "other";
  const looksLike: RadarTokenShape["looksLike"] =
    /^v1\.0-/.test(bare) ? "origin-ca-key"
    : /^[0-9a-f]{37}$/.test(bare) ? "global-api-key"
    : /^[A-Za-z0-9_-]{40,64}$/.test(bare) ? "api-token"
    : "unknown";
  return { length: bare.length, looksLike, charset, nonAscii: firstNonAscii(bare), stripped };
}

export interface RadarErrorInfo {
  cls: RadarErrorClass;
  /** `HTTP 400 — 6003 Invalid request headers › 6111 Invalid format for Authorization header`. */
  detail: string;
  /** One sentence the operator can act on. */
  hint: string;
}

/** Cloudflare error codes that mean the credential itself. 6003/6111 =
 *  malformed Authorization header (a Global API Key or a stray character);
 *  10000 = authentication error; 9109 / 9106 = token invalid or expired;
 *  9103 / 10001 = the token lacks the permission. */
const TOKEN_CODES = new Set([6003, 6111, 6103, 9103, 9106, 9109, 10000, 10001]);

/**
 * Describe a non-OK reply (PURE): the status plus the error chain from the
 * body when it parses, classed as `token` (fix the credential), `query` (a
 * parameter the API refused — the message names it), `rate` (429) or
 * `other`. The body text is external content: only codes and messages are
 * kept, capped, and never the token (Cloudflare never echoes it anyway).
 */
export function describeRadarError(status: number, bodyText: string | null | undefined): RadarErrorInfo {
  const parts: string[] = [];
  const codes: number[] = [];
  try {
    const j = bodyText ? JSON.parse(bodyText) as { errors?: unknown } : null;
    const errs = Array.isArray(j?.errors) ? (j!.errors as Record<string, unknown>[]) : [];
    for (const e of errs.slice(0, 3)) {
      if (!e || typeof e !== "object") continue;
      const code = Number(e.code);
      if (Number.isInteger(code)) codes.push(code);
      const line = [Number.isInteger(code) ? String(code) : "", str(e.message).slice(0, 160)].filter(Boolean).join(" ");
      const chain = Array.isArray(e.error_chain) ? (e.error_chain as Record<string, unknown>[]).slice(0, 2).map((c) => {
        const cc = Number(c?.code); if (Number.isInteger(cc)) codes.push(cc);
        return [Number.isInteger(cc) ? String(cc) : "", str(c?.message).slice(0, 160)].filter(Boolean).join(" ");
      }).filter(Boolean) : [];
      parts.push([line, ...chain].filter(Boolean).join(" › "));
    }
  } catch { /* not JSON — the status is all we have */ }
  const text = parts.filter(Boolean).join("; ");
  const detail = `HTTP ${status}${text ? ` — ${text}` : ""}`.slice(0, 400);
  const lower = text.toLowerCase();
  let cls: RadarErrorClass = "other";
  if (status === 429) cls = "rate";
  else if (status === 401 || status === 403 || codes.some((c) => TOKEN_CODES.has(c)) || /authoriz|authenticat|token/.test(lower)) cls = "token";
  // 2001 "validation error: normalization is PERCENTAGE_CHANGE. Must have 1
  // comparison series" (2026-10-27) is a QUERY refusal — the words that
  // name one include the parameter vocabulary and the validator's own.
  else if (status === 400 && (/limit|daterange|date_range|datestart|dateend|offset|format|param|invalid|must be|must have|validation|normalization|aggin|location|series/.test(lower))) cls = "query";
  const hint =
    cls === "token" ? "the credential — use a Custom API Token with Account › Radar › Read (not the Global API Key), pasted with no stray characters" :
    cls === "query" ? "a query parameter the API refused — the message names it" :
    cls === "rate" ? "rate-limited — the pass is retried after the cache window" :
    status === 400 ? (text ? "HTTP 400 — the message names the refused request shape; see the diag" : "HTTP 400 with no error body — the request shape or the credential; see the diag") :
    "the host did not answer usefully";
  return { cls, detail, hint };
}
