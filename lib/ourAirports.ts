// Global airfield "search others" fill from OurAirports (open data, keyless).
// Complements the curated mobility set (lib/airfields.ts) for crises with no
// nearby gateway. Lazily fetched + cached 24h so it adds load time at most once
// per cache window, never on a normal view. Server-only.

const CSV_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const RUNWAYS_URL = "https://davidmegginson.github.io/ourairports-data/runways.csv";
const TTL = 24 * 60 * 60 * 1000;
const UA = "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)";

export interface OaAirfield { ident: string; name: string; lat: number; lon: number; country: string; type: string }

// Runway capability for a coarse "what can land here" judgement. Advisory only —
// longest open runway + surface, classed for mobility airframes. Thresholds are
// planning-grade (not assault minimums): C-17 wants ~7000ft hard; C-130 ~3500ft.
export type AirframeClass = "C-17" | "C-130" | "light";
export interface RunwayCap { lengthFt: number; surface: string; lighted: boolean; cls: AirframeClass }

let cache: { fields: OaAirfield[]; expires: number } | null = null;
let loading: Promise<OaAirfield[]> | null = null;
let rwCache: { map: Map<string, RunwayCap>; expires: number } | null = null;
let rwLoading: Promise<Map<string, RunwayCap>> | null = null;

const HARD_SURFACE = /asp|con|pem|bit|tar|paved|concrete|asphalt|grooved/i;

function classify(lengthFt: number, surface: string): AirframeClass {
  const hard = HARD_SURFACE.test(surface);
  if (lengthFt >= 7000 && hard) return "C-17";
  if (lengthFt >= 3500) return "C-130";
  return "light";
}

// CSV line splitter that respects double-quoted fields (OurAirports quotes names
// containing commas and escapes inner quotes by doubling them).
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Fetch + parse once; keep only C-17/C-130-class fields (large/medium airports).
// large_airport ≈ long hard runway (C-17 capable); medium ≈ C-130 capable.
async function load(): Promise<OaAirfield[]> {
  if (cache && cache.expires > Date.now()) return cache.fields;
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch(CSV_URL, { headers: { "User-Agent": UA, Accept: "text/csv,*/*" }, cache: "no-store" });
      if (!res.ok) return cache?.fields ?? [];
      const text = await res.text();
      const lines = text.split(/\r?\n/);
      if (lines.length < 2) return cache?.fields ?? [];
      const header = splitCsvLine(lines[0]);
      const iType = header.indexOf("type"), iName = header.indexOf("name"),
        iLat = header.indexOf("latitude_deg"), iLon = header.indexOf("longitude_deg"),
        iCountry = header.indexOf("iso_country"), iIdent = header.indexOf("ident");
      if (iType < 0 || iLat < 0 || iLon < 0) return cache?.fields ?? []; // shape changed
      const out: OaAirfield[] = [];
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        const c = splitCsvLine(lines[i]);
        const type = c[iType];
        if (type !== "large_airport" && type !== "medium_airport") continue;
        const lat = Number(c[iLat]), lon = Number(c[iLon]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        out.push({ ident: (c[iIdent] || "").slice(0, 8), name: (c[iName] || "").slice(0, 80), lat, lon, country: c[iCountry] || "", type });
      }
      if (out.length > 0) cache = { fields: out, expires: Date.now() + TTL };
      return cache?.fields ?? out;
    } catch {
      return cache?.fields ?? [];
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Fetch + parse runways.csv once (24h). Keep the longest OPEN runway per airport
// ident, with surface + lighting, classed for mobility airframes.
async function loadRunways(): Promise<Map<string, RunwayCap>> {
  if (rwCache && rwCache.expires > Date.now()) return rwCache.map;
  if (rwLoading) return rwLoading;
  rwLoading = (async () => {
    try {
      const res = await fetch(RUNWAYS_URL, { headers: { "User-Agent": UA, Accept: "text/csv,*/*" }, cache: "no-store" });
      if (!res.ok) return rwCache?.map ?? new Map();
      const text = await res.text();
      const lines = text.split(/\r?\n/);
      if (lines.length < 2) return rwCache?.map ?? new Map();
      const h = splitCsvLine(lines[0]);
      const iId = h.indexOf("airport_ident"), iLen = h.indexOf("length_ft"),
        iSurf = h.indexOf("surface"), iLit = h.indexOf("lighted"), iClosed = h.indexOf("closed");
      if (iId < 0 || iLen < 0) return rwCache?.map ?? new Map();
      const map = new Map<string, RunwayCap>();
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        const c = splitCsvLine(lines[i]);
        if (iClosed >= 0 && c[iClosed] === "1") continue;
        const ident = c[iId];
        const len = Number(c[iLen]);
        if (!ident || !Number.isFinite(len) || len <= 0) continue;
        const prev = map.get(ident);
        if (prev && prev.lengthFt >= len) continue;
        const surface = (c[iSurf] || "").slice(0, 24);
        map.set(ident, { lengthFt: Math.round(len), surface, lighted: iLit >= 0 && c[iLit] === "1", cls: classify(len, surface) });
      }
      if (map.size > 0) rwCache = { map, expires: Date.now() + TTL };
      return rwCache?.map ?? map;
    } catch {
      return rwCache?.map ?? new Map();
    } finally {
      rwLoading = null;
    }
  })();
  return rwLoading;
}

// Runway capability for specific idents (ICAO). Used for the curated gateway set
// and on-demand lookups. Missing idents are simply absent from the result.
export async function airfieldCapabilities(idents: string[]): Promise<Record<string, RunwayCap>> {
  const map = await loadRunways().catch(() => new Map<string, RunwayCap>());
  const out: Record<string, RunwayCap> = {};
  for (const id of idents) { const cap = map.get(id); if (cap) out[id] = cap; }
  return out;
}

// One-line capability tag for a hint string, e.g. "13123ft asp · C-17".
export function capTag(cap: RunwayCap | undefined): string {
  if (!cap) return "";
  return `${cap.lengthFt}ft${cap.surface ? ` ${cap.surface.slice(0, 4).toLowerCase()}` : ""} · ${cap.cls}`;
}

export async function nearestOurAirports(lat: number, lon: number, n = 2, maxKm = 1500): Promise<(OaAirfield & { km: number; cap?: RunwayCap })[]> {
  const fields = await load();
  const near = fields
    .map((a) => ({ ...a, km: Math.round(haversineKm(lat, lon, a.lat, a.lon)) }))
    .filter((a) => a.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
  const caps = await airfieldCapabilities(near.map((a) => a.ident));
  return near.map((a) => ({ ...a, ...(caps[a.ident] ? { cap: caps[a.ident] } : {}) }));
}

// For the crisis-diag: how many fields loaded + a sample, so a blank fill shows
// whether OurAirports is reachable / parsed.
export async function diagnoseOurAirports(): Promise<{ count: number; sample?: string; note: string }> {
  const fields = await load();
  const f = fields[0];
  return {
    count: fields.length,
    sample: f ? `${f.ident} ${f.name} (${f.country})` : undefined,
    note: fields.length > 0
      ? `OurAirports loaded ${fields.length} C-17/C-130-class fields.`
      : "OurAirports returned no fields — unreachable from the host, or the CSV shape changed (check davidmegginson.github.io/ourairports-data).",
  };
}
