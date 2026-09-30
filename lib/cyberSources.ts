// Cyber sources — SERVER-ONLY fetchers, all keyless, all published feeds:
// IODA outage alerts (Georgia Tech), CISA KEV, CISA cybersecurity
// advisories (RSS), ransomware.live recent victims. Parsing is in
// lib/cyberSignals.ts (pure, tested). Fail-safe throughout: a dead source
// returns `live:false` and the caller reads UNKNOWN, never clear.
//
// Passive only — nothing here probes a network. Contracts pinned from the
// publishers' docs and UNVERIFIED from the build sandbox (egress blocks
// every host): `diagnoseCyberSources()` runs the real fetches from
// production and returns status + snippet + parsed count per source, the
// same door as the EU/UK lists. A moved field shows there as `parsed: 0`.

import { fetchWithTimeout } from "./fetchTimeout";
import { fetchFeed } from "./rss";
import {
  parseIodaAlerts, parseKev, parseRansomwareVictims,
  type IodaAlert, type KevEntry, type RansomVictim, type AdvisoryLite,
} from "./cyberSignals";

const UA = { "User-Agent": "DEAD-Dashboard/1.0", Accept: "application/json" };

export const IODA_ALERTS_URL = "https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts";
export const KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
export const CISA_ADVISORIES_RSS = "https://www.cisa.gov/cybersecurity-advisories/all.xml";
export const RANSOMWARE_LIVE_URL = "https://api.ransomware.live/v2/recentvictims";

interface Cached<T> { at: number; data: T }

// ─── IODA outage alerts ───────────────────────────────────────────────────────

let iodaCache: Cached<IodaAlert[]> | null = null;
const IODA_TTL = 15 * 60_000;

/** Global country/region outage alerts for the last `hours`. EPOCH SECONDS
 *  in from/until — the API silently zeroes relative strings. */
export async function getIodaOutageAlerts(hours = 24): Promise<{ live: boolean; alerts: IodaAlert[] }> {
  if (iodaCache && Date.now() - iodaCache.at < IODA_TTL) return { live: true, alerts: iodaCache.data };
  try {
    const until = Math.floor(Date.now() / 1000);
    const from = until - hours * 3600;
    const res = await fetchWithTimeout(`${IODA_ALERTS_URL}?from=${from}&until=${until}&limit=500`, { headers: UA, cache: "no-store" }, 10_000);
    if (!res.ok) return { live: false, alerts: [] };
    const alerts = parseIodaAlerts(await res.json());
    iodaCache = { at: Date.now(), data: alerts };
    return { live: true, alerts };
  } catch { return { live: false, alerts: [] }; }
}

// ─── CISA KEV ─────────────────────────────────────────────────────────────────

let kevCache: Cached<KevEntry[]> | null = null;
const KEV_TTL = 6 * 3600_000;

export async function getKev(): Promise<{ live: boolean; entries: KevEntry[] }> {
  if (kevCache && Date.now() - kevCache.at < KEV_TTL) return { live: true, entries: kevCache.data };
  try {
    const res = await fetchWithTimeout(KEV_URL, { headers: UA, cache: "no-store" }, 15_000);
    if (!res.ok) return { live: false, entries: [] };
    const entries = parseKev(await res.json());
    if (entries.length) kevCache = { at: Date.now(), data: entries };
    return { live: entries.length > 0, entries };
  } catch { return { live: false, entries: [] }; }
}

// ─── CISA advisories ──────────────────────────────────────────────────────────

let advCache: Cached<AdvisoryLite[]> | null = null;
const ADV_TTL = 60 * 60_000;

export async function getCisaAdvisories(): Promise<{ live: boolean; items: AdvisoryLite[] }> {
  if (advCache && Date.now() - advCache.at < ADV_TTL) return { live: true, items: advCache.data };
  try {
    const r = await fetchFeed(CISA_ADVISORIES_RSS, "CISA", "cyber");
    if (!r.ok) return { live: false, items: [] };
    const items: AdvisoryLite[] = r.items.map((n) => ({ title: n.title, summary: n.summary, link: n.link, pubDate: n.pubDate }));
    advCache = { at: Date.now(), data: items };
    return { live: true, items };
  } catch { return { live: false, items: [] }; }
}

// ─── ransomware.live ──────────────────────────────────────────────────────────

let rlCache: Cached<RansomVictim[]> | null = null;
const RL_TTL = 60 * 60_000;

export async function getRansomwareVictims(): Promise<{ live: boolean; victims: RansomVictim[] }> {
  if (rlCache && Date.now() - rlCache.at < RL_TTL) return { live: true, victims: rlCache.data };
  try {
    const res = await fetchWithTimeout(RANSOMWARE_LIVE_URL, { headers: UA, cache: "no-store" }, 10_000);
    if (!res.ok) return { live: false, victims: [] };
    const victims = parseRansomwareVictims(await res.json());
    rlCache = { at: Date.now(), data: victims };
    return { live: true, victims };
  } catch { return { live: false, victims: [] }; }
}

export function resetCyberSourceCaches(): void { iodaCache = null; kevCache = null; advCache = null; rlCache = null; }

// ─── diagnostics ──────────────────────────────────────────────────────────────

export interface CyberSourceDiag { source: string; url: string; status: number; ms: number; bytes: number; parsed: number; snippet: string; error?: string }

/** Owner-only: real fetches from production, status + snippet + parsed per source. */
export async function diagnoseCyberSources(): Promise<CyberSourceDiag[]> {
  const probe = async (source: string, url: string, parse: (text: string) => number): Promise<CyberSourceDiag> => {
    const t0 = Date.now();
    try {
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA["User-Agent"] }, cache: "no-store" }, 15_000);
      const text = await res.text();
      let parsed = 0;
      try { parsed = parse(text); } catch { /* unparseable */ }
      return { source, url, status: res.status, ms: Date.now() - t0, bytes: text.length, parsed, snippet: text.slice(0, 240) };
    } catch (e) {
      return { source, url, status: 0, ms: Date.now() - t0, bytes: 0, parsed: 0, snippet: "", error: e instanceof Error ? e.message : String(e) };
    }
  };
  const until = Math.floor(Date.now() / 1000);
  return Promise.all([
    probe("IODA alerts", `${IODA_ALERTS_URL}?from=${until - 86_400}&until=${until}&limit=50`, (t) => parseIodaAlerts(JSON.parse(t)).length),
    probe("CISA KEV", KEV_URL, (t) => parseKev(JSON.parse(t)).length),
    probe("CISA advisories", CISA_ADVISORIES_RSS, (t) => (t.match(/<item>/g) ?? []).length),
    probe("ransomware.live", RANSOMWARE_LIVE_URL, (t) => parseRansomwareVictims(JSON.parse(t)).length),
  ]);
}
