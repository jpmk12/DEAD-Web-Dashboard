// Recent armed-conflict / kinetic events for the Crisis map's "Conflict" layer
// (and the AI crisis read), sourced from UCDP — the Uppsala Conflict Data
// Program's Georeferenced Event Dataset (GED). Keyless, reputable, with precise
// coordinates and fatality counts.
//
// Why UCDP and not GDELT: GDELT's GEO 2.0 API (the old source here) was retired
// — every geo path now 404s (confirmed via /api/osint/crisis-diag) — while its
// DOC API returns articles without coordinates, useless for a map layer. ACLED
// is higher-fidelity but the free tier embargoes data <12 months old. UCDP's
// monthly "candidate" dataset (UCDP-CED) is keyless and ~1 month fresh, the best
// no-account option for current geocoded events.
//
// CAVEAT (verify in prod): the build sandbox has no outbound network, so the
// exact UCDP *candidate* version string couldn't be confirmed. We probe a small
// newest-first list and cache the first that returns rows; the crisis-diag UCDP
// probe reports which version/shape actually works so the list can be pinned.

import { aorFromCoords } from "./aor";
import { recordDailySignals, utcDate } from "./trends";

export interface ConflictPoint { lat: number; lon: number; name: string; count: number; title?: string; url?: string }

const UCDP_BASE = "https://ucdpapi.pcr.uu.se/api/gedevents/";
const PAGE_SIZE = 1000;
// Candidate data lags ~1 month, so a 60-day window keeps the layer populated
// with the freshest available events without dredging up stale history.
const RECENT_DAYS = 60;
const MAX_POINTS = 250;

const TTL = 30 * 60 * 1000;
const STALE_TTL = 6 * 60 * 60 * 1000;   // serve last-good points up to 6h on failure
const VERSION_TTL = 24 * 60 * 60 * 1000; // re-confirm the working version daily
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

// Best-guess UCDP version strings, newest-first. Candidate (monthly) versions
// carry the freshest events; annual GED (YY.1) is a stable but older fallback.
// The candidate scheme is unconfirmed from the sandbox — see file header.
export function ucdpVersionCandidates(now = new Date()): string[] {
  const yy = now.getUTCFullYear() % 100;
  const mm = now.getUTCMonth() + 1;
  const cand: string[] = [];
  for (let m = mm; m >= Math.max(1, mm - 2); m--) cand.push(`${yy}.0.${m}`);
  cand.push(`${yy - 1}.0.12`);
  return [...cand, `${yy}.1`, `${yy - 1}.1`];
}

interface UcdpEvent {
  latitude?: unknown; longitude?: unknown; date_start?: unknown; best?: unknown;
  side_a?: unknown; side_b?: unknown; country?: unknown; where_coordinates?: unknown;
  conflict_name?: unknown; id?: unknown;
}

// UCDP returns events under `Result`; parse defensively in case the shape shifts.
function extractResult(data: unknown): UcdpEvent[] {
  const d = data as { Result?: unknown; result?: unknown; data?: unknown };
  const arr = d?.Result ?? d?.result ?? d?.data;
  return Array.isArray(arr) ? (arr as UcdpEvent[]) : [];
}

function withinRecentWindow(dateStart: string, sinceMs: number): boolean {
  const t = Date.parse(dateStart);
  return Number.isFinite(t) && t >= sinceMs;
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

async function fetchVersion(version: string, sinceMs: number, signal: AbortSignal): Promise<ConflictPoint[] | null> {
  const url = `${UCDP_BASE}${version}?pagesize=${PAGE_SIZE}&page=0`;
  const res = await fetch(url, { signal, headers: { "User-Agent": "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)", Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) return null;
  const rows = extractResult(await res.json());
  if (rows.length === 0) return null; // version doesn't exist / empty → try next
  const points: ConflictPoint[] = [];
  for (const e of rows) {
    if (!withinRecentWindow(String(e.date_start ?? ""), sinceMs)) continue;
    const p = toPoint(e);
    if (p) points.push(p);
  }
  return points; // may be [] if the version exists but has no recent events
}

export async function getConflictPoints(): Promise<ConflictPoint[]> {
  if (cache && cache.expires > Date.now()) { lastFetch = { ok: true, at: lastFetch.at || Date.now() }; return cache.points; }
  const sinceMs = Date.now() - RECENT_DAYS * 86_400_000;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 20_000);
  try {
    // Prefer the last confirmed-working version; otherwise probe newest-first.
    const versions = versionCache && versionCache.expires > Date.now()
      ? [versionCache.version, ...ucdpVersionCandidates().filter((v) => v !== versionCache!.version)]
      : ucdpVersionCandidates();

    let points: ConflictPoint[] | null = null;
    for (const v of versions) {
      const got = await fetchVersion(v, sinceMs, ctrl.signal).catch(() => null);
      if (got !== null) { // version exists (returned rows); lock it in
        versionCache = { version: v, expires: Date.now() + VERSION_TTL };
        points = got;
        break;
      }
    }
    if (points === null) return conflictFallback(); // no version responded

    points.sort((a, b) => b.count - a.count);
    const top = points.slice(0, MAX_POINTS);
    if (top.length === 0) return conflictFallback(); // endpoint ok but no recent events
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

// Discovery probe for /api/osint/crisis-diag: reports which UCDP version responds,
// its row count, a sample event, and how many rows fall in the recent window —
// so the candidate-version list above can be pinned to what actually works.
export interface UcdpDiag {
  version?: string;
  status?: number;
  total?: number;
  recent?: number;
  sample?: string;
  tried: string[];
  note: string;
}

export async function diagnoseUcdp(): Promise<UcdpDiag> {
  const sinceMs = Date.now() - RECENT_DAYS * 86_400_000;
  const tried = ucdpVersionCandidates();
  for (const v of tried) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await fetch(`${UCDP_BASE}${v}?pagesize=200&page=0`, { headers: { "User-Agent": "DEAD-Dashboard", Accept: "application/json" }, cache: "no-store", signal: ctrl.signal });
      if (!res.ok) { continue; }
      const data = await res.json().catch(() => null);
      const rows = extractResult(data);
      if (rows.length === 0) continue;
      const recent = rows.filter((e) => withinRecentWindow(String(e.date_start ?? ""), sinceMs)).length;
      const f = rows[0];
      const sample = `${String(f.date_start ?? "?").slice(0, 10)} · ${String(f.country ?? "?")} · ${String(f.side_a ?? "?")} vs ${String(f.side_b ?? "?")}`.slice(0, 160);
      const total = Number((data as { TotalCount?: unknown })?.TotalCount) || rows.length;
      return {
        version: v, status: res.status, total, recent, sample, tried,
        note: recent > 0
          ? `UCDP ${v} works — ${recent} of ${rows.length} sampled rows are within ${RECENT_DAYS}d. Pin this version.`
          : `UCDP ${v} responds but the first page has no events within ${RECENT_DAYS}d — likely an annual (older) version; a monthly candidate version would be fresher.`,
      };
    } catch { /* try next */ } finally { clearTimeout(tid); }
  }
  return { tried, note: "No UCDP version in the probe list responded with rows — the candidate scheme differs; check ucdpapi.pcr.uu.se/apiinfo for the current version and update ucdpVersionCandidates()." };
}
