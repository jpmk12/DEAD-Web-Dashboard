// INFORM Risk anticipatory layer for the Crisis map: the structural country
// crisis-risk index (INFORM_OVRL, 0-10), updated annually — a "where crises are
// likely" baseline under the live disaster/conflict signals.
//
// Sourced from the World Bank **Data360** API (DRMKC_INFORM dataset), NOT the JRC
// site directly: the JRC data endpoint resets datacenter/hosting IPs mid-response
// (ECONNRESET), whereas Data360 is a CDN-backed host built for programmatic
// access. Country-level; plotted at centroids (lib/countryCentroids) by name —
// only countries we have a centroid for are plotted (the crisis-prone set).
//
// INFORM **Severity** is intentionally NOT sourced here: it isn't carried by this
// dataset (Data360/JRC GRI are Risk-only) — it's distributed as Excel on HDX. The
// Severity map toggle is omitted until/unless that separate source is wired.

import { countryCentroid } from "./countryCentroids";

const DATA_URL = "https://data360api.worldbank.org/data360/data";
// INFORM_OVRL = overall INFORM Risk index. top large enough to return all
// countries × all release years in one page; we then keep the latest year each.
const QUERY = "DATABASE_ID=DRMKC_INFORM&INDICATOR=INFORM_OVRL&skip=0&top=5000";
const UA = "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)";
const TTL = 12 * 60 * 60 * 1000;

export type InformProduct = "risk" | "severity";
export interface InformPoint { country: string; iso3: string; score: number; lat: number; lon: number; year: string }

interface Row { OBS_VALUE?: unknown; TIME_PERIOD?: unknown; REF_AREA?: unknown; REF_AREA_NAME?: unknown }

let cache: { points: InformPoint[]; expires: number } | null = null;

async function fetchRows(signal?: AbortSignal): Promise<Row[]> {
  const res = await fetch(`${DATA_URL}?${QUERY}`, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as { value?: unknown };
  return Array.isArray(j?.value) ? (j.value as Row[]) : [];
}

// Keep the most recent TIME_PERIOD per country, then map to a plottable point.
function rowsToPoints(rows: Row[]): InformPoint[] {
  const latest = new Map<string, Row>();
  for (const r of rows) {
    const iso3 = String(r.REF_AREA ?? "");
    if (!iso3) continue;
    const prev = latest.get(iso3);
    if (!prev || String(r.TIME_PERIOD ?? "") > String(prev.TIME_PERIOD ?? "")) latest.set(iso3, r);
  }
  const out: InformPoint[] = [];
  for (const r of latest.values()) {
    const score = Number(r.OBS_VALUE);
    if (!Number.isFinite(score)) continue;
    const name = String(r.REF_AREA_NAME ?? "").trim();
    const c = countryCentroid(name.toLowerCase());
    if (!c) continue; // only plot countries we have a centroid for
    out.push({ country: name, iso3: String(r.REF_AREA ?? ""), score, lat: c[0], lon: c[1], year: String(r.TIME_PERIOD ?? "") });
  }
  return out;
}

export async function getInformPoints(product: InformProduct): Promise<InformPoint[]> {
  if (product !== "risk") return []; // Severity not sourced (see file header)
  if (cache && cache.expires > Date.now()) return cache.points;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const points = rowsToPoints(await fetchRows(ctrl.signal));
    if (points.length > 0) cache = { points, expires: Date.now() + TTL };
    return points.length > 0 ? points : (cache?.points ?? []);
  } catch {
    return cache?.points ?? [];
  } finally {
    clearTimeout(tid);
  }
}

function errDetail(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as { cause?: unknown }).cause;
    return e.message + (cause ? ` (cause: ${cause instanceof Error ? cause.message : String(cause)})` : "");
  }
  return String(e);
}

export async function diagnoseInform(): Promise<{ source: string; rows?: number; plotted?: number; latestYear?: string; sample?: string; note: string }> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const rows = await fetchRows(ctrl.signal);
    const points = rowsToPoints(rows);
    const latestYear = points.reduce((m, p) => (p.year > m ? p.year : m), "");
    const f = points[0];
    return {
      source: "data360 DRMKC_INFORM / INFORM_OVRL",
      rows: rows.length, plotted: points.length, latestYear,
      sample: f ? `${f.country} (${f.iso3}) ${f.score} [${f.year}]` : JSON.stringify(rows[0] ?? null).slice(0, 160),
      note: points.length > 0
        ? `INFORM Risk working — ${points.length} countries plotted (latest ${latestYear}).`
        : rows.length > 0
          ? "Rows returned but none matched a country centroid — check REF_AREA_NAME vs lib/countryCentroids."
          : "Data360 returned no rows — check DATABASE_ID/INDICATOR or host reachability.",
    };
  } catch (e) {
    return { source: "data360 DRMKC_INFORM / INFORM_OVRL", note: "Probe failed: " + errDetail(e) };
  } finally {
    clearTimeout(tid);
  }
}
