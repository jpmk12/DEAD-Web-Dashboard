// Space sources — SERVER-ONLY fetchers, all keyless: NOAA SWPC scales
// (current + 3-day predicted), Launch Library 2 (The Space Devs; previous
// and upcoming launches with pad coordinates; ~15 requests/hour, so cached
// long), CelesTrak SOCRATES conjunctions (daily). Parsing lives in
// lib/spaceWeatherOps.ts and lib/spaceCatalog.ts (pure, tested).
// Fail-safe throughout — `live:false` reads UNKNOWN. Contracts unverified
// from the sandbox: `diagnoseSpaceSources()` runs them from production.

import { fetchWithTimeout } from "./fetchTimeout";
import { parseNoaaScales, type NoaaScales } from "./spaceWeatherOps";
import { parseLaunches, parseSocrates, type Launch, type Conjunction } from "./spaceCatalog";

const UA = { "User-Agent": "DEAD-Dashboard/1.0", Accept: "application/json" };
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const SWPC_SCALES_URL = "https://services.swpc.noaa.gov/products/noaa-scales.json";
export const LL2_PREVIOUS_URL = "https://ll.thespacedevs.com/2.2.0/launch/previous/?limit=100&mode=list";
export const LL2_UPCOMING_URL = "https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=50&mode=list";
export const SOCRATES_URL = "https://celestrak.org/SOCRATES/sort-minRange.csv";

// ─── SWPC scales ──────────────────────────────────────────────────────────────

let scalesCache: { at: number; data: NoaaScales } | null = null;
const SCALES_TTL = 15 * 60_000;

export async function getNoaaScales(): Promise<NoaaScales> {
  if (scalesCache && Date.now() - scalesCache.at < SCALES_TTL) return scalesCache.data;
  try {
    const res = await fetchWithTimeout(SWPC_SCALES_URL, { headers: UA, cache: "no-store" }, 10_000);
    if (!res.ok) return { live: false, now: { date: "", R: null, S: null, G: null }, outlook: [] };
    const parsed = parseNoaaScales(await res.json());
    if (parsed.live) scalesCache = { at: Date.now(), data: parsed };
    return parsed;
  } catch { return { live: false, now: { date: "", R: null, S: null, G: null }, outlook: [] }; }
}

// ─── Launch Library 2 ─────────────────────────────────────────────────────────

let launchCache: { at: number; data: Launch[] } | null = null;
const LAUNCH_TTL = 3 * 3600_000;    // the free tier allows ~15 req/h; two calls per refresh

/** Previous (~100, covers ≥90 days of the space powers' cadence) + upcoming
 *  (50) launches, merged. `live:false` when neither call answered. */
export async function getLaunches(): Promise<{ live: boolean; launches: Launch[] }> {
  if (launchCache && Date.now() - launchCache.at < LAUNCH_TTL) return { live: true, launches: launchCache.data };
  const one = async (url: string): Promise<Launch[] | null> => {
    try {
      const res = await fetchWithTimeout(url, { headers: UA, cache: "no-store" }, 12_000);
      if (!res.ok) return null;
      return parseLaunches(await res.json());
    } catch { return null; }
  };
  const [prev, next] = await Promise.all([one(LL2_PREVIOUS_URL), one(LL2_UPCOMING_URL)]);
  if (!prev && !next) return { live: false, launches: [] };
  const seen = new Set<string>();
  const launches: Launch[] = [];
  for (const l of [...(prev ?? []), ...(next ?? [])]) { const k = `${l.name}|${l.net}`; if (!seen.has(k)) { seen.add(k); launches.push(l); } }
  launchCache = { at: Date.now(), data: launches };
  return { live: true, launches };
}

// ─── SOCRATES ─────────────────────────────────────────────────────────────────

let socCache: { at: number; data: Conjunction[] } | null = null;
const SOC_TTL = 12 * 3600_000;

export async function getConjunctions(): Promise<{ live: boolean; conjunctions: Conjunction[] }> {
  if (socCache && Date.now() - socCache.at < SOC_TTL) return { live: true, conjunctions: socCache.data };
  try {
    // A browser User-Agent: CelesTrak refuses bot-shaped clients. The
    // 2026-09-30 production diag still got a connection-level "fetch failed"
    // from this host (not an HTTP error), so the conjunction half stays
    // best-effort — space_activity runs on cadence alone when it is dead.
    const res = await fetchWithTimeout(SOCRATES_URL, { headers: { "User-Agent": BROWSER_UA, Accept: "text/csv,*/*" }, cache: "no-store" }, 15_000);
    if (!res.ok) return { live: false, conjunctions: [] };
    const conjunctions = parseSocrates(await res.text());
    if (conjunctions.length) socCache = { at: Date.now(), data: conjunctions };
    return { live: conjunctions.length > 0, conjunctions };
  } catch { return { live: false, conjunctions: [] }; }
}

export function resetSpaceSourceCaches(): void { scalesCache = null; launchCache = null; socCache = null; }

// ─── diagnostics ──────────────────────────────────────────────────────────────

export interface SpaceSourceDiag { source: string; url: string; status: number; ms: number; bytes: number; parsed: number; snippet: string; error?: string }

export async function diagnoseSpaceSources(): Promise<SpaceSourceDiag[]> {
  const probe = async (source: string, url: string, parse: (text: string) => number, ua = UA["User-Agent"]): Promise<SpaceSourceDiag> => {
    const t0 = Date.now();
    try {
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": ua }, cache: "no-store" }, 15_000);
      const text = await res.text();
      let parsed = 0;
      try { parsed = parse(text); } catch { /* unparseable */ }
      return { source, url, status: res.status, ms: Date.now() - t0, bytes: text.length, parsed, snippet: text.slice(0, 240) };
    } catch (e) {
      return { source, url, status: 0, ms: Date.now() - t0, bytes: 0, parsed: 0, snippet: "", error: e instanceof Error ? e.message : String(e) };
    }
  };
  return Promise.all([
    probe("SWPC scales", SWPC_SCALES_URL, (t) => (parseNoaaScales(JSON.parse(t)).live ? 1 : 0)),
    probe("Launch Library 2 (previous)", LL2_PREVIOUS_URL, (t) => parseLaunches(JSON.parse(t)).length),
    probe("Launch Library 2 (upcoming)", LL2_UPCOMING_URL, (t) => parseLaunches(JSON.parse(t)).length),
    probe("CelesTrak SOCRATES", SOCRATES_URL, (t) => parseSocrates(t).length, BROWSER_UA),
  ]);
}
