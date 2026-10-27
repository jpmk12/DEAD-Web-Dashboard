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

export const RADAR_BASE = "https://api.cloudflare.com/client/v4/radar";
// The query is the shape of the Outages doc's own example
// (`limit=5&offset=0&dateRange=7d&format=json`). The maximum `limit` is not
// published and could not be read from the sandbox; 100 is a common cap and
// seven days of annotations are far fewer. If a 400 names `limit`, lower it.
export const RADAR_QUERY = "limit=100&offset=0&dateRange=7d&format=json";
export const RADAR_OUTAGES_URL = `${RADAR_BASE}/annotations/outages?${RADAR_QUERY}`;
export const RADAR_ANOMALIES_URL = `${RADAR_BASE}/traffic_anomalies?${RADAR_QUERY}`;
export const RADAR_ATTRIBUTION = "Cloudflare Radar — radar.cloudflare.com (CC BY-NC 4.0)";

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

export interface RadarDiag {
  source: string; url: string; configured: boolean; status: number; ms: number; parsed: number; error?: string; errorClass?: RadarErrorClass; hint?: string; sample: string[];
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
export async function diagnoseRadar(): Promise<RadarDiagBody> {
  const token = radarToken();
  const [verify, endpoints] = await Promise.all([token ? verifyToken(token) : Promise.resolve(null), diagnoseRadarEndpoints(token)]);
  return { token: describeTokenShape(process.env.CLOUDFLARE_RADAR_TOKEN), verify, endpoints };
}

async function diagnoseRadarEndpoints(token: string | null): Promise<RadarDiag[]> {
  const probe = async (source: string, url: string, parse: (j: unknown) => { n: number; sample: string[] }): Promise<RadarDiag> => {
    const t0 = Date.now();
    if (!token) return { source, url, configured: false, status: 0, ms: 0, parsed: 0, error: "CLOUDFLARE_RADAR_TOKEN not set", sample: [] };
    const r = await fetchJson(url, token, 15_000);
    const p = r.json ? parse(r.json) : { n: 0, sample: [] };
    const shape = r.json ? rawShape(r.json) : null;
    return { source, url, configured: true, status: r.status, ms: Date.now() - t0, parsed: p.n, ...(r.error ? { error: r.error, errorClass: r.errorClass, hint: r.hint } : {}), sample: p.sample, ...(shape ?? {}) };
  };
  return Promise.all([
    // ASCII separators: a diag pasted through a Latin-1 pipe turned "·" into
    // "Â·" on 2026-10-27, which is noise the reader has to see past.
    probe("Radar outages", RADAR_OUTAGES_URL, (j) => { const xs = parseRadarOutages(j); return { n: xs.length, sample: xs.slice(0, 5).map((x) => `${x.scope} | ${x.cause || "-"} | ${x.countries.map((c) => c.code).join("/") || "-"}${x.countriesVia === "asn" ? " (placed by ASN)" : ""} | ${x.description.slice(0, 80)}`) }; }),
    probe("Radar traffic anomalies", RADAR_ANOMALIES_URL, (j) => { const xs = parseRadarAnomalies(j); return { n: xs.length, sample: xs.slice(0, 5).map((x) => `${x.type} | ${x.status} | ${x.asn != null ? `AS${x.asn}` : "-"} | ${x.country?.code ?? "-"}${x.countryVia === "asn" ? " (placed by ASN)" : ""}`) }; }),
  ]);
}
