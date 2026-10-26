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
import { parseRadarOutages, parseRadarAnomalies, type RadarOutage, type RadarAnomaly } from "./radarSignals";

export const RADAR_BASE = "https://api.cloudflare.com/client/v4/radar";
export const RADAR_OUTAGES_URL = `${RADAR_BASE}/annotations/outages?dateRange=7d&limit=200&format=json`;
export const RADAR_ANOMALIES_URL = `${RADAR_BASE}/traffic_anomalies?dateRange=7d&limit=200&format=json`;
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
  const t = (process.env.CLOUDFLARE_RADAR_TOKEN ?? "").trim();
  return t ? t : null;
}

export async function getRadar(): Promise<RadarBody> {
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  if (inflight) return inflight;
  inflight = load().then((b) => { if (b.live) cache = { at: Date.now(), body: b }; return b; }).finally(() => { inflight = null; });
  return inflight;
}

async function fetchJson(url: string, token: string, timeoutMs = 10_000): Promise<{ status: number; json: unknown | null; error?: string }> {
  try {
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "DEAD-Dashboard/1.0" }, cache: "no-store" }, timeoutMs);
    if (!res.ok) return { status: res.status, json: null, error: `HTTP ${res.status}` };
    return { status: res.status, json: await res.json() };
  } catch (e) {
    return { status: 0, json: null, error: e instanceof Error ? e.message : String(e) };
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
  const authProblem = o.status === 401 || o.status === 403 || a.status === 401 || a.status === 403;
  // A 401/403 is the token, not the internet — say so, in words the
  // operator can act on, without echoing anything about the token itself.
  const reason = failed.length ? (authProblem ? `token refused (${failed.join("; ")}) — check the token's Radar › Read permission` : failed.join("; ")) : null;
  return {
    configured: true,
    live: failed.length === 0,
    outages: o.json ? outages : cache?.body.outages ?? [],
    anomalies: a.json ? anomalies : cache?.body.anomalies ?? [],
    reason, fetchedAt,
  };
}

export interface RadarDiag { source: string; url: string; configured: boolean; status: number; ms: number; parsed: number; error?: string; sample: string[] }

/** Owner-only: the real fetches from production. Reports status + parsed +
 *  a few description lines; the token is never in the reply. */
export async function diagnoseRadar(): Promise<RadarDiag[]> {
  const token = radarToken();
  const probe = async (source: string, url: string, parse: (j: unknown) => { n: number; sample: string[] }): Promise<RadarDiag> => {
    const t0 = Date.now();
    if (!token) return { source, url, configured: false, status: 0, ms: 0, parsed: 0, error: "CLOUDFLARE_RADAR_TOKEN not set", sample: [] };
    const r = await fetchJson(url, token, 15_000);
    const p = r.json ? parse(r.json) : { n: 0, sample: [] };
    return { source, url, configured: true, status: r.status, ms: Date.now() - t0, parsed: p.n, ...(r.error ? { error: r.error } : {}), sample: p.sample };
  };
  return Promise.all([
    probe("Radar outages", RADAR_OUTAGES_URL, (j) => { const xs = parseRadarOutages(j); return { n: xs.length, sample: xs.slice(0, 5).map((x) => `${x.scope} · ${x.cause || "—"} · ${x.countries.map((c) => c.code).join("/") || "—"} · ${x.description.slice(0, 80)}`) }; }),
    probe("Radar traffic anomalies", RADAR_ANOMALIES_URL, (j) => { const xs = parseRadarAnomalies(j); return { n: xs.length, sample: xs.slice(0, 5).map((x) => `${x.type} · ${x.status} · ${x.country?.code ?? (x.asn != null ? `AS${x.asn}` : "—")}`) }; }),
  ]);
}
