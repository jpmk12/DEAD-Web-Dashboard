// Cloudflare Radar — server-only fetch. Reads `CLOUDFLARE_RADAR_TOKEN` from
// the environment (a free Cloudflare account's Custom API Token with
// Account › Radar › Read); the token is sent as a Bearer header and NEVER
// returned, logged, or placed in a prompt. Not configured → `configured:
// false`, `live:false` with the reason, and every consumer reads UNKNOWN /
// "not configured" — never clear. Parsing and the level rule live in
// lib/radarSignals.ts (pure, tested).
//
// Two requests per pass (outages 7 d + traffic anomalies 7 d), cached
// 15 min, in-flight deduped — far inside the global 1,200 requests / 5 min.
// The host is UNREACHABLE from the build sandbox (egress blocks
// api.cloudflare.com), so the response shape is pinned from the published
// API reference and `diagnoseRadar()` rides `/api/spectrum?diag=1`
// (owner-only): configured / status / parsed per endpoint, never the token.
//
// Data © Cloudflare, CC BY-NC 4.0 — attribution rendered wherever shown.

import { fetchWithTimeout } from "./fetchTimeout";
import { parseRadarOutages, parseRadarAnomalies, describeRadarError, normalizeRadarToken, describeTokenShape, firstNonAscii, isByteStringError, type RadarOutage, type RadarAnomaly, type RadarErrorClass, type RadarTokenShape } from "./radarSignals";
import { parseBgpHijacks, parseBgpLeaks, type BgpHijack, type BgpLeak, type BgpAsnInfo } from "./radarBgp";
import { parseNetflows, trafficRead, NETFLOWS_NORMALIZATIONS, type TrafficRead } from "./radarNetflows";
import { countryIso2 } from "./holidays";

export const RADAR_BASE = "https://api.cloudflare.com/client/v4/radar";
// The query is the shape of the Outages doc's own example
// (`limit=5&offset=0&dateRange=7d&format=json`). The maximum `limit` is not
// published and could not be read from the sandbox; 100 is a common cap and
// seven days of annotations are far fewer. If a 400 names `limit`, lower it.
export const RADAR_QUERY = "limit=100&offset=0&dateRange=7d&format=json";
export const RADAR_OUTAGES_URL = `${RADAR_BASE}/annotations/outages?${RADAR_QUERY}`;
export const RADAR_ANOMALIES_URL = `${RADAR_BASE}/traffic_anomalies?${RADAR_QUERY}`;
export const RADAR_ATTRIBUTION = "Cloudflare Radar — radar.cloudflare.com (CC BY-NC 4.0)";
// BGP events, newest first, one page of 100. `minConfidence=5` keeps the
// mid and high bands (1–4 is mostly misconfiguration by Cloudflare's own
// banding); the parser still bands what arrives. Pinned from the published
// reference, UNVERIFIED from the sandbox — the diag's `rawFirst` is the door.
export const RADAR_HIJACKS_URL = `${RADAR_BASE}/bgp/hijacks/events?dateRange=7d&minConfidence=5&per_page=100&sortBy=TIME&sortOrder=DESC&format=json`;
export const RADAR_LEAKS_URL = `${RADAR_BASE}/bgp/leaks/events?dateRange=7d&per_page=100&sortBy=TIME&sortOrder=DESC&format=json`;
// NetFlows per country: a week of hourly samples. The normalization is
// NEGOTIATED: RAW_VALUES first (a ratio read), MIN0_MAX on a query refusal
// (a drop read in range units — see lib/radarNetflows.ts). PERCENTAGE_CHANGE
// was refused in production (2001 "Must have 1 comparison series"). One
// request per country; the working normalization is remembered per process.
export const netflowsUrl = (iso2: string, normalization: string) => `${RADAR_BASE}/netflows/timeseries?dateRange=7d&aggInterval=1h&normalization=${encodeURIComponent(normalization)}&location=${encodeURIComponent(iso2)}&format=json`;
/** The per-pass cap on NetFlows countries — far inside the API's 1,200 / 5 min. */
export const TRAFFIC_MAX_COUNTRIES = 16;

export interface RadarBody {
  configured: boolean;
  /** Both endpoints answered and parsed. */
  live: boolean;
  outages: RadarOutage[];
  anomalies: RadarAnomaly[];
  reason: string | null;
  fetchedAt: string;
}

const TTL = 15 * 60 * 1000;
let cache: { at: number; body: RadarBody } | null = null;
let inflight: Promise<RadarBody> | null = null;

export function resetRadarCache(): void { cache = null; }

export function radarToken(): string | null {
  // Quotes, a `Bearer ` prefix and whitespace are paste defects, not the
  // token — the 2026-10-26 diag read 9106 "Authentication failed" on a
  // value that may have carried one.
  return normalizeRadarToken(process.env.CLOUDFLARE_RADAR_TOKEN);
}

export async function getRadar(): Promise<RadarBody> {
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  if (inflight) return inflight;
  inflight = load().then((b) => { if (b.live) cache = { at: Date.now(), body: b }; return b; }).finally(() => { inflight = null; });
  return inflight;
}

interface FetchResult { status: number; json: unknown | null; error?: string; errorClass?: RadarErrorClass; hint?: string }

async function fetchJson(url: string, token: string, timeoutMs = 10_000): Promise<FetchResult> {
  try {
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "DEAD-Dashboard/1.0" }, cache: "no-store" }, timeoutMs);
    if (!res.ok) {
      // Keep the error body: Cloudflare says WHY in `errors[]`, and the
      // status alone cannot tell a malformed credential (HTTP 400 code
      // 6003) from an over-limit query (also HTTP 400). Capped; codes and
      // messages only — never the token.
      const text = await res.text().then((t) => t.slice(0, 4_000)).catch(() => "");
      const e = describeRadarError(res.status, text);
      return { status: res.status, json: null, error: e.detail, errorClass: e.cls, hint: e.hint };
    }
    return { status: res.status, json: await res.json() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Node refuses to SEND a header holding a non-Latin-1 character — the
    // request never left the process. That is the credential (a look-alike
    // letter from another alphabet, i.e. a retyped token), not the network.
    if (isByteStringError(msg)) {
      const note = firstNonAscii(token);
      return {
        status: 0, json: null,
        error: `the token holds a character outside ASCII${note ? ` — ${note.script} at position ${note.position}` : ""}; the request was never sent`,
        errorClass: "token",
        hint: "the value was retyped, not copied — re-copy the secret from Cloudflare's Create / Roll Token screen with the copy button and paste it bare",
      };
    }
    return { status: 0, json: null, error: msg, errorClass: "other", hint: "the host did not answer — network or timeout" };
  }
}

async function load(): Promise<RadarBody> {
  const fetchedAt = new Date().toISOString();
  const token = radarToken();
  if (!token) return { configured: false, live: false, outages: [], anomalies: [], reason: "CLOUDFLARE_RADAR_TOKEN not set", fetchedAt };
  const [o, a] = await Promise.all([fetchJson(RADAR_OUTAGES_URL, token), fetchJson(RADAR_ANOMALIES_URL, token)]);
  const outages = o.json ? parseRadarOutages(o.json) : [];
  const anomalies = a.json ? parseRadarAnomalies(a.json) : [];
  const failed: string[] = [];
  if (!o.json) failed.push(`outages: ${o.error ?? "no body"}`);
  if (!a.json) failed.push(`anomalies: ${a.error ?? "no body"}`);
  // The credential is the token, not the internet — say so, in words the
  // operator can act on, without echoing anything about the token itself.
  // (`describeRadarError` classes a 400 with Cloudflare's 6003/6111 codes
  // as the token too — a Global API Key or a stray character in the value.)
  const tokenProblem = o.errorClass === "token" || a.errorClass === "token";
  const queryProblem = o.errorClass === "query" || a.errorClass === "query";
  const reason = failed.length
    ? tokenProblem ? `token refused (${failed.join("; ")}) — ${o.hint ?? a.hint}`
    : queryProblem ? `query refused (${failed.join("; ")}) — ${o.hint ?? a.hint}`
    : failed.join("; ")
    : null;
  return {
    configured: true,
    live: failed.length === 0,
    outages: o.json ? outages : cache?.body.outages ?? [],
    anomalies: a.json ? anomalies : cache?.body.anomalies ?? [],
    reason, fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// BGP hijacks + route leaks — one body, two requests, 15-min cache.

export interface RadarBgpBody {
  configured: boolean;
  /** Both endpoints answered and parsed. */
  live: boolean;
  hijacks: BgpHijack[];
  leaks: BgpLeak[];
  /** Both endpoints' ASN tables, merged. */
  asnInfo: Record<number, BgpAsnInfo>;
  reason: string | null;
  fetchedAt: string;
}

let bgpCache: { at: number; body: RadarBgpBody } | null = null;
let bgpInflight: Promise<RadarBgpBody> | null = null;

export function resetRadarBgpCache(): void { bgpCache = null; }

export async function getRadarBgp(): Promise<RadarBgpBody> {
  if (bgpCache && Date.now() - bgpCache.at < TTL) return bgpCache.body;
  if (bgpInflight) return bgpInflight;
  bgpInflight = loadBgp().then((b) => { if (b.live) bgpCache = { at: Date.now(), body: b }; return b; }).finally(() => { bgpInflight = null; });
  return bgpInflight;
}

async function loadBgp(): Promise<RadarBgpBody> {
  const fetchedAt = new Date().toISOString();
  const token = radarToken();
  if (!token) return { configured: false, live: false, hijacks: [], leaks: [], asnInfo: {}, reason: "CLOUDFLARE_RADAR_TOKEN not set", fetchedAt };
  const [h, l] = await Promise.all([fetchJson(RADAR_HIJACKS_URL, token), fetchJson(RADAR_LEAKS_URL, token)]);
  const hp = h.json ? parseBgpHijacks(h.json) : { events: [], asnInfo: {} };
  const lp = l.json ? parseBgpLeaks(l.json) : { events: [], asnInfo: {} };
  const failed: string[] = [];
  if (!h.json) failed.push(`hijacks: ${h.error ?? "no body"}`);
  if (!l.json) failed.push(`leaks: ${l.error ?? "no body"}`);
  const tokenProblem = h.errorClass === "token" || l.errorClass === "token";
  const reason = failed.length ? (tokenProblem ? `token refused (${failed.join("; ")}) — ${h.hint ?? l.hint}` : failed.join("; ")) : null;
  return {
    configured: true,
    live: failed.length === 0,
    hijacks: h.json ? hp.events : bgpCache?.body.hijacks ?? [],
    leaks: l.json ? lp.events : bgpCache?.body.leaks ?? [],
    asnInfo: { ...(bgpCache?.body.asnInfo ?? {}), ...hp.asnInfo, ...lp.asnInfo },
    reason, fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// NetFlows traffic per country — one request per ISO2, cached 15 min each,
// capped at TRAFFIC_MAX_COUNTRIES per pass, parallel, bounded.

export interface RadarTrafficBody {
  configured: boolean;
  /** Every country asked for answered (a partial pass is live:false with the failed codes named). */
  live: boolean;
  /** Per ISO2 — the read, or null when that country's series did not arrive. */
  reads: Record<string, TrafficRead | null>;
  failed: string[];
  /** Codes beyond the per-pass cap, not asked. */
  skipped: string[];
  reason: string | null;
  fetchedAt: string;
}

const trafficCache = new Map<string, { at: number; read: TrafficRead }>();
/** The normalization the API last accepted (index into NETFLOWS_NORMALIZATIONS). */
let workingNorm = 0;

export function resetRadarTrafficCache(): void { trafficCache.clear(); workingNorm = 0; }

/** One country's series under the negotiated normalization: the preferred
 *  one first, the next on a QUERY refusal (never on a token or network
 *  failure, which would not change with the parameter). Returns the fetch
 *  result and the normalization it was made with. */
async function fetchNetflows(code: string, token: string, timeoutMs: number): Promise<{ r: FetchResult; normalization: string }> {
  for (let i = workingNorm; i < NETFLOWS_NORMALIZATIONS.length; i++) {
    const normalization = NETFLOWS_NORMALIZATIONS[i];
    const r = await fetchJson(netflowsUrl(code, normalization), token, timeoutMs);
    if (r.json) { workingNorm = i; return { r, normalization }; }
    if (r.errorClass !== "query" || i === NETFLOWS_NORMALIZATIONS.length - 1) return { r, normalization };
  }
  return { r: { status: 0, json: null, error: "no normalization accepted", errorClass: "query" }, normalization: NETFLOWS_NORMALIZATIONS[NETFLOWS_NORMALIZATIONS.length - 1] };
}

/** The tracked countries as ISO2 → display name, from the same two prefs
 *  lists the alerts pass reads (watched countries + the countries of the
 *  posture-watched bases). Countries with no ISO code are left out. */
export function trackedRadarCodes(prefs: { countriesOfInterest?: { country: string }[]; forceLocations?: { country?: string | null }[] } | null | undefined): Map<string, string> {
  const names = [...(prefs?.countriesOfInterest ?? []).map((c) => c.country), ...(prefs?.forceLocations ?? []).map((l) => l.country).filter((c): c is string => !!c)];
  const out = new Map<string, string>();
  for (const n of new Set(names)) { const code = countryIso2(n); if (code && !out.has(code)) out.set(code, n); }
  return out;
}

export async function getRadarTraffic(codes: string[]): Promise<RadarTrafficBody> {
  const fetchedAt = new Date().toISOString();
  const want = [...new Set(codes.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];
  const asked = want.slice(0, TRAFFIC_MAX_COUNTRIES);
  const skipped = want.slice(TRAFFIC_MAX_COUNTRIES);
  const token = radarToken();
  if (!token) return { configured: false, live: false, reads: {}, failed: [], skipped, reason: "CLOUDFLARE_RADAR_TOKEN not set", fetchedAt };
  const now = Date.now();
  const reads: Record<string, TrafficRead | null> = {};
  const failed: string[] = [];
  let tokenHint: string | null = null;
  await Promise.all(asked.map(async (code) => {
    const hit = trafficCache.get(code);
    if (hit && now - hit.at < TTL) { reads[code] = hit.read; return; }
    const { r } = await fetchNetflows(code, token, 10_000);
    if (!r.json) { reads[code] = null; failed.push(`${code}: ${r.error ?? "no body"}`); if (r.errorClass === "token") tokenHint = r.hint ?? null; return; }
    const read = trafficRead(parseNetflows(r.json), now);
    trafficCache.set(code, { at: now, read });
    reads[code] = read;
  }));
  const reason = failed.length ? (tokenHint ? `token refused (${failed.join("; ")}) — ${tokenHint}` : failed.join("; ")) : null;
  return { configured: true, live: failed.length === 0, reads, failed, skipped, reason, fetchedAt };
}

export interface RadarDiag {
  source: string; url: string; configured: boolean; status: number; ms: number; parsed: number; error?: string; errorClass?: RadarErrorClass; hint?: string; sample: string[];
  /** The first raw row of a list endpoint, whole (capped) — for the BGP and
   *  NetFlows contracts, which are pinned from the reference and unverified. */
  rawFirst?: string;
  /** The first raw row's field names and its location-shaped fields, so a
   *  renamed or reshaped field is pinned from production (no token here). */
  rawKeys?: string[];
  rawLocations?: string;
}

/** The first row of the endpoint's list (annotations / trafficAnomalies),
 *  reduced to its field names and any field whose name mentions a location. */
function rawShape(json: unknown): { rawKeys: string[]; rawLocations: string } | null {
  const result = (json as { result?: Record<string, unknown> } | null)?.result;
  if (!result || typeof result !== "object") return null;
  const list = Object.values(result).find((v) => Array.isArray(v)) as unknown[] | undefined;
  const row = list?.find((r) => r && typeof r === "object") as Record<string, unknown> | undefined;
  if (!row) return null;
  const loc: Record<string, unknown> = {};
  // The 2026-10-27 diag showed the location-shaped fields EMPTY on the live
  // outage rows while `entities` / `origins` / `originsDetails` / `geoIds`
  // sat beside them unread — so the filter is wide and the cap generous.
  for (const [k, v] of Object.entries(row)) if (/locat|countr|asn|entit|origin|geo|region/i.test(k)) loc[k] = v;
  return { rawKeys: Object.keys(row).slice(0, 40), rawLocations: JSON.stringify(loc).slice(0, 800) };
}

export const RADAR_VERIFY_URL = "https://api.cloudflare.com/client/v4/user/tokens/verify";

export interface RadarVerifyDiag {
  url: string; status: number; ms: number;
  /** Cloudflare's own word on the token: `active` / `expired` / `disabled` — or null when it refused to say. */
  tokenStatus: string | null;
  error?: string;
}

/** Cloudflare's token-verify endpoint: a valid token answers 200 with
 *  `result.status`; an invalid one answers the same auth error the Radar
 *  endpoints do. This separates "the token is bad" from "the token is
 *  fine but lacks the Radar permission" — the latter verifies and then
 *  reads 403 on Radar. */
async function verifyToken(token: string): Promise<RadarVerifyDiag> {
  const t0 = Date.now();
  const r = await fetchJson(RADAR_VERIFY_URL, token, 10_000);
  const status = (r.json as { result?: { status?: unknown } } | null)?.result?.status;
  return { url: RADAR_VERIFY_URL, status: r.status, ms: Date.now() - t0, tokenStatus: typeof status === "string" ? status : null, ...(r.error ? { error: r.error } : {}) };
}

export interface RadarDiagBody {
  /** The token's shape — length, API-token vs Global-API-Key by shape, paste defects stripped — never its characters. */
  token: RadarTokenShape | null;
  verify: RadarVerifyDiag | null;
  endpoints: RadarDiag[];
}

/** Owner-only: the real fetches from production. Reports the token's shape,
 *  Cloudflare's own verify answer, and status + parsed + a few description
 *  lines per endpoint; the token is never in the reply. */
/** `cc` is the ISO2 the NetFlows row probes (default UA — a country with a
 *  live annotation on the first diags, so a normal read is checkable). */
export async function diagnoseRadar(cc = "UA"): Promise<RadarDiagBody> {
  const token = radarToken();
  const [verify, endpoints] = await Promise.all([token ? verifyToken(token) : Promise.resolve(null), diagnoseRadarEndpoints(token, cc)]);
  return { token: describeTokenShape(process.env.CLOUDFLARE_RADAR_TOKEN), verify, endpoints };
}

/** The first EVENT row under `result`, whole, capped — the list named
 *  `events` / `annotations` / `trafficAnomalies` first; the first production
 *  diag (2026-10-27) took `asn_info[0]` because it came first in key order. */
function rawFirst(json: unknown, cap = 1_200): string | null {
  const result = (json as { result?: Record<string, unknown> } | null)?.result;
  if (!result || typeof result !== "object") return null;
  const list = (["events", "annotations", "trafficAnomalies"].map((k) => result[k]).find((v) => Array.isArray(v)) ?? Object.values(result).find((v) => Array.isArray(v))) as unknown[] | undefined;
  const row = list?.find((r) => r && typeof r === "object");
  return row ? JSON.stringify(row).slice(0, cap) : null;
}

async function diagnoseRadarEndpoints(token: string | null, cc: string): Promise<RadarDiag[]> {
  const probe = async (source: string, url: string, parse: (j: unknown) => { n: number; sample: string[] }, whole = false): Promise<RadarDiag> => {
    const t0 = Date.now();
    if (!token) return { source, url, configured: false, status: 0, ms: 0, parsed: 0, error: "CLOUDFLARE_RADAR_TOKEN not set", sample: [] };
    const r = await fetchJson(url, token, 15_000);
    const p = r.json ? parse(r.json) : { n: 0, sample: [] };
    const shape = r.json ? rawShape(r.json) : null;
    const first = whole && r.json ? rawFirst(r.json) : null;
    return { source, url, configured: true, status: r.status, ms: Date.now() - t0, parsed: p.n, ...(r.error ? { error: r.error, errorClass: r.errorClass, hint: r.hint } : {}), sample: p.sample, ...(shape ?? {}), ...(first ? { rawFirst: first } : {}) };
  };
  const code = /^[A-Za-z]{2}$/.test(cc) ? cc.toUpperCase() : "UA";
  return Promise.all([
    // ASCII separators: a diag pasted through a Latin-1 pipe turned "·" into
    // "Â·" on 2026-10-27, which is noise the reader has to see past.
    probe("Radar outages", RADAR_OUTAGES_URL, (j) => { const xs = parseRadarOutages(j); return { n: xs.length, sample: xs.slice(0, 5).map((x) => `${x.scope} | ${x.cause || "-"} | ${x.countries.map((c) => c.code).join("/") || "-"}${x.countriesVia === "asn" ? " (placed by ASN)" : ""} | ${x.description.slice(0, 80)}`) }; }),
    probe("Radar traffic anomalies", RADAR_ANOMALIES_URL, (j) => { const xs = parseRadarAnomalies(j); return { n: xs.length, sample: xs.slice(0, 5).map((x) => `${x.type} | ${x.status} | ${x.asn != null ? `AS${x.asn}` : "-"} | ${x.country?.code ?? "-"}${x.countryVia === "asn" ? " (placed by ASN)" : ""}`) }; }),
    // The BGP and NetFlows contracts are pinned from the reference and
    // unverified: `rawFirst` carries the first raw row whole so one paste
    // corrects a renamed field (the outages lesson, 2026-10-27).
    // The page is the newest 100 events, so the sample's last line says how
    // far back that reaches — the 7-d window is wider than one page.
    probe("Radar BGP hijacks", RADAR_HIJACKS_URL, (j) => { const p = parseBgpHijacks(j); const oldest = p.events.at(-1); return { n: p.events.length, sample: [...p.events.slice(0, 5).map((h) => `${h.band} ${h.confidence} | by AS${h.hijackerAsn ?? "?"} ${h.hijackerCountry ?? "-"} | victims ${h.victimCountries.join("/") || "-"} (AS${h.victimAsns.slice(0, 2).join("/AS") || "?"}) | ${h.prefixes.length} prefixes | ${h.ongoing ? "ongoing" : "ended"} ${new Date(h.lastMs).toISOString().slice(0, 16)}${h.hijackerCountry && h.victimCountries.length === 1 && h.victimCountries[0] === h.hijackerCountry ? " | domestic" : ""}`), ...(oldest ? [`page covers back to ${new Date(oldest.lastMs).toISOString().slice(0, 16)}`] : [])] }; }, true),
    probe("Radar BGP leaks", RADAR_LEAKS_URL, (j) => { const p = parseBgpLeaks(j); const oldest = p.events.at(-1); return { n: p.events.length, sample: [...p.events.slice(0, 5).map((l) => `by AS${l.leakAsn ?? "?"} | ${l.countries.join("/") || "-"} | ${l.prefixCount} prefixes, ${l.peerCount} peers | ${l.finished ? "ended" : "ongoing"} ${new Date(l.lastMs).toISOString().slice(0, 16)}`), ...(oldest ? [`page covers back to ${new Date(oldest.lastMs).toISOString().slice(0, 16)}`] : [])] }; }, true),
    (async (): Promise<RadarDiag> => {
      // NetFlows goes through the same negotiation as the read, so the row
      // reports WHICH normalization the API accepted and what its values
      // look like (the first production diag refused PERCENTAGE_CHANGE).
      const t0 = Date.now();
      if (!token) return { source: `Radar NetFlows ${code}`, url: netflowsUrl(code, NETFLOWS_NORMALIZATIONS[0]), configured: false, status: 0, ms: 0, parsed: 0, error: "CLOUDFLARE_RADAR_TOKEN not set", sample: [] };
      const { r, normalization } = await fetchNetflows(code, token, 15_000);
      const s = r.json ? parseNetflows(r.json) : null;
      const read = trafficRead(s, Date.now());
      const tail = s ? s.values.slice(-4).map((v) => (Number.isInteger(v) ? String(v) : v.toFixed(3))).join(", ") : "-";
      return {
        source: `Radar NetFlows ${code}`, url: netflowsUrl(code, normalization), configured: true, status: r.status, ms: Date.now() - t0, parsed: s ? s.timestamps.length : 0,
        ...(r.error ? { error: r.error, errorClass: r.errorClass, hint: r.hint } : {}),
        sample: s ? [`${read.state} | ratio ${read.ratio == null ? "-" : read.ratio.toFixed(2)} | drop ${read.drop == null ? "-" : read.drop.toFixed(2)} | ${read.why}`, `asked ${normalization} | body says ${s.normalization || "?"} | aggInterval ${s.aggInterval || "?"} | last ${s.timestamps.at(-1) ? new Date(s.timestamps.at(-1)!).toISOString() : "-"} | last values: ${tail}`] : [],
        ...(r.json ? { rawKeys: Object.keys((r.json as { result?: Record<string, unknown> }).result ?? {}).slice(0, 20) } : {}),
      };
    })(),
  ]);
}
