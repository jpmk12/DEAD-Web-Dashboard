// Space sources — SERVER-ONLY fetchers, all keyless: NOAA SWPC scales
// (current + 3-day predicted), Launch Library 2 (The Space Devs; previous
// and upcoming launches with pad coordinates; ~15 requests/hour, so cached
// long), CelesTrak SOCRATES conjunctions (daily). Parsing lives in
// lib/spaceWeatherOps.ts and lib/spaceCatalog.ts (pure, tested).
// Fail-safe throughout — `live:false` reads UNKNOWN. Contracts unverified
// from the sandbox: `diagnoseSpaceSources()` runs them from production.

import { fetchWithTimeout } from "./fetchTimeout";
import { parseNoaaScales, type NoaaScales } from "./spaceWeatherOps";
import { parseLaunches, socratesColumns, parseSocratesRow, SOCRATES_CLOSE_KM, type Launch, type Conjunction } from "./spaceCatalog";

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

let socCache: { at: number; data: Conjunction[]; note: string } | null = null;
const SOC_TTL = 12 * 3600_000;
// The live file (2026-10-24 production diag): 22.9 MB, ~201k rows, ~20 s to
// download whole — never `res.text()` it on a request path (the EU-CSV 502).
// It is SORTED BY MINIMUM RANGE, so the close approaches are the first few
// hundred KB: stream line by line and stop once `SOC_PAST_STOP` consecutive
// rows have passed SOCRATES_CLOSE_KM (a guard against local disorder), with a
// byte cap and a body deadline as the outer bounds. Note that
// `fetchWithTimeout` bounds only the wait for HEADERS; the body needs its own.
const SOC_DEADLINE_MS = 12_000;
const SOC_MAX_BYTES = 6 * 1024 * 1024;
const SOC_PAST_STOP = 50;
const SOC_MAX_KEPT = 20_000;

export interface ConjunctionsResult {
  live: boolean;
  conjunctions: Conjunction[];
  /** Why it stopped / why it is not live — in words, for the diag and the sensor note. */
  note: string;
  bytes: number;
  /** Data rows read before stopping. */
  rows: number;
  status: number;
  ms: number;
  snippet: string;
}

const dead = (note: string, partial: Partial<ConjunctionsResult> = {}): ConjunctionsResult =>
  ({ live: false, conjunctions: [], note, bytes: 0, rows: 0, status: 0, ms: 0, snippet: "", ...partial });

/** Stream the sorted SOCRATES file and keep only the rows inside
 *  SOCRATES_CLOSE_KM. Live when the header was recognised AND it carried a
 *  range column AND at least one row was read — a file with no range column
 *  cannot say anything about closeness and reads UNKNOWN, never close. */
export async function streamSocrates(): Promise<ConjunctionsResult> {
  const t0 = Date.now();
  let res: Response;
  try {
    // A browser User-Agent: CelesTrak refuses bot-shaped clients.
    res = await fetchWithTimeout(SOCRATES_URL, { headers: { "User-Agent": BROWSER_UA, Accept: "text/csv,*/*" }, cache: "no-store" }, SOC_DEADLINE_MS);
  } catch (e) {
    return dead(`fetch failed: ${e instanceof Error ? e.message : String(e)}`, { ms: Date.now() - t0 });
  }
  if (!res.ok || !res.body) return dead(`HTTP ${res.status}`, { status: res.status, ms: Date.now() - t0 });

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  const kept: Conjunction[] = [];
  let cols: ReturnType<typeof socratesColumns> | null = null;
  let headerSeen = false;
  let carry = "", snippet = "", bytes = 0, rows = 0, past = 0;
  let note = "";
  let capped = false;
  const stop = async (why: string) => { note = why; await reader.cancel().catch(() => {}); };

  try {
    outer: for (;;) {
      if (Date.now() - t0 > SOC_DEADLINE_MS) { await stop(`body deadline after ${rows} rows`); break; }
      const { done, value } = await reader.read();
      if (done) { note = note || `end of file after ${rows} rows`; break; }
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > SOC_MAX_BYTES) { await stop(`byte cap after ${rows} rows`); break; }
      const text = carry + decoder.decode(value, { stream: true });
      if (snippet.length < 240) snippet = (snippet + text).slice(0, 240);
      const parts = text.split(/\r?\n/);
      carry = parts.pop() ?? "";
      for (const line of parts) {
        if (!line.trim()) continue;
        if (!headerSeen) {
          headerSeen = true;
          cols = socratesColumns(line);
          if (!cols) { await stop(`header unrecognised: ${line.slice(0, 120)}`); break outer; }
          if (cols.range < 0) { await stop("no range column in header — rows cannot claim closeness"); break outer; }
          continue;
        }
        const c = parseSocratesRow(cols!, line);
        if (!c) continue;
        rows++;
        if (c.minRangeKm == null) continue;                      // an unparseable range is unknown, not close
        if (c.minRangeKm <= SOCRATES_CLOSE_KM) { past = 0; if (kept.length < SOC_MAX_KEPT) kept.push(c); else capped = true; }
        else if (++past >= SOC_PAST_STOP) { await stop(`stopped at ${SOCRATES_CLOSE_KM} km after ${rows} rows (sorted by range)`); break outer; }
      }
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    return dead(`read failed: ${e instanceof Error ? e.message : String(e)}`, { status: res.status, bytes, rows, ms: Date.now() - t0, snippet });
  }

  const usable = !!cols && cols.range >= 0 && rows > 0;
  // ASCII separators: a diag pasted through a Latin-1 pipe turns "·" into "Â·".
  const capNote = capped ? ` | kept cap ${SOC_MAX_KEPT} reached, closer rows kept, the rest inside ${SOCRATES_CLOSE_KM} km unread` : "";
  return { live: usable, conjunctions: usable ? kept : [], note: usable ? `${kept.length} within ${SOCRATES_CLOSE_KM} km | ${note}${capNote}` : note || "no rows", bytes, rows, status: res.status, ms: Date.now() - t0, snippet };
}

export async function getConjunctions(): Promise<{ live: boolean; conjunctions: Conjunction[]; note?: string }> {
  if (socCache && Date.now() - socCache.at < SOC_TTL) return { live: true, conjunctions: socCache.data, note: socCache.note };
  try {
    const r = await streamSocrates();
    if (r.live) socCache = { at: Date.now(), data: r.conjunctions, note: r.note };
    return { live: r.live, conjunctions: r.conjunctions, note: r.note };
  } catch (e) { return { live: false, conjunctions: [], note: e instanceof Error ? e.message : String(e) }; }
}

export function resetSpaceSourceCaches(): void { scalesCache = null; launchCache = null; socCache = null; }

// ─── diagnostics ──────────────────────────────────────────────────────────────

export interface SpaceSourceDiag { source: string; url: string; status: number; ms: number; bytes: number; parsed: number; snippet: string; error?: string; note?: string }

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
    // SOCRATES goes through the SAME streaming reader the sensor uses — the
    // generic probe would pull the whole 20+ MB file into memory. `parsed` is
    // the rows kept inside SOCRATES_CLOSE_KM; `note` says why the read stopped.
    streamSocrates().then((r): SpaceSourceDiag => ({
      source: "CelesTrak SOCRATES", url: SOCRATES_URL, status: r.status, ms: r.ms, bytes: r.bytes, parsed: r.conjunctions.length, snippet: r.snippet,
      note: `${r.rows} rows read · ${r.note}`, ...(r.live ? {} : { error: r.note }),
    })),
  ]);
}
