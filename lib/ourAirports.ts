// Global airfield "search others" fill from OurAirports (open data, keyless).
// Complements the curated mobility set (lib/airfields.ts) for crises with no
// nearby gateway. Lazily fetched + cached 24h so it adds load time at most once
// per cache window, never on a normal view. Server-only.

const CSV_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const TTL = 24 * 60 * 60 * 1000;
const UA = "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)";

export interface OaAirfield { ident: string; name: string; lat: number; lon: number; country: string; type: string }

let cache: { fields: OaAirfield[]; expires: number } | null = null;
let loading: Promise<OaAirfield[]> | null = null;

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

export async function nearestOurAirports(lat: number, lon: number, n = 2, maxKm = 1500): Promise<(OaAirfield & { km: number })[]> {
  const fields = await load();
  return fields
    .map((a) => ({ ...a, km: Math.round(haversineKm(lat, lon, a.lat, a.lon)) }))
    .filter((a) => a.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
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
