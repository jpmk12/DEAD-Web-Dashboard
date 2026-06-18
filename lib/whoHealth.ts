// Host-nation health: structural country health indicators from the WHO Global
// Health Observatory (GHO) OData API — the same keyless OData family as the
// INFORM Risk feed. Sits under the live WHO Disease Outbreak News (lib/health)
// in the Regional dossier's "Host-nation health" card.
//
// Six fields surfaced (DON outbreaks come from lib/health; the rest here):
//   • UHC service coverage index (0–100)   UHC_INDEX_REPORTED
//   • Basic drinking water (%)              WSH_WATER_BASIC
//   • Basic sanitation (%)                  WSH_SANITATION_BASIC
//   • Malaria incidence / endemicity        MALARIA_EST_INCIDENCE
//   • DTP3 immunization (%)                 WHS4_100
//   • Measles MCV2 immunization (%)         MCV2
//
// Efficiency: each indicator is fetched ONCE globally (all countries) and cached
// 24h, so after the first dossier load every other country is served from cache
// with no new GHO calls. Pure parsers are unit-tested; fetches are fail-safe
// (null → the card omits that value, never a fake one). Server-only.

import { fetchWithTimeout } from "./fetchTimeout";

const GHO_BASE = "https://ghoapi.azureedge.net/api";
const UA = "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)";
const TTL = 24 * 60 * 60 * 1000;

export type Posture = "green" | "amber" | "red" | "unknown";

export interface HealthIndicator {
  key: string;
  label: string;
  value: number | null;
  display: string;     // formatted ("77/100", "94%", "endemic", "none", "—")
  year: string;
  posture: Posture;
}

export interface HostNationHealth {
  iso3: string;
  indicators: HealthIndicator[];
}

// ── Posture thresholds (coarse planning bands; see the approved mockup) ───────
const uhcPosture = (v: number | null): Posture => v == null ? "unknown" : v < 50 ? "red" : v < 65 ? "amber" : "green";
const pctPosture = (v: number | null): Posture => v == null ? "unknown" : v < 60 ? "red" : v < 75 ? "amber" : "green";
const immPosture = (v: number | null): Posture => v == null ? "unknown" : v < 60 ? "red" : v < 80 ? "amber" : "green";

interface IndicatorDef {
  code: string;
  key: string;
  label: string;
  fmt: (v: number) => string;
  posture: (v: number | null) => Posture;
  absentIsNone?: boolean; // malaria: no row = non-endemic (green "none"), not "unknown"
}

export const INDICATORS: IndicatorDef[] = [
  { code: "UHC_INDEX_REPORTED", key: "uhc", label: "UHC service coverage", fmt: (v) => `${Math.round(v)}/100`, posture: uhcPosture },
  { code: "WSH_WATER_BASIC", key: "water", label: "Basic drinking water", fmt: (v) => `${Math.round(v)}%`, posture: pctPosture },
  { code: "WSH_SANITATION_BASIC", key: "sanitation", label: "Basic sanitation", fmt: (v) => `${Math.round(v)}%`, posture: pctPosture },
  { code: "MALARIA_EST_INCIDENCE", key: "malaria", label: "Malaria incidence", fmt: (v) => (v > 0 ? "endemic" : "none"), posture: (v) => (v != null && v > 0 ? "red" : "green"), absentIsNone: true },
  { code: "WHS4_100", key: "dtp3", label: "DTP3 immunization", fmt: (v) => `${Math.round(v)}%`, posture: immPosture },
  { code: "MCV2", key: "measles", label: "Measles (MCV2)", fmt: (v) => `${Math.round(v)}%`, posture: immPosture },
];

// ── Pure parsing ─────────────────────────────────────────────────────────────

interface GhoRow { SpatialDim?: unknown; SpatialDimType?: unknown; TimeDim?: unknown; NumericValue?: unknown; Value?: unknown; Dim1?: unknown }

// Prefer the most aggregate disaggregation (total / both-sexes) over rural/urban
// or per-sex splits. Lower rank wins.
function dimRank(dim: string | null): number {
  if (!dim) return 0;
  const d = dim.toUpperCase();
  if (d.includes("TOTL") || d === "BTSX" || d === "TOTAL") return 0;
  if (d.includes("RUR") || d.includes("URB")) return 3;
  if (d === "MLE" || d === "FMLE" || d === "MALE" || d === "FMLE") return 4;
  return 1;
}

// PURE: GHO indicator rows → latest value per ISO3 country (best disaggregation).
// Keeps only country-level rows (drops WHO region / global aggregates). Exported
// for unit tests.
export function parseIndicatorRows(rows: unknown): Map<string, { value: number; year: string }> {
  const out = new Map<string, { value: number; year: string; yr: number; rank: number }>();
  const arr = Array.isArray((rows as { value?: unknown[] })?.value) ? (rows as { value: unknown[] }).value : Array.isArray(rows) ? (rows as unknown[]) : [];
  for (const r of arr) {
    const row = r as GhoRow;
    if (String(row.SpatialDimType ?? "").toUpperCase() !== "COUNTRY") continue;
    const iso3 = String(row.SpatialDim ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(iso3)) continue;
    const value = Number(row.NumericValue ?? row.Value);
    if (!Number.isFinite(value)) continue;
    const yr = Number(row.TimeDim);
    if (!Number.isFinite(yr)) continue;
    const rank = dimRank(row.Dim1 != null ? String(row.Dim1) : null);
    const prev = out.get(iso3);
    if (!prev || yr > prev.yr || (yr === prev.yr && rank < prev.rank)) {
      out.set(iso3, { value, year: String(yr), yr, rank });
    }
  }
  const final = new Map<string, { value: number; year: string }>();
  for (const [k, v] of out) final.set(k, { value: v.value, year: v.year });
  return final;
}

interface CountryDimRow { Code?: unknown; Title?: unknown }

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\b(the|of|republic|democratic|peoples?|islamic|kingdom|state|states)\b/g, "").trim();
}

// PURE: match a free-text country name to its ISO3 via the GHO COUNTRY dimension
// rows. Exported for unit tests.
export function matchCountryToCode(rows: unknown, country: string): string | null {
  const arr = Array.isArray((rows as { value?: unknown[] })?.value) ? (rows as { value: unknown[] }).value : Array.isArray(rows) ? (rows as unknown[]) : [];
  const want = norm(country);
  if (!want) return null;
  let exact: string | null = null, loose: string | null = null;
  for (const r of arr) {
    const row = r as CountryDimRow;
    const code = String(row.Code ?? "").trim().toUpperCase();
    const title = String(row.Title ?? "").trim();
    if (!/^[A-Z]{3}$/.test(code) || !title) continue;
    const n = norm(title);
    if (n === want) { exact = code; break; }
    if (!loose && (n.includes(want) || want.includes(n))) loose = code;
  }
  return exact ?? loose;
}

// ── Cached fetches ───────────────────────────────────────────────────────────

const indCache = new Map<string, { map: Map<string, { value: number; year: string }>; expires: number }>();
let dimCache: { rows: unknown; expires: number } | null = null;

async function ghoFetch(url: string): Promise<unknown | null> {
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store" }, 12_000);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function getIndicatorMap(code: string): Promise<Map<string, { value: number; year: string }>> {
  const hit = indCache.get(code);
  if (hit && hit.expires > Date.now()) return hit.map;
  const json = await ghoFetch(`${GHO_BASE}/${code}`);
  const map = json ? parseIndicatorRows(json) : new Map<string, { value: number; year: string }>();
  if (map.size > 0) indCache.set(code, { map, expires: Date.now() + TTL });
  return map;
}

async function resolveIso3(country: string): Promise<string | null> {
  if (!dimCache || dimCache.expires <= Date.now()) {
    const json = await ghoFetch(`${GHO_BASE}/DIMENSION/COUNTRY/DimensionValues`);
    if (json) dimCache = { rows: json, expires: Date.now() + TTL };
  }
  return dimCache ? matchCountryToCode(dimCache.rows, country) : null;
}

// Structural health indicators for one country. Returns null if the country
// can't be resolved to an ISO3 (e.g. GHO unreachable) so the card falls back to
// just the live outbreak feed.
export async function getHostNationHealth(country: string): Promise<HostNationHealth | null> {
  const iso3 = await resolveIso3(country);
  if (!iso3) return null;
  const maps = await Promise.all(INDICATORS.map((d) => getIndicatorMap(d.code).catch(() => new Map<string, { value: number; year: string }>())));
  const indicators: HealthIndicator[] = INDICATORS.map((d, i) => {
    const hit = maps[i].get(iso3);
    const value = hit ? hit.value : null;
    if (value == null) {
      return d.absentIsNone
        ? { key: d.key, label: d.label, value: null, display: d.fmt(0), year: "", posture: d.posture(null) }
        : { key: d.key, label: d.label, value: null, display: "—", year: "", posture: "unknown" };
    }
    return { key: d.key, label: d.label, value, display: d.fmt(value), year: hit!.year, posture: d.posture(value) };
  });
  return { iso3, indicators };
}

// Test/diagnostic hook.
export function resetWhoHealthCache(): void { indCache.clear(); dimCache = null; }
