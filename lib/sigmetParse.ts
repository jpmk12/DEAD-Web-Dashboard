// SIGMETs for the Crisis map — PURE, client-safe, tested in
// tests/sigmetParse.test.ts.
//
// Source: the NWS Aviation Weather Center data API (keyless, the host the
// METAR / TAF reads already use) — `/api/data/isigmet` (international
// SIGMETs: every FIR worldwide that issues one, the oceanic U.S. FIRs
// included) and `/api/data/airsigmet` (domestic U.S. SIGMETs; AIRMETs are
// dropped — they are advisory, not hazard areas). The contract is pinned from
// the published API reference and UNVERIFIED from the sandbox (the host is
// blocked here); the reader is tolerant on purpose — field names in both
// spellings, times as epoch seconds / ms / ISO, coordinates as {lat, lon}
// objects or [lon, lat] pairs or a GeoJSON geometry — and the route's diag
// carries the first raw row so a renamed field is one paste away.
//
// Disciplines: an area with no readable geometry is NOT drawn (never a guessed
// box) but is counted; a SIGMET past its valid-to is dropped; the hazard class
// sets the colour (volcanic ash, tropical cyclone and radioactive cloud are
// red — they close airspace; convection, severe turbulence and severe icing
// amber; the rest slate).

export type SigmetHazard = "volcanic ash" | "tropical cyclone" | "radioactive" | "convection" | "turbulence" | "icing" | "mountain wave" | "dust / sand" | "other";
export type SigmetTone = "red" | "amber" | "slate";

export interface Sigmet {
  id: string;
  kind: "international" | "domestic";
  hazard: SigmetHazard;
  /** The issuing FIR / office as given ("KZWY NEW YORK OCEANIC", "RJJJ"). */
  fir: string | null;
  series: string | null;
  qualifier: string | null;
  /** Feet; null when not stated. */
  baseFt: number | null;
  topFt: number | null;
  fromISO: string | null;
  toISO: string | null;
  /** Lat/lon points as drawn: ≥3 a polygon, 2 a line, 1 a point. */
  points: [number, number][];
  /** Where the drawn area came from: the row's coordinates, or the ICAO
   *  position list in the SIGMET text (when the row carried only a point). */
  areaFrom: "coords" | "text" | null;
  movement: string | null;
  raw: string;
  tone: SigmetTone;
}

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const n = (v: unknown): number | null => {
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(x) ? x : null;
};

function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] != null && o[k] !== "") return o[k];
  const lower = new Map(Object.keys(o).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) { const real = lower.get(k.toLowerCase()); if (real && o[real] != null && o[real] !== "") return o[real]; }
  return undefined;
}

/** Epoch seconds, epoch ms or an ISO / RFC stamp → ISO; null otherwise. */
export function sigmetTime(v: unknown): string | null {
  const x = n(v);
  if (x != null) {
    const ms = x > 1e12 ? x : x > 1e9 ? x * 1000 : NaN;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const t = s(v);
  if (!t) return null;
  const zoneless = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(t);
  const ms = Date.parse(zoneless ? `${t.replace(" ", "T")}Z` : t);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function sigmetHazard(hazard: string | null, raw: string): SigmetHazard {
  const h = `${hazard ?? ""} ${raw}`.toUpperCase();
  const code = (hazard ?? "").toUpperCase().trim();
  if (code === "VA" || /\bVA\s+(ERUPTION|CLD)|\bVOLCANIC ASH\b/.test(h)) return "volcanic ash";
  if (code === "TC" || /\bTC\s+[A-Z]+\s+(OBS|FCST)|\bTROPICAL CYCLONE\b|\bTYPHOON\b|\bHURRICANE\b/.test(h)) return "tropical cyclone";
  if (code === "RDOACT" || /\bRDOACT\b|\bRADIOACTIVE\b/.test(h)) return "radioactive";
  if (["TS", "TSGR", "CONVECTIVE", "CB"].includes(code) || /\b(EMBD|OBSC|FRQ|SQL)\s+TS\b|\bCONVECTIVE\b/.test(h)) return "convection";
  if (code.includes("TURB") || /\bSEV\s+TURB\b/.test(h)) return "turbulence";
  if (code.includes("ICE") || code.includes("ICING") || /\bSEV\s+ICE\b/.test(h)) return "icing";
  if (code === "MTW" || /\bSEV\s+MTW\b|\bMOUNTAIN WAVE\b/.test(h)) return "mountain wave";
  if (code === "DS" || code === "SS" || /\bHVY\s+(DS|SS)\b/.test(h)) return "dust / sand";
  return "other";
}

export function sigmetTone(h: SigmetHazard): SigmetTone {
  if (h === "volcanic ash" || h === "tropical cyclone" || h === "radioactive") return "red";
  if (h === "convection" || h === "turbulence" || h === "icing") return "amber";
  return "slate";
}

function pointsOf(o: Record<string, unknown>): [number, number][] {
  const raw = pick(o, "coords", "coordinates", "points");
  const out: [number, number][] = [];
  const push = (lat: number | null, lon: number | null) => {
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    out.push([lat, lon]);
  };
  if (Array.isArray(raw)) {
    for (const p of raw) {
      if (Array.isArray(p) && p.length >= 2) push(n(p[1]), n(p[0]));           // [lon, lat]
      else if (p && typeof p === "object") { const q = p as Record<string, unknown>; push(n(pick(q, "lat", "latitude")), n(pick(q, "lon", "lng", "longitude"))); }
    }
  } else if (typeof raw === "string") {
    // "lat,lon lat,lon …" or "lat lon, lat lon …"
    for (const m of raw.matchAll(/(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)/g)) push(n(m[1]), n(m[2]));
  }
  // A closing point equal to the first is dropped (Leaflet closes polygons).
  if (out.length > 3 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

// ICAO SIGMET positions: N1435 W09102 / S0530E11930 / N14 W091.
const ICAO_POS = /([NS])(\d{2})(\d{2})?\s?([EW])(\d{3})(\d{2})?/g;

/** The first ICAO position list of ≥3 points in the SIGMET text — the
 *  observed area ("… OBS AT 1200Z SFC/FL150 N1435 W09102 - N1428 W09052 -
 *  …"). Positions must be joined by dashes to belong to one list, so a lone
 *  "PSN N1428 W09052" never starts a ring. The forecast area that follows is
 *  a second list and is not taken. */
export function textPolygon(raw: string): [number, number][] {
  const up = raw.toUpperCase();
  const hits: { at: [number, number]; start: number; end: number }[] = [];
  for (const m of up.matchAll(ICAO_POS)) {
    const lat = (Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0)) * (m[1] === "S" ? -1 : 1);
    const lon = (Number(m[5]) + (m[6] ? Number(m[6]) / 60 : 0)) * (m[4] === "W" ? -1 : 1);
    if ((m[3] && Number(m[3]) >= 60) || (m[6] && Number(m[6]) >= 60) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const start = m.index ?? 0;
    hits.push({ at: [Math.round(lat * 1000) / 1000, Math.round(lon * 1000) / 1000], start, end: start + m[0].length });
  }
  let run: [number, number][] = [];
  for (let i = 0; i < hits.length; i++) {
    const joined = i > 0 && /^\s*-\s*$/.test(up.slice(hits[i - 1].end, hits[i].start));
    if (joined) run.push(hits[i].at);
    else {
      if (run.length >= 3) break;
      run = [hits[i].at];
    }
  }
  if (run.length < 3) return [];
  if (run.length > 3 && run[0][0] === run[run.length - 1][0] && run[0][1] === run[run.length - 1][1]) run.pop();
  return run;
}

function geojsonPoints(geom: unknown): [number, number][] {
  const g = geom as { type?: string; coordinates?: unknown } | null;
  if (!g || !g.coordinates) return [];
  const ring: unknown = g.type === "Polygon" ? (g.coordinates as unknown[])[0]
    : g.type === "MultiPolygon" ? ((g.coordinates as unknown[][])[0] ?? [])[0]
    : g.type === "LineString" ? g.coordinates
    : g.type === "Point" ? [g.coordinates]
    : null;
  return pointsOf({ coords: ring as unknown[] });
}

function feet(v: unknown): number | null {
  const x = n(v);
  if (x == null) {
    const t = s(v);
    const fl = t?.match(/^FL\s*(\d{2,3})$/i);
    return fl ? Number(fl[1]) * 100 : null;
  }
  return x < 1000 ? x * 100 : x; // a bare 350 is a flight level
}

/** One raw row (either endpoint, JSON or a GeoJSON feature) → a Sigmet, or
 *  null for an AIRMET / an expired row. Rows with no geometry come back with
 *  `points: []` — the caller counts them and draws nothing. */
export function parseSigmetRow(row: unknown, kind: Sigmet["kind"], nowMs: number): Sigmet | null {
  if (!row || typeof row !== "object") return null;
  const feat = row as { type?: string; properties?: Record<string, unknown>; geometry?: unknown };
  const o: Record<string, unknown> = feat.type === "Feature" && feat.properties ? feat.properties : (row as Record<string, unknown>);
  const type = (s(pick(o, "airSigmetType", "type")) ?? "").toUpperCase();
  if (type.includes("AIRMET")) return null;
  const raw = s(pick(o, "rawSigmet", "rawAirSigmet", "rawText", "raw")) ?? "";
  const hazardCode = s(pick(o, "hazard"));
  const hazard = sigmetHazard(hazardCode, raw);
  const fromISO = sigmetTime(pick(o, "validTimeFrom", "validFrom", "issueTime", "receiptTime"));
  const toISO = sigmetTime(pick(o, "validTimeTo", "validTo"));
  if (toISO && Date.parse(toISO) <= nowMs) return null;
  let points = feat.type === "Feature" && feat.geometry ? geojsonPoints(feat.geometry) : pointsOf(o);
  let areaFrom: Sigmet["areaFrom"] = points.length ? "coords" : null;
  if (points.length < 3 && raw) {
    const t = textPolygon(raw);
    if (t.length >= 3) { points = t; areaFrom = "text"; }
  }
  const fir = s(pick(o, "firName", "firId", "icaoId", "fir"));
  const series = s(pick(o, "seriesId", "series"));
  const id = [kind === "international" ? "is" : "ds", fir ?? "", series ?? "", fromISO ?? "", hazardCode ?? ""].join("|");
  const dir = s(pick(o, "dir", "movementDir")), spd = n(pick(o, "spd", "movementSpd"));
  return {
    id, kind, hazard, fir, series,
    // A numeric severity (the domestic feed's 1–5) is not a qualifier word.
    qualifier: ((q) => (q && !/^\d+$/.test(q) ? q : null))(s(pick(o, "qualifier", "severity"))),
    baseFt: feet(pick(o, "base", "altitudeLow1", "altLow")),
    topFt: feet(pick(o, "top", "altitudeHi1", "altHi")),
    fromISO, toISO, points, areaFrom,
    movement: dir ? `${/^\d{1,3}$/.test(dir) ? `${dir}°` : dir}${spd != null ? ` ${spd} kt` : ""}` : null,
    raw: raw.slice(0, 1200),
    tone: sigmetTone(hazard),
  };
}

/** The response body → rows (a bare array, a GeoJSON FeatureCollection, or
 *  the first array under a known key). */
export function sigmetRows(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (Array.isArray(o.features)) return o.features;
    for (const k of ["data", "sigmets", "isigmet", "airsigmet", "items", "results"]) if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return [];
}

export interface SigmetParse { sigmets: Sigmet[]; rows: number; noGeometry: number; airmets: number; expired: number }

export function parseSigmets(body: unknown, kind: Sigmet["kind"], nowMs: number): SigmetParse {
  const rows = sigmetRows(body);
  const out: Sigmet[] = [];
  let noGeometry = 0, airmets = 0, expired = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    const o = (r && typeof r === "object" && (r as { properties?: object }).properties) || r;
    const type = String((o as Record<string, unknown> | null)?.airSigmetType ?? "").toUpperCase();
    if (type.includes("AIRMET")) { airmets++; continue; }
    const p = parseSigmetRow(r, kind, nowMs);
    if (!p) { expired++; continue; }
    if (!p.points.length) noGeometry++;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return { sigmets: out, rows: rows.length, noGeometry, airmets, expired };
}

const ft = (f: number | null) => (f == null ? "?" : f >= 18000 ? `FL${Math.round(f / 100)}` : f === 0 ? "SFC" : `${f.toLocaleString("en-US")} ft`);

/** One line for a popup / list. */
export function sigmetLine(x: Sigmet): string {
  const lv = x.baseFt != null || x.topFt != null ? `${ft(x.baseFt)}–${ft(x.topFt)}` : "levels not stated";
  return `${x.hazard.toUpperCase()}${x.qualifier ? ` (${x.qualifier})` : ""} · ${lv}${x.movement ? ` · moving ${x.movement}` : ""}`;
}
