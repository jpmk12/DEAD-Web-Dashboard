// GPS / WAAS NOTAMs at ONE field — PURE, dependency-free beyond geoMath,
// client-safe, tested in tests/gpsNotams.test.ts.
//
// DAIP's GPS_WAAS query is "system-level": one list for everyone. Read as a
// list it says nothing about a field. But most of its rows are FAA GPS-test
// NOTAMs that carry their own geometry — a centre and a radius at each
// altitude ("WI A 517NM RADIUS CENTERED AT 332710N1074618W FL400-UNL, 468NM
// RADIUS AT FL250, 392NM RADIUS AT 10000FT, 375NM RADIUS AT 4000FT AGL, 353NM
// RADIUS AT 50FT AGL. DLY 0700-1100") — or a polygon ("AREA DEFINED AS
// 160038N0680019W TO … AND BACK TO …"). So the field's question is answered
// by geometry, not by text: is the field inside a ring, and at which levels?
//
// Disciplines:
//   • A ring that covers the field at 4,000 ft AGL or below is APPROACH-level
//     (GPS approaches at the field affected) — amber while in effect.
//     Covered only higher up is ENROUTE — named, never amber.
//   • In effect = inside the validity AND inside the daily window when the
//     NOTAM gives one ("DLY 0700-1100"). The feed's own B)/C) fields are
//     absent on FAA domestic GPS NOTAMs; their validity is the
//     "YYMMDDHHMM-YYMMDDHHMM" pair at the end of the raw text.
//   • A NOTAM with NO geometry is matched only by its location code (the
//     FIR / ARTCC it was published under) — a FIR-wide GNSS warning.
//   • Satellite outages (PRN n U/S, NANUs) are constellation-wide: one line,
//     never amber — RAIM prediction governs.
//   • The feed being down is the CALLER's UNKNOWN; this module only reads
//     what it is given.

import { haversineKm } from "./geoMath";

export interface GpsNotamIn {
  id: string;
  /** Location code the NOTAM was published under (ARTCC / FIR / station). */
  loc?: string;
  /** DAIP group (e.g. "GPS NOTAMs", "WAAS NOTAMs"). */
  group?: string;
  text: string;
  rawtext: string;
}

export interface LatLon { lat: number; lon: number }
export interface GpsRing { nm: number; level: string; floorFt: number | null }
export interface GpsDisk extends LatLon { rings: GpsRing[] }

const POS = String.raw`(\d{2})(\d{2})(\d{2}(?:\.\d+)?)([NS])\s*(\d{3})(\d{2})(\d{2}(?:\.\d+)?)([EW])`;
const POS_RX = new RegExp(POS);

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** DDMMSS[.ss][NS]DDDMMSS[.ss][EW] → decimal degrees, or null. */
export function parseGpsPosition(s: string): LatLon | null {
  const m = s.match(POS_RX);
  if (!m) return null;
  const lat = (Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600) * (m[4] === "S" ? -1 : 1);
  const lon = (Number(m[5]) + Number(m[6]) / 60 + Number(m[7]) / 3600) * (m[8] === "W" ? -1 : 1);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (Number(m[2]) > 59 || Number(m[6]) > 59) return null;
  return { lat, lon };
}

/** Lower bound of a NOTAM level string in feet ("SFC-10000FT AGL" → 0,
 *  "FL400-UNL" → 40000, "4000FT AGL" → 4000); null when unreadable. */
export function levelFloorFt(level: string): number | null {
  const s = level.toUpperCase().trim();
  if (/^(SFC|GND)\b/.test(s)) return 0;
  let m = s.match(/^FL\s*(\d{2,3})/);
  if (m) return Number(m[1]) * 100;
  m = s.match(/^(\d{1,5})\s*FT/);
  if (m) return Number(m[1]);
  return null;
}

/** The test disk: centre + one ring per altitude, as printed. */
export function parseGpsDisk(text: string): GpsDisk | null {
  const t = norm(text).toUpperCase();
  const head = new RegExp(String.raw`(\d+(?:\.\d+)?)\s*NM\s+RADIUS\s+CENTERED\s+AT\s+(${POS})\s*(?:\([^)]*\))?\s*([^,.]*)`).exec(t);
  if (!head) return null;
  const centre = parseGpsPosition(head[2]);
  if (!centre) return null;
  const firstLevel = (head[11] ?? "").trim();
  const rings: GpsRing[] = [{ nm: Number(head[1]), level: firstLevel, floorFt: firstLevel ? levelFloorFt(firstLevel) : null }];
  const rest = t.slice(head.index + head[0].length);
  const rx = /^\s*,\s*(\d+(?:\.\d+)?)\s*NM\s+RADIUS\s+AT\s+([^,.]+)/;
  let tail = rest;
  for (let i = 0; i < 12; i++) {
    const m = rx.exec(tail);
    if (!m) break;
    const level = m[2].trim();
    rings.push({ nm: Number(m[1]), level, floorFt: levelFloorFt(level) });
    tail = tail.slice(m[0].length);
  }
  return { ...centre, rings: rings.filter((r) => Number.isFinite(r.nm) && r.nm > 0) };
}

/** "AREA DEFINED AS p TO p TO … AND BACK TO p" → the polygon (≥3 points). */
export function parseGpsPolygon(text: string): LatLon[] | null {
  const t = norm(text).toUpperCase();
  const at = t.indexOf("DEFINED AS");
  if (at < 0) return null;
  let rest = t.slice(at + "DEFINED AS".length);
  const step = new RegExp(String.raw`^\s*(?:AND\s+BACK\s+TO|TO|-|,)?\s*(${POS})`);
  const pts: LatLon[] = [];
  for (let i = 0; i < 40; i++) {
    const m = step.exec(rest);
    if (!m) break;
    const p = parseGpsPosition(m[1]);
    if (!p) break;
    pts.push(p);
    rest = rest.slice(m[0].length);
  }
  return pts.length >= 3 ? pts : null;
}

/** Ray-casting point-in-polygon on lat/lon (fine for NOTAM-sized areas). */
export function insidePolygon(p: LatLon, poly: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

function decode10(s: string): string | undefined {
  const yy = Number(s.slice(0, 2)), mo = Number(s.slice(2, 4)), da = Number(s.slice(4, 6)), hh = Number(s.slice(6, 8)), mi = Number(s.slice(8, 10));
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || hh > 23 || mi > 59) return undefined;
  return new Date(Date.UTC(2000 + yy, mo - 1, da, hh, mi)).toISOString();
}

/** Validity of a NOTAM: ICAO B)/C) when present, else the FAA domestic
 *  "YYMMDDHHMM-YYMMDDHHMM" (or "-PERM") pair. end undefined = PERM / none. */
export function parseGpsValidity(raw: string): { start?: string; end?: string } {
  const b = raw.match(/\bB\)\s*(\d{10})\b/);
  const c = raw.match(/\bC\)\s*(\d{10})\b/);
  if (b) return { start: decode10(b[1]), end: c ? decode10(c[1]) : undefined };
  const pair = raw.match(/\b(\d{10})\s*-\s*(\d{10}|PERM)\b/);
  if (!pair) return {};
  return { start: decode10(pair[1]), end: pair[2] === "PERM" ? undefined : decode10(pair[2]) };
}

/** "DLY 0700-1100" / "DAILY 2100-0400" → minutes from midnight Z. */
export function parseDailyWindow(text: string): { from: number; to: number; label: string } | null {
  const m = norm(text).toUpperCase().match(/\b(?:DLY|DAILY)\s+([0-2]\d)([0-5]\d)\s*-\s*([0-2]\d)([0-5]\d)\b/);
  if (!m) return null;
  const from = Number(m[1]) * 60 + Number(m[2]), to = Number(m[3]) * 60 + Number(m[4]);
  if (from > 24 * 60 || to > 24 * 60) return null;
  return { from, to, label: `daily ${m[1]}${m[2]}–${m[3]}${m[4]}Z` };
}

function inDaily(w: { from: number; to: number }, nowMs: number): boolean {
  const d = new Date(nowMs);
  const min = d.getUTCHours() * 60 + d.getUTCMinutes();
  return w.from <= w.to ? min >= w.from && min < w.to : min >= w.from || min < w.to;
}

export type GpsTiming = "now" | "later" | "expired";

export function gpsTiming(n: GpsNotamIn, nowMs: number): GpsTiming {
  const v = parseGpsValidity(n.rawtext || n.text);
  const s = v.start ? Date.parse(v.start) : NaN, e = v.end ? Date.parse(v.end) : NaN;
  if (Number.isFinite(e) && nowMs >= e) return "expired";
  if (Number.isFinite(s) && nowMs < s) return "later";
  const daily = parseDailyWindow(n.text) ?? parseDailyWindow(n.rawtext);
  if (daily && !inDaily(daily, nowMs)) return "later";
  return "now";
}

const PRN_RX = /\bPRN\s*:?\s*(\d{1,2})\b/g;
const PRN_ONE = /\bPRN\s*:?\s*\d{1,2}\b/;
const OUTAGE_RX = /\b(U\/S|UNUSABLE|OUTAGE|UNHEALTHY)\b/;

/** Satellites the GPS list says are out (constellation-wide, not the field's). */
export function prnOutages(notams: GpsNotamIn[], nowMs: number): number[] {
  const out = new Set<number>();
  for (const n of notams) {
    const t = norm(`${n.text} ${n.rawtext}`).toUpperCase();
    if (!OUTAGE_RX.test(t)) continue;
    if (parseGpsDisk(t) || parseGpsPolygon(t)) continue;
    if (gpsTiming(n, nowMs) === "expired") continue;
    for (const m of t.matchAll(PRN_RX)) {
      const v = Number(m[1]);
      if (v >= 1 && v <= 32) out.add(v);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export type GpsScope = "approach" | "enroute" | "area" | "fir";

export interface FieldGpsNotam {
  id: string;
  /** Test designator when printed, e.g. "EPG_AZ GPS 26-07". */
  test: string | null;
  scope: GpsScope;
  /** Distance from the disk centre (NM), null for area / FIR matches. */
  distNm: number | null;
  /** Lowest level at which the field is covered (feet), null when unknown. */
  floorFt: number | null;
  levelLabel: string | null;
  /** The ring that covers the field at that level (NM). */
  ringNm: number | null;
  timing: GpsTiming;
  window: string | null;
  until: string | null;
  jamming: boolean;
  /** Amber: in effect now AND approach-level / FIR-wide / an area to the surface. */
  amber: boolean;
  text: string;
}

export interface FieldGpsRead {
  items: FieldGpsNotam[];
  /** Constellation-wide satellite outages (PRN numbers). */
  prns: number[];
  /** Items that are amber (in effect at approach level, FIR-wide or area to the surface). */
  affecting: number;
}

export interface GpsField extends LatLon {
  icao: string;
  /** Location codes the field sits under: ARTCC (ZNY / KZNY), FIRs, the ICAO. */
  codes: string[];
}

export const APPROACH_FLOOR_FT = 4000;
export const GPS_FIELD_MAX_ITEMS = 6;
const JAM_RX = /\b(JAMMING|SPOOFING|INTERFERENCE)\b/;
const SCOPE_RANK: Record<GpsScope, number> = { approach: 0, fir: 1, area: 2, enroute: 3 };
const TIMING_RANK: Record<GpsTiming, number> = { now: 0, later: 1, expired: 2 };

/** The field's GPS / WAAS NOTAMs from the system list. */
export function gpsNotamsForField(notams: GpsNotamIn[], field: GpsField, nowMs: number): FieldGpsRead {
  const codes = new Set(field.codes.map((c) => c.trim().toUpperCase()).filter(Boolean));
  codes.add(field.icao.toUpperCase());
  // One row per NOTAM id; a NOTAM republished under several ARTCCs keeps every loc.
  const byId = new Map<string, { n: GpsNotamIn; locs: Set<string> }>();
  for (const n of notams) {
    const key = norm(n.id || n.rawtext.slice(0, 60));
    const hit = byId.get(key);
    if (hit) { if (n.loc) hit.locs.add(n.loc.toUpperCase()); continue; }
    byId.set(key, { n, locs: new Set(n.loc ? [n.loc.toUpperCase()] : []) });
  }

  const items: FieldGpsNotam[] = [];
  for (const { n, locs } of byId.values()) {
    const timing = gpsTiming(n, nowMs);
    if (timing === "expired") continue;
    const body = norm(`${n.text} ${n.rawtext}`).toUpperCase();
    const daily = parseDailyWindow(n.text) ?? parseDailyWindow(n.rawtext);
    const v = parseGpsValidity(n.rawtext || n.text);
    const test = (body.match(/\(([A-Z0-9_]+ GPS \d{2}-\d{2})\)/) ?? [])[1] ?? null;
    const jamming = JAM_RX.test(body);
    const base = {
      id: norm(n.id), test, timing, window: daily?.label ?? null, until: v.end ?? null, jamming,
      text: norm(n.text).slice(0, 220),
    };

    const disk = parseGpsDisk(n.text) ?? parseGpsDisk(n.rawtext);
    if (disk) {
      const distNm = haversineKm(field.lat, field.lon, disk.lat, disk.lon) / 1.852;
      const covering = disk.rings.filter((r) => distNm <= r.nm);
      if (!covering.length) continue;
      const known = covering.filter((r) => r.floorFt != null);
      const low = known.length ? known.reduce((a, b) => (b.floorFt! < a.floorFt! ? b : a)) : covering[0];
      const approach = low.floorFt != null && low.floorFt <= APPROACH_FLOOR_FT;
      items.push({
        ...base, scope: approach ? "approach" : "enroute", distNm: Math.round(distNm),
        floorFt: low.floorFt, levelLabel: low.level || null, ringNm: low.nm,
        amber: timing === "now" && approach,
      });
      continue;
    }

    const poly = parseGpsPolygon(n.text) ?? parseGpsPolygon(n.rawtext);
    if (poly) {
      if (!insidePolygon(field, poly)) continue;
      const above = body.match(/\bABOVE\s+FL\s*(\d{2,3})\b/);
      const floorFt = above ? Number(above[1]) * 100 : null;
      items.push({
        ...base, scope: "area", distNm: null, floorFt, levelLabel: above ? `above FL${above[1]}` : null, ringNm: null,
        amber: timing === "now" && floorFt != null && floorFt <= APPROACH_FLOOR_FT,
      });
      continue;
    }

    // No geometry: a FIR / ARTCC-wide notice, matched by where it was published.
    if ([...locs].some((l) => codes.has(l)) || body.includes(` ${field.icao.toUpperCase()} `)) {
      if (!/\b(GPS|GNSS|WAAS|RNAV|RAIM)\b/.test(body)) continue;
      // A satellite outage republished under a station is constellation-wide.
      if (OUTAGE_RX.test(body) && PRN_ONE.test(body)) continue;
      items.push({ ...base, scope: "fir", distNm: null, floorFt: null, levelLabel: null, ringNm: null, amber: timing === "now" });
    }
  }

  items.sort((a, b) => Number(b.amber) - Number(a.amber) || TIMING_RANK[a.timing] - TIMING_RANK[b.timing]
    || SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope] || (a.distNm ?? 0) - (b.distNm ?? 0));
  return {
    items: items.slice(0, GPS_FIELD_MAX_ITEMS),
    prns: prnOutages(notams, nowMs),
    affecting: items.filter((i) => i.amber).length,
  };
}

const ft = (f: number | null) => (f == null ? "?" : f >= 18000 ? `FL${Math.round(f / 100)}` : f === 0 ? "the surface" : `${f.toLocaleString("en-US")} ft`);
const hhmmZ = (iso: string) => { const d = new Date(iso); return `${String(d.getUTCDate()).padStart(2, "0")} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`; };

/** One sentence per item — the SITREP row, the export row, the read's line. */
export function fieldGpsLine(i: FieldGpsNotam): string {
  const what = i.test ? `GPS test ${i.test}` : i.jamming ? "GPS jamming / interference" : "GPS notice";
  const where =
    i.scope === "approach" ? `field ${i.distNm} NM from centre — inside the ${i.ringNm} NM ring down to ${ft(i.floorFt)}${i.floorFt != null && i.floorFt <= 50 ? "" : " AGL"} (GPS approaches affected)`
    : i.scope === "enroute" ? `field ${i.distNm} NM from centre — covered at ${ft(i.floorFt)} and above only (enroute, not the approach)`
    : i.scope === "area" ? `field inside the published area${i.levelLabel ? `, ${i.levelLabel}` : ""}`
    : "published for the field's FIR / centre — no geometry given";
  const when = [
    i.timing === "now" ? "in effect now" : "not in effect now",
    i.window,
    i.until ? `until ${hhmmZ(i.until)}` : null,
  ].filter(Boolean).join(" · ");
  return `${i.id} ${what}: ${where} · ${when}`;
}

/** The constellation line: never amber, RAIM prediction governs. */
export function prnLine(prns: number[]): string | null {
  if (!prns.length) return null;
  return `${prns.length} GPS satellite${prns.length === 1 ? "" : "s"} out of service (PRN ${prns.join(", ")}) — constellation-wide; RAIM prediction governs approach availability`;
}

/** DAIP FUEL_NOTAMS rows for one field: the wrapper / group the row sat under
 *  IS the field, or the raw text names its ICAO as a word (the old
 *  substring test matched "KADW" inside "KADWX"). Newest-significance order
 *  is the feed's. */
export function fuelNotamsForField(notams: { text: string; rawtext?: string; loc?: string; group?: string }[], icao: string): string[] {
  const id = icao.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,4}$/.test(id)) return [];
  const word = new RegExp(`(^|[^A-Z0-9])${id}([^A-Z0-9]|$)`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of notams) {
    const hit = n.loc?.toUpperCase() === id || n.group?.toUpperCase() === id || word.test(`${n.text} ${n.rawtext ?? ""}`.toUpperCase());
    if (!hit) continue;
    const t = norm(n.text).slice(0, 200);
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
