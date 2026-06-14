// Recent armed-conflict events for the Crisis map's "Conflict" layer (and the AI
// crisis read), sourced from UCDP — the Uppsala Conflict Data Program's
// Georeferenced Event Dataset (GED). Keyless, reputable, with precise
// coordinates and fatality counts.
//
// Why UCDP and not GDELT: GDELT's GEO 2.0 API (the old source) was retired —
// every geo path 404s (confirmed via /api/osint/crisis-diag) — while its DOC API
// returns articles without coordinates, useless for a map layer. ACLED is
// higher-fidelity but its free tier embargoes data <12 months old. UCDP GED is
// keyless and georeferenced.
//
// Freshness: the *yearly* GED (version YY.1) lags — 26.1 covers through end-2025
// — so "recent" here means the most recent ~year the dataset holds (still fresher
// than ACLED's 12-month embargo, and active conflict zones persist). If/when a
// monthly UCDP candidate (CED) version is pinned, this gets ~1-month fresh.
//
// API contract (per ucdpapi.pcr.uu.se): GED row order is ARBITRARY, so we filter
// recency server-side with the StartDate parameter (operates on date_end) rather
// than slicing a page; results are paged (Result[] + TotalPages).

import { aorFromCoords } from "./aor";
import { recordDailySignals, utcDate } from "./trends";

export interface ConflictPoint { lat: number; lon: number; name: string; count: number; title?: string; url?: string }

const UCDP_BASE = "https://ucdpapi.pcr.uu.se/api/gedevents/";
// Latest yearly GED. Update when a newer version (or a monthly candidate) is
// confirmed via diagnoseUcdp(); the yearly dataset covers through the prior year.
const UCDP_VERSION = "26.1";
const PAGE_SIZE = 1000;
const MAX_PAGES = 3;                  // sample up to 3k recent events, then rank
// Annual GED lags, so a 1-year window captures the most recent data it holds.
const RECENT_DAYS = 365;
const MAX_POINTS = 250;

const TTL = 30 * 60 * 1000;
const STALE_TTL = 6 * 60 * 60 * 1000; // serve last-good points up to 6h on failure
let cache: { points: ConflictPoint[]; expires: number } | null = null;
let staleCache: { points: ConflictPoint[]; at: number } | null = null;

let lastFetch: { ok: boolean; at: number; stale?: boolean } = { ok: false, at: 0 };
export function getConflictHealth(): { ok: boolean; at: number; stale?: boolean } { return lastFetch; }

function conflictFallback(): ConflictPoint[] {
  if (staleCache && Date.now() - staleCache.at < STALE_TTL) {
    lastFetch = { ok: true, at: staleCache.at, stale: true };
    return staleCache.points;
  }
  lastFetch = { ok: false, at: Date.now() };
  return [];
}

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

interface UcdpEvent {
  latitude?: unknown; longitude?: unknown; date_start?: unknown; best?: unknown;
  side_a?: unknown; side_b?: unknown; country?: unknown; where_coordinates?: unknown;
  conflict_name?: unknown;
}

// UCDP returns events under `Result`; parse defensively in case the shape shifts.
function extractResult(data: unknown): UcdpEvent[] {
  const d = data as { Result?: unknown; result?: unknown; data?: unknown };
  const arr = d?.Result ?? d?.result ?? d?.data;
  return Array.isArray(arr) ? (arr as UcdpEvent[]) : [];
}

function toPoint(e: UcdpEvent): ConflictPoint | null {
  const lat = Number(e.latitude), lon = Number(e.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const a = String(e.side_a ?? "").trim(), b = String(e.side_b ?? "").trim();
  const title = a && b ? `${a} vs ${b}` : (String(e.conflict_name ?? "").trim() || a || b || undefined);
  const name = String(e.where_coordinates ?? e.country ?? "").slice(0, 120);
  const deaths = Number(e.best);
  return { lat, lon, name, count: Number.isFinite(deaths) && deaths > 0 ? deaths : 1, title };
}

const reqHeaders = { "User-Agent": "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)", Accept: "application/json" };

// Page through GED events with date_end >= `since` (StartDate filter), up to
// MAX_PAGES. Returns null only if the very first request fails (source down).
async function fetchRecent(since: string, signal: AbortSignal): Promise<ConflictPoint[] | null> {
  const all: ConflictPoint[] = [];
  let anyOk = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${UCDP_BASE}${UCDP_VERSION}?pagesize=${PAGE_SIZE}&page=${page}&StartDate=${since}`;
    const res = await fetch(url, { signal, headers: reqHeaders, cache: "no-store" });
    if (!res.ok) break;
    anyOk = true;
    const data = await res.json().catch(() => null);
    const rows = extractResult(data);
    for (const e of rows) { const p = toPoint(e); if (p) all.push(p); }
    const totalPages = Number((data as { TotalPages?: unknown })?.TotalPages) || 1;
    if (rows.length === 0 || page + 1 >= totalPages) break;
  }
  return anyOk ? all : null;
}

export async function getConflictPoints(): Promise<ConflictPoint[]> {
  if (cache && cache.expires > Date.now()) { lastFetch = { ok: true, at: lastFetch.at || Date.now() }; return cache.points; }
  const since = ymd(new Date(Date.now() - RECENT_DAYS * 86_400_000));
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const got = await fetchRecent(since, ctrl.signal).catch(() => null);
    if (got === null) return conflictFallback();

    got.sort((a, b) => b.count - a.count); // highest-fatality first
    const top = got.slice(0, MAX_POINTS);
    if (top.length === 0) return conflictFallback();
    cache = { points: top, expires: Date.now() + TTL };
    staleCache = { points: top, at: Date.now() };
    lastFetch = { ok: true, at: Date.now() };

    // Trend recorder (P1): one count per place per UTC day. Fire-and-forget.
    const day = utcDate();
    recordDailySignals(top.filter((p) => p.name).map((p) => ({
      id: `ucdp|${day}|${p.name}`,
      terms: [
        { kind: "region" as const, term: p.name },
        { kind: "aor" as const, term: aorFromCoords(p.lat, p.lon) },
      ].filter((t) => t.term !== "UNKNOWN"),
    }))).catch(() => {});

    return top;
  } catch {
    return conflictFallback();
  } finally {
    clearTimeout(tid);
  }
}

// Probe for /api/osint/crisis-diag: confirms the pinned version responds with
// recent (StartDate-filtered) rows, and reports the newest event date so the
// layer's true freshness is visible.
export interface UcdpDiag {
  version: string;
  status?: number;
  total?: number;
  returned?: number;
  newest?: string;
  sample?: string;
  note: string;
}

export async function diagnoseUcdp(): Promise<UcdpDiag> {
  const since = ymd(new Date(Date.now() - RECENT_DAYS * 86_400_000));
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`${UCDP_BASE}${UCDP_VERSION}?pagesize=200&page=0&StartDate=${since}`, { headers: reqHeaders, cache: "no-store", signal: ctrl.signal });
    if (!res.ok) return { version: UCDP_VERSION, status: res.status, note: `UCDP ${UCDP_VERSION} returned HTTP ${res.status} — check the version at ucdpapi.pcr.uu.se/apiinfo or whether a token is now required.` };
    const data = await res.json().catch(() => null);
    const rows = extractResult(data);
    const total = Number((data as { TotalCount?: unknown })?.TotalCount) || rows.length;
    let newest = "";
    for (const e of rows) { const d = String(e.date_start ?? "").slice(0, 10); if (d > newest) newest = d; }
    const f = rows[0];
    const sample = f ? `${String(f.date_start ?? "?").slice(0, 10)} · ${String(f.country ?? "?")} · ${String(f.side_a ?? "?")} vs ${String(f.side_b ?? "?")}`.slice(0, 160) : undefined;
    return {
      version: UCDP_VERSION, status: res.status, total, returned: rows.length, newest, sample,
      note: rows.length > 0
        ? `UCDP ${UCDP_VERSION} working — ${total} events since ${since}; newest ${newest || "?"}. (Yearly GED lags ~6mo; pin a monthly candidate version here for fresher data if one exists.)`
        : `UCDP ${UCDP_VERSION} responded 200 but no rows since ${since} — widen RECENT_DAYS or the version has no data in range.`,
    };
  } catch (e) {
    return { version: UCDP_VERSION, note: "UCDP probe failed: " + (e instanceof Error ? e.message : String(e)) };
  } finally {
    clearTimeout(tid);
  }
}
