// Recent armed-conflict events for the Crisis map's "Conflict" layer (and the AI
// crisis read), sourced from UCDP — the Uppsala Conflict Data Program's
// Georeferenced Event Dataset (GED). Georeferenced, with precise coordinates and
// fatality counts. Requires a free UCDP API token (see ucdpHeaders below).
//
// Why UCDP and not GDELT: GDELT's GEO 2.0 API (the old source) was retired —
// every geo path 404s (confirmed via /api/osint/crisis-diag) — while its DOC API
// returns articles without coordinates, useless for a map layer. ACLED is
// higher-fidelity but its free tier embargoes data <12 months old. UCDP GED is
// georeferenced and (with a free token) carries current-year candidate data.
//
// Freshness / version: UCDP publishes a monthly CANDIDATE dataset (GED-CED) with
// versions like "26.0.4" (year.0.month, ~1-2 month lag) plus the yearly GED
// ("26.1", covers through the prior year). Candidates increment monthly, so we
// PROBE newest-first (current month down) and fall back to the yearly version,
// caching whichever responds. diagnoseUcdp() reports the resolved version + the
// newest event date so freshness is visible.
//
// API contract (per ucdpapi.pcr.uu.se): GED row order is ARBITRARY, so recency
// is filtered server-side with the StartDate parameter (operates on date_end),
// and results are paged (Result[] + TotalPages) — we never slice a page.

import { aorFromCoords } from "./aor";
import { recordDailySignals, utcDate } from "./trends";

export interface ConflictPoint { lat: number; lon: number; name: string; count: number; title?: string; url?: string }

const UCDP_BASE = "https://ucdpapi.pcr.uu.se/api/gedevents/";
const PAGE_SIZE = 1000;
const MAX_PAGES = 3;                  // sample up to 3k recent events, then rank
// Generous window: the candidate holds the current year; the yearly fallback
// lags. 365d captures whatever recent data the resolved version holds.
const RECENT_DAYS = 365;
const MAX_POINTS = 250;

const TTL = 30 * 60 * 1000;
const STALE_TTL = 6 * 60 * 60 * 1000;    // serve last-good points up to 6h on failure
const VERSION_TTL = 24 * 60 * 60 * 1000; // re-resolve the working version daily
let cache: { points: ConflictPoint[]; expires: number } | null = null;
let staleCache: { points: ConflictPoint[]; at: number } | null = null;
let versionCache: { version: string; expires: number } | null = null;

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

// UCDP GED versions to try, newest-first: monthly candidates for the current year
// (down to month 1), prior-year late-month candidates, then the yearly fallbacks.
export function ucdpVersionCandidates(now = new Date()): string[] {
  const yy = now.getUTCFullYear() % 100;
  const mm = now.getUTCMonth() + 1;
  const out: string[] = [];
  for (let m = mm; m >= 1; m--) out.push(`${yy}.0.${m}`);
  for (let m = 12; m >= 9; m--) out.push(`${yy - 1}.0.${m}`);
  out.push(`${yy}.1`, `${yy - 1}.1`);
  return out;
}

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

// UCDP now requires an API token (returns 401 "API token required. Add header:
// x-ucdp-access-token:" otherwise). Request one from UCDP and set UCDP_API_TOKEN
// in the hosting env; without it the conflict layer is simply off.
function ucdpHeaders(): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)", Accept: "application/json" };
  const t = process.env.UCDP_API_TOKEN?.trim();
  if (t) h["x-ucdp-access-token"] = t;
  return h;
}

// Resolve the freshest UCDP version that exists, newest-first (cached daily). A
// minimal pagesize=1 probe confirms a version responds with rows before we
// commit to paging it.
async function resolveVersion(signal: AbortSignal): Promise<string | null> {
  if (versionCache && versionCache.expires > Date.now()) return versionCache.version;
  for (const v of ucdpVersionCandidates()) {
    try {
      const res = await fetch(`${UCDP_BASE}${v}?pagesize=1&page=0`, { signal, headers: ucdpHeaders(), cache: "no-store" });
      if (!res.ok) continue;
      if (extractResult(await res.json()).length === 0) continue;
      versionCache = { version: v, expires: Date.now() + VERSION_TTL };
      return v;
    } catch { /* try next */ }
  }
  return null;
}

// Page through `version`'s events with date_end >= `since` (StartDate filter),
// up to MAX_PAGES. Returns null only if the first request fails (source down).
async function fetchRecent(version: string, since: string, signal: AbortSignal): Promise<ConflictPoint[] | null> {
  const all: ConflictPoint[] = [];
  let anyOk = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${UCDP_BASE}${version}?pagesize=${PAGE_SIZE}&page=${page}&StartDate=${since}`;
    const res = await fetch(url, { signal, headers: ucdpHeaders(), cache: "no-store" });
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
  const tid = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const version = await resolveVersion(ctrl.signal);
    if (!version) return conflictFallback();
    const got = await fetchRecent(version, since, ctrl.signal).catch(() => null);
    if (got === null) { versionCache = null; return conflictFallback(); } // version went bad — re-resolve next time

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

// Probe for /api/osint/crisis-diag: reports the actual HTTP status / body / row
// count for a few known-good versions, so a blank conflict layer shows its real
// cause (404 wrong version vs 401/403 token-required vs timeout/unreachable vs an
// HTML/WAF body) instead of a vague "no version responded".
export interface UcdpDiag {
  version?: string;
  newest?: string;
  sample?: string;
  variants: { version: string; status: number; ms: number; rows: number; body?: string; error?: string }[];
  note: string;
}

export async function diagnoseUcdp(): Promise<UcdpDiag> {
  const since = ymd(new Date(Date.now() - RECENT_DAYS * 86_400_000));
  // 26.1 / 25.1 are large yearly versions that definitely exist — if even these
  // fail, it's reachability/token, not a version mismatch. 26.0.4 is the latest
  // monthly candidate from the version list.
  const probeVersions = ["26.0.4", "26.1", "25.1"];
  const variants: UcdpDiag["variants"] = [];
  let working: { version: string; newest: string; sample?: string } | null = null;

  for (const v of probeVersions) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 20_000);
    const t0 = Date.now();
    try {
      const res = await fetch(`${UCDP_BASE}${v}?pagesize=3&page=0&StartDate=${since}`, { headers: ucdpHeaders(), cache: "no-store", signal: ctrl.signal });
      const text = await res.text();
      let rows: UcdpEvent[] = [];
      let parsed = false;
      try { rows = extractResult(JSON.parse(text)); parsed = true; } catch { /* non-JSON */ }
      variants.push({
        version: v, status: res.status, ms: Date.now() - t0, rows: rows.length,
        body: (!res.ok || !parsed) ? text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) : undefined,
      });
      if (res.ok && rows.length > 0 && !working) {
        let newest = "";
        for (const e of rows) { const d = String(e.date_start ?? "").slice(0, 10); if (d > newest) newest = d; }
        const f = rows[0];
        working = { version: v, newest, sample: `${String(f.date_start ?? "?").slice(0, 10)} · ${String(f.country ?? "?")} · ${String(f.side_a ?? "?")} vs ${String(f.side_b ?? "?")}`.slice(0, 160) };
      }
    } catch (e) {
      variants.push({ version: v, status: 0, ms: Date.now() - t0, rows: 0, error: e instanceof Error ? e.message : String(e) });
    } finally {
      clearTimeout(tid);
    }
  }

  if (working) {
    return { version: working.version, newest: working.newest, sample: working.sample, variants, note: `UCDP ${working.version} working — newest event ${working.newest || "?"}.` };
  }
  const allZeroStatus = variants.every((v) => v.status === 0);
  const allForbidden = variants.every((v) => v.status === 401 || v.status === 403);
  const tokenSet = !!process.env.UCDP_API_TOKEN?.trim();
  return {
    variants,
    note: allZeroStatus
      ? "Every UCDP request failed before a response (timeout/DNS) — ucdpapi.pcr.uu.se is likely unreachable from the hosting environment. Confirm by running the URL from your own machine."
      : allForbidden
      ? (tokenSet
          ? "UCDP returned 401/403 WITH a token set — the token is invalid/expired or lacks the x-ucdp-access-token header. Request a fresh token from UCDP."
          : "UCDP requires an API token (header x-ucdp-access-token). Request one from UCDP, then set UCDP_API_TOKEN in the hosting env.")
      : "UCDP responded but returned no usable rows — see the per-version status/body below.",
  };
}
