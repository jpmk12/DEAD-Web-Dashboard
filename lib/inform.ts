// INFORM (JRC DRMKC) anticipatory layers for the Crisis map:
//   - INFORM Risk: structural country crisis risk 0-10 (annual) — "where crises
//     are likely" baseline.
//   - INFORM Severity: current crisis severity (monthly) — "where crises are
//     happening now, how bad".
// Both are country-level; plotted at centroids (lib/countryCentroids).
//
// The INFORM API serves data per "workflow" (a release), and workflow IDs change
// each cycle — so we DISCOVER the latest workflow whose name matches the product,
// then read its country scores. The exact endpoints/shape couldn't be verified
// from the build sandbox (no egress), so parsing is defensive and diagnoseInform()
// reports what the API actually returns, to pin it in prod. Server-only.

import { countryCentroid } from "./countryCentroids";

const API = "https://drmkc.jrc.ec.europa.eu/inform-index/API/InformAPI";
const UA = "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)";
const TTL = 12 * 60 * 60 * 1000;

export type InformProduct = "risk" | "severity";
export interface InformPoint { country: string; iso3: string; score: number; lat: number; lon: number }

const cache = new Map<InformProduct, { points: InformPoint[]; expires: number }>();
const workflowCache = new Map<InformProduct, { id: string; expires: number }>();

interface Workflow { WorkflowId?: unknown; Name?: unknown }

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// INFORM Risk workflows are named like "INFORM Risk 2026"; Severity like
// "INFORM Severity - <Month> <Year>". Pick the newest match (highest WorkflowId).
function pickWorkflow(list: Workflow[], product: InformProduct): string | null {
  const re = product === "risk" ? /inform\s*risk/i : /inform\s*severity|severity\s*index/i;
  const matches = list
    .filter((w) => re.test(String(w.Name ?? "")) && w.WorkflowId != null)
    .map((w) => ({ id: String(w.WorkflowId), n: Number(w.WorkflowId) }))
    .sort((a, b) => b.n - a.n);
  return matches[0]?.id ?? null;
}

async function resolveWorkflow(product: InformProduct, signal?: AbortSignal): Promise<string | null> {
  const hit = workflowCache.get(product);
  if (hit && hit.expires > Date.now()) return hit.id;
  const data = await getJson(`${API}/workflows/`, signal).catch(() => null);
  const list = Array.isArray(data) ? (data as Workflow[]) : [];
  const id = pickWorkflow(list, product);
  if (id) workflowCache.set(product, { id, expires: Date.now() + TTL });
  return id;
}

interface ScoreRow { Iso3?: unknown; ISO3?: unknown; CountryName?: unknown; Country?: unknown; IndicatorScore?: unknown; Value?: unknown }

function rowsToPoints(rows: ScoreRow[]): InformPoint[] {
  const out: InformPoint[] = [];
  for (const r of rows) {
    const score = Number(r.IndicatorScore ?? r.Value);
    if (!Number.isFinite(score)) continue;
    const iso3 = String(r.Iso3 ?? r.ISO3 ?? "");
    const name = String(r.CountryName ?? r.Country ?? "").trim();
    const c = countryCentroid(name.toLowerCase());
    if (!c) continue; // only plot countries we have a centroid for
    out.push({ country: name, iso3, score, lat: c[0], lon: c[1] });
  }
  return out;
}

export async function getInformPoints(product: InformProduct): Promise<InformPoint[]> {
  const hit = cache.get(product);
  if (hit && hit.expires > Date.now()) return hit.points;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const wf = await resolveWorkflow(product, ctrl.signal);
    if (!wf) return hit?.points ?? [];
    const data = await getJson(`${API}/countries/Scores/?WorkflowId=${encodeURIComponent(wf)}&IndicatorId=INFORM`, ctrl.signal).catch(() => null);
    const rows = Array.isArray(data) ? (data as ScoreRow[]) : [];
    const points = rowsToPoints(rows);
    if (points.length > 0) cache.set(product, { points, expires: Date.now() + TTL });
    return points.length > 0 ? points : (hit?.points ?? []);
  } catch {
    return hit?.points ?? [];
  } finally {
    clearTimeout(tid);
  }
}

export async function diagnoseInform(): Promise<{ product: InformProduct; workflow?: string; rows?: number; plotted?: number; sample?: string; note: string }[]> {
  const out: { product: InformProduct; workflow?: string; rows?: number; plotted?: number; sample?: string; note: string }[] = [];
  for (const product of ["risk", "severity"] as InformProduct[]) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const wf = await resolveWorkflow(product, ctrl.signal);
      if (!wf) { out.push({ product, note: "No matching workflow found at /workflows/ — check the INFORM API base/path or name matching." }); continue; }
      const data = await getJson(`${API}/countries/Scores/?WorkflowId=${encodeURIComponent(wf)}&IndicatorId=INFORM`, ctrl.signal).catch((e) => ({ __err: String(e) }));
      const rows = Array.isArray(data) ? (data as ScoreRow[]) : [];
      const points = rowsToPoints(rows);
      const f = rows[0];
      out.push({
        product, workflow: wf, rows: rows.length, plotted: points.length,
        sample: f ? JSON.stringify(f).slice(0, 160) : (data as { __err?: string })?.__err,
        note: points.length > 0 ? `Working — ${points.length}/${rows.length} countries plotted.`
          : rows.length > 0 ? "Scores returned but none matched a country centroid — check name keys vs lib/countryCentroids."
          : "Workflow resolved but the Scores call returned no rows — check the Scores path / IndicatorId.",
      });
    } catch (e) {
      out.push({ product, note: "Probe threw: " + (e instanceof Error ? e.message : String(e)) });
    } finally {
      clearTimeout(tid);
    }
  }
  return out;
}
