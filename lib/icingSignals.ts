// ICING at an airfield and on its approach — PURE, client-safe, no I/O;
// tested in tests/icingSignals.test.ts.
//
// Five inputs, each read for what it can honestly say:
//
//   1. METAR (observed, at the field): freezing rain / drizzle (FZRA, FZDZ),
//      freezing fog, ice pellets; and the cloud deck's estimated temperature
//      — a BKN / OVC base whose temperature, from the surface temperature
//      and the standard lapse rate (≈2 °C per 1,000 ft), falls between 0 and
//      −20 °C is cloud an aircraft descends through on approach.
//   2. TAF (forecast, at the field): freezing / frozen precipitation codes in
//      a period, with its window. A TAF carries no temperatures, so a TAF
//      without FZ codes says nothing about icing aloft.
//   3. Model profile (Open-Meteo pressure levels at the field, hourly):
//      a level whose temperature is 0 to −20 °C and whose relative humidity
//      is high is a CONDUCIVE layer; inside the approach band (field
//      elevation to APPROACH_TOP_AGL_FT above it) it is icing on approach.
//      Model freezing-precipitation weather codes (56/57/66/67) at the
//      surface. Planning-grade — not CIP/FIP, said on every surface.
//   4. SIGMETs (AWC international + domestic, already parsed): a SIGMET
//      icing is SEVERE icing by definition; one covering the field or within
//      APPROACH_RADIUS_NM of it, in the approach band, is the strongest
//      forecast there is.
//   5. PIREPs (AWC): what aircraft actually reported near the field in the
//      last hours, by intensity and altitude. Sparse outside the U.S.: no
//      PIREP is never "no icing".
//
// Colour is earned and conservative: RED only for icing OBSERVED or
// officially warned — freezing rain / drizzle in the METAR, a SIGMET icing
// in effect over the approach, a SEVERE PIREP. AMBER for the rest of the
// evidence (moderate PIREP, freezing fog, a cloud deck at icing temperatures,
// TAF freezing precipitation, a model layer LIKELY to ice within 12 h, a
// SIGMET starting soon). A model layer that is only POSSIBLE stays a note.
// UNKNOWN when neither the METAR nor the model answered — never green.

import { haversineKm } from "./geoMath";
import type { MetarObs, TafPeriod } from "./types";
import type { Sigmet } from "./sigmetParse";
import { parseTafHazards, icingGroupLabel, type TafIcingGroup } from "./tafGroups";

export const APPROACH_TOP_AGL_FT = 10_000;
export const APPROACH_RADIUS_NM = 30;
export const PIREP_RADIUS_NM = 60;
export const PIREP_MAX_AGE_H = 3;
/** Model layer windows inside this many hours can earn amber; later ones are notes. */
export const MODEL_AMBER_HOURS = 12;
export const ICE_T_MAX_C = 0;
export const ICE_T_MIN_C = -20;
/** "Likely": saturated (RH ≥ 95 %) between 0 and −15 °C. */
export const LIKELY_RH = 95;
export const LIKELY_T_MIN_C = -15;
/** "Possible": moist (RH ≥ 85 %) between 0 and −20 °C. */
export const POSSIBLE_RH = 85;
/** Standard lapse rate, °C per 1,000 ft. */
export const LAPSE_C_PER_KFT = 1.98;

const M_TO_FT = 3.28084;
const KM_PER_NM = 1.852;

export type IcingTone = "r" | "a" | "i";
export type IcingLed = "g" | "a" | "r" | "u";

export interface IcingDriver { tone: IcingTone; text: string; source: "METAR" | "TAF" | "model" | "SIGMET" | "PIREP" }

// ── Model profile ────────────────────────────────────────────────────────

export interface ProfileLevel { hPa: number; heightM: number; tempC: number; rh: number }
export interface ProfileHour {
  t: number;
  tempC2m: number | null;
  freezingLevelM: number | null;
  weatherCode: number | null;
  precipMm: number | null;
  windDir: number | null;
  windKt: number | null;
  gustKt: number | null;
  levels: ProfileLevel[];
}
export interface FieldProfile { live: boolean; elevationM: number | null; hours: ProfileHour[]; reason: string | null }

export const PROFILE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600] as const;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Open-Meteo hourly JSON (pressure levels, timezone=GMT) → hours. Junk stamps and levels with a missing value are dropped. */
export function parseFieldProfile(json: unknown): FieldProfile {
  const j = (json ?? {}) as { elevation?: unknown; hourly?: Record<string, unknown[]> };
  const h = j.hourly;
  if (!h || !Array.isArray(h.time)) return { live: false, elevationM: null, hours: [], reason: "model answered without an hourly profile" };
  const col = (k: string, i: number) => num(h[k]?.[i]);
  const hours: ProfileHour[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const stamp = String(h.time[i]);
    const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(stamp) ? stamp : `${stamp}Z`);
    if (!Number.isFinite(t)) continue;
    const levels: ProfileLevel[] = [];
    for (const p of PROFILE_LEVELS) {
      const heightM = col(`geopotential_height_${p}hPa`, i);
      const tempC = col(`temperature_${p}hPa`, i);
      const rh = col(`relative_humidity_${p}hPa`, i);
      if (heightM == null || tempC == null || rh == null) continue;
      levels.push({ hPa: p, heightM, tempC, rh });
    }
    hours.push({
      t,
      tempC2m: col("temperature_2m", i),
      freezingLevelM: col("freezing_level_height", i),
      weatherCode: col("weather_code", i),
      precipMm: col("precipitation", i),
      windDir: col("wind_direction_10m", i),
      windKt: col("wind_speed_10m", i),
      gustKt: col("wind_gusts_10m", i),
      levels: levels.sort((a, b) => a.heightM - b.heightM),
    });
  }
  return { live: hours.length > 0, elevationM: num(j.elevation), hours, reason: hours.length ? null : "model profile parsed no hours" };
}

export type Potential = "likely" | "possible";

export function levelPotential(tempC: number, rh: number): Potential | null {
  if (tempC > ICE_T_MAX_C || tempC < ICE_T_MIN_C) return null;
  if (rh >= LIKELY_RH && tempC >= LIKELY_T_MIN_C) return "likely";
  if (rh >= POSSIBLE_RH) return "possible";
  return null;
}

export interface IcingLayer { t: number; potential: Potential; baseFtAgl: number; topFtAgl: number; minC: number; maxC: number; maxRh: number }

/** Conducive levels inside the approach band for one hour, joined into one layer (lowest base to highest top). */
export function hourLayer(h: ProfileHour, elevationM: number): IcingLayer | null {
  const inBand = h.levels
    .map((l) => ({ l, agl: (l.heightM - elevationM) * M_TO_FT, p: levelPotential(l.tempC, l.rh) }))
    .filter((x) => x.p && x.agl >= 0 && x.agl <= APPROACH_TOP_AGL_FT);
  if (!inBand.length) return null;
  // The layer is bounded by the levels that earn its label — a "likely"
  // layer never borrows its base from a merely "possible" level.
  const best: Potential = inBand.some((x) => x.p === "likely") ? "likely" : "possible";
  let base = Infinity, top = -Infinity, minC = Infinity, maxC = -Infinity, maxRh = 0;
  for (const { l, agl, p } of inBand) {
    if (p !== best) continue;
    base = Math.min(base, agl); top = Math.max(top, agl);
    minC = Math.min(minC, l.tempC); maxC = Math.max(maxC, l.tempC); maxRh = Math.max(maxRh, l.rh);
  }
  return { t: h.t, potential: best, baseFtAgl: Math.round(base / 100) * 100, topFtAgl: Math.round(top / 100) * 100, minC: Math.round(minC), maxC: Math.round(maxC), maxRh: Math.round(maxRh) };
}

export interface IcingWindow { fromMs: number; toMs: number; potential: Potential; baseFtAgl: number; topFtAgl: number; minC: number; maxC: number; maxRh: number }

/** Consecutive conducive hours → windows (a gap or a change of potential breaks one). */
export function modelWindows(profile: FieldProfile, nowMs: number, horizonH = 30): IcingWindow[] {
  if (!profile.live || profile.elevationM == null) return [];
  const end = nowMs + horizonH * 3_600_000;
  const out: IcingWindow[] = [];
  for (const h of profile.hours) {
    if (h.t + 3_600_000 <= nowMs || h.t > end) continue;
    const l = hourLayer(h, profile.elevationM);
    const last = out[out.length - 1];
    if (!l) continue;
    if (last && last.toMs === l.t && last.potential === l.potential) {
      last.toMs = l.t + 3_600_000;
      last.baseFtAgl = Math.min(last.baseFtAgl, l.baseFtAgl); last.topFtAgl = Math.max(last.topFtAgl, l.topFtAgl);
      last.minC = Math.min(last.minC, l.minC); last.maxC = Math.max(last.maxC, l.maxC); last.maxRh = Math.max(last.maxRh, l.maxRh);
    } else {
      out.push({ fromMs: l.t, toMs: l.t + 3_600_000, potential: l.potential, baseFtAgl: l.baseFtAgl, topFtAgl: l.topFtAgl, minC: l.minC, maxC: l.maxC, maxRh: l.maxRh });
    }
  }
  return out;
}

/** WMO 56/57 freezing drizzle, 66/67 freezing rain. */
export const FREEZING_PRECIP_CODES = new Set([56, 57, 66, 67]);

export function modelSurfaceFreezing(profile: FieldProfile, nowMs: number, horizonH = 24): { fromMs: number; toMs: number; code: number } | null {
  if (!profile.live) return null;
  const end = nowMs + horizonH * 3_600_000;
  let hit: { fromMs: number; toMs: number; code: number } | null = null;
  for (const h of profile.hours) {
    if (h.t + 3_600_000 <= nowMs || h.t > end || h.weatherCode == null || !FREEZING_PRECIP_CODES.has(h.weatherCode)) continue;
    if (!hit) hit = { fromMs: h.t, toMs: h.t + 3_600_000, code: h.weatherCode };
    else if (h.t <= hit.toMs) hit.toMs = h.t + 3_600_000;
  }
  return hit;
}

// ── METAR / TAF ──────────────────────────────────────────────────────────

const FZ_PRECIP = /(?:^|\s)[+-]?(?:VC)?FZ(?:RA|DZ)/;
const FZ_FOG = /(?:^|\s)(?:VC)?FZFG/;
const PELLETS = /(?:^|\s)[+-]?(?:SH|TS)?PL|(?:^|\s)[+-]?\w*GS/;
const SNOW = /(?:^|\s)[+-]?(?:SH|BL|DR)?S[NG]/;

export interface SurfaceRead { freezingPrecip: boolean; freezingFog: boolean; pellets: boolean; snow: boolean }

export function wxCodes(raw: string | null | undefined): SurfaceRead {
  const s = ` ${(raw ?? "").toUpperCase()} `;
  return { freezingPrecip: FZ_PRECIP.test(s), freezingFog: FZ_FOG.test(s), pellets: PELLETS.test(s), snow: SNOW.test(s) };
}

/** Estimated temperature at a cloud base from the surface temperature and the standard lapse rate. */
export function cloudBaseTempC(surfaceC: number, baseFtAgl: number): number {
  return Math.round((surfaceC - (baseFtAgl / 1000) * LAPSE_C_PER_KFT) * 10) / 10;
}

/** The lowest BKN / OVC / VV layer inside the approach band whose estimated base temperature is 0 to −20 °C. */
export function metarCloudIcing(m: Pick<MetarObs, "tempC" | "clouds">): { baseFt: number; estC: number; cover: string } | null {
  if (m.tempC == null) return null;
  for (const c of [...m.clouds].sort((a, b) => (a.baseFt ?? 1e9) - (b.baseFt ?? 1e9))) {
    if (!/^(BKN|OVC|OVX|VV)$/.test(c.cover) || c.baseFt == null || c.baseFt > APPROACH_TOP_AGL_FT) continue;
    const est = cloudBaseTempC(m.tempC, c.baseFt);
    if (est <= ICE_T_MAX_C && est >= ICE_T_MIN_C) return { baseFt: c.baseFt, estC: est, cover: c.cover };
  }
  return null;
}

export interface TafIcingWindow { fromMs: number; toMs: number; change: string; what: string; freezing: boolean }

/** TAF periods carrying freezing or frozen precipitation in the next horizon. */
export function tafIcing(periods: TafPeriod[], nowMs: number, horizonH = 24): TafIcingWindow[] {
  const end = nowMs + horizonH * 3_600_000;
  const out: TafIcingWindow[] = [];
  for (const p of periods) {
    const from = Date.parse(p.from), to = Date.parse(p.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= nowMs || from >= end) continue;
    const c = wxCodes(p.wxRaw);
    const what = c.freezingPrecip ? "freezing rain / drizzle" : c.freezingFog ? "freezing fog" : c.pellets ? "ice pellets" : null;
    if (!what) continue;
    out.push({ fromMs: Math.max(from, nowMs), toMs: Math.min(to, end), change: p.changeType || "", what, freezing: c.freezingPrecip });
  }
  return out;
}

// ── SIGMET / PIREP ───────────────────────────────────────────────────────

export interface LatLonPt { lat: number; lon: number }

function insideRing(p: LatLonPt, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > p.lat) !== (yj > p.lat) && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export interface SigmetIcing {
  line: string; inEffect: boolean; covers: boolean; fromMs: number | null; toMs: number | null; baseFt: number | null; topFt: number | null;
  /** Issued for the field's region but with no area the app can read — named, never placed, never colours. */
  unplaced?: boolean;
}

/** ICAO location-indicator prefixes that share a country's FIRs (a German military field is ET…, its FIRs ED…). */
const PREFIX_FAMILY: Record<string, string[]> = { ET: ["ED"], ED: ["ET"], RO: ["RJ"], RJ: ["RO"], OT: ["OB"], OB: ["OT"] };
export function firFamily(fieldIcao: string | null | undefined): string[] {
  const p = (fieldIcao ?? "").trim().toUpperCase().slice(0, 2);
  return /^[A-Z]{2}$/.test(p) && !p.startsWith("K") ? [p, ...(PREFIX_FAMILY[p] ?? [])] : [];
}

/** SIGMET icing over the field (inside) or near it (a vertex within the approach radius), whose levels reach the approach band. */
export function sigmetIcing(sigmets: Sigmet[], field: LatLonPt, elevFt: number, nowMs: number, horizonH = 12, fieldIcao: string | null = null): SigmetIcing[] {
  const out: SigmetIcing[] = [];
  const bandTop = elevFt + APPROACH_TOP_AGL_FT;
  const family = firFamily(fieldIcao);
  for (const s of sigmets) {
    if (s.hazard !== "icing") continue;
    if (!s.points.length) {
      // No readable area: name it only when the issuing FIR is in the field's own region.
      const fir = /^[A-Z]{4}/.exec((s.fir ?? "").trim().toUpperCase())?.[0] ?? "";
      if (!family.length || !family.includes(fir.slice(0, 2))) continue;
      const f = s.fromISO ? Date.parse(s.fromISO) : null, t = s.toISO ? Date.parse(s.toISO) : null;
      if ((t != null && t <= nowMs) || (f != null && f > nowMs + horizonH * 3_600_000)) continue;
      out.push({
        line: `SIGMET icing in ${fir} FIR with no area the app can read${/ENTIRE FIR/.test(s.raw.toUpperCase()) ? " (ENTIRE FIR)" : ""} — not placed against the field; read the SIGMET`,
        inEffect: f == null || f <= nowMs, covers: false, fromMs: f, toMs: t, baseFt: s.baseFt, topFt: s.topFt, unplaced: true,
      });
      continue;
    }
    const from = s.fromISO ? Date.parse(s.fromISO) : null;
    const to = s.toISO ? Date.parse(s.toISO) : null;
    if (to != null && to <= nowMs) continue;
    if (from != null && from > nowMs + horizonH * 3_600_000) continue;
    if (s.baseFt != null && s.baseFt > bandTop) continue;
    const covers = s.points.length >= 3 && insideRing(field, s.points);
    const near = covers || s.points.some(([lat, lon]) => haversineKm(field.lat, field.lon, lat, lon) <= APPROACH_RADIUS_NM * KM_PER_NM);
    if (!near) continue;
    const lv = s.baseFt != null || s.topFt != null ? `${s.baseFt == null ? "?" : s.baseFt === 0 ? "SFC" : `${s.baseFt.toLocaleString("en-US")} ft`}–${s.topFt == null ? "?" : s.topFt >= 18000 ? `FL${Math.round(s.topFt / 100)}` : `${s.topFt.toLocaleString("en-US")} ft`}` : "levels not stated";
    out.push({
      line: `SIGMET icing${s.qualifier ? ` (${s.qualifier})` : ""} ${covers ? "over the field" : "within 30 NM"} · ${lv}${s.fir ? ` · ${s.fir}` : ""}`,
      inEffect: from == null || from <= nowMs, covers, fromMs: from, toMs: to, baseFt: s.baseFt, topFt: s.topFt,
    });
  }
  return out;
}

export type PirepIntensity = "NEG" | "TRC" | "LGT" | "MOD" | "SEV";
export interface Pirep { t: number; lat: number; lon: number; altFt: number | null; intensity: PirepIntensity | null; type: string | null; acType: string | null; raw: string }

const INT_RANK: Record<PirepIntensity, number> = { NEG: 0, TRC: 1, LGT: 2, MOD: 3, SEV: 4 };

/** "LGT-MOD", "MOD", "SEV", "TRC-LGT", "NEG" → the WORSE word; null when no icing word. */
export function pirepIntensity(s: string | null | undefined): PirepIntensity | null {
  const t = (s ?? "").toUpperCase();
  let best: PirepIntensity | null = null;
  for (const w of ["NEG", "NEGCLR", "TRC", "TRACE", "LGT", "LIGHT", "MOD", "MODERATE", "SEV", "SEVERE", "HVY", "EXTRM"]) {
    if (!new RegExp(`(^|[^A-Z])${w}([^A-Z]|$)`).test(t)) continue;
    const k: PirepIntensity = w.startsWith("NEG") ? "NEG" : w.startsWith("TR") ? "TRC" : w.startsWith("L") ? "LGT" : w.startsWith("MOD") ? "MOD" : "SEV";
    if (!best || INT_RANK[k] > INT_RANK[best]) best = k;
  }
  return best;
}

/** The /IC group of a raw PIREP ("… /IC MOD RIME 060-090 /RM …"). */
export function rawIcingGroup(raw: string): { intensity: PirepIntensity | null; type: string | null } | null {
  const m = raw.toUpperCase().match(/\/IC\s+([^/]+)/);
  if (!m) return null;
  const g = m[1].trim();
  return { intensity: pirepIntensity(g), type: (g.match(/\b(RIME|CLR|CLEAR|MX|MXD|MIXED)\b/) ?? [null, null])[1] };
}

/** "/FL080" or a fltLvl field → feet. */
function flightLevelFt(v: unknown, raw: string): number | null {
  const n0 = typeof v === "number" ? v : typeof v === "string" && /^\d{1,3}$/.test(v.trim()) ? Number(v) : null;
  if (n0 != null && Number.isFinite(n0)) return n0 * 100;
  const m = raw.toUpperCase().match(/\/FL\s?(\d{3})/);
  return m ? Number(m[1]) * 100 : null;
}

/** AWC PIREP JSON (a bare array or a GeoJSON collection), tolerant of field names. */
export function parsePireps(body: unknown): { pireps: Pirep[]; rows: number } {
  const rows: unknown[] = Array.isArray(body) ? body
    : body && typeof body === "object" && Array.isArray((body as { features?: unknown[] }).features) ? (body as { features: unknown[] }).features
    : body && typeof body === "object" && Array.isArray((body as { data?: unknown[] }).data) ? (body as { data: unknown[] }).data : [];
  const out: Pirep[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const f = r as { properties?: Record<string, unknown>; geometry?: { coordinates?: unknown[] } };
    const o = (f.properties ?? r) as Record<string, unknown>;
    const coords = f.geometry?.coordinates;
    const lat = num(o.lat) ?? num(Array.isArray(coords) ? coords[1] : null);
    const lon = num(o.lon) ?? num(Array.isArray(coords) ? coords[0] : null);
    if (lat == null || lon == null) continue;
    const raw = String(o.rawOb ?? o.rawText ?? o.raw ?? "");
    const tRaw = o.obsTime ?? o.receiptTime;
    const t = typeof tRaw === "number" ? (tRaw < 1e12 ? tRaw * 1000 : tRaw) : typeof tRaw === "string" ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(tRaw) ? tRaw : `${tRaw.replace(" ", "T")}Z`) : NaN;
    if (!Number.isFinite(t)) continue;
    const g = rawIcingGroup(raw);
    const intensity = pirepIntensity(typeof o.icgInt1 === "string" ? o.icgInt1 : null) ?? g?.intensity ?? null;
    const type = (typeof o.icgType1 === "string" && o.icgType1.trim()) || g?.type || null;
    out.push({ t, lat, lon, altFt: flightLevelFt(o.fltLvl ?? o.fltlvl, raw), intensity, type, acType: typeof o.acType === "string" ? o.acType : null, raw: raw.slice(0, 300) });
  }
  return { pireps: out, rows: rows.length };
}

export interface PirepNear { intensity: PirepIntensity; type: string | null; altFt: number | null; distNm: number; ageMin: number; acType: string | null; inBand: boolean }

/** Icing PIREPs near the field in the last hours, worst first. A report with no altitude is kept and said. */
export function pirepsNear(pireps: Pirep[], field: LatLonPt, elevFt: number, nowMs: number): PirepNear[] {
  const out: PirepNear[] = [];
  for (const p of pireps) {
    if (!p.intensity) continue;
    const ageMin = Math.round((nowMs - p.t) / 60_000);
    if (ageMin < -10 || ageMin > PIREP_MAX_AGE_H * 60) continue;
    const distNm = Math.round(haversineKm(field.lat, field.lon, p.lat, p.lon) / KM_PER_NM);
    if (distNm > PIREP_RADIUS_NM) continue;
    const inBand = p.altFt == null || p.altFt <= elevFt + APPROACH_TOP_AGL_FT;
    out.push({ intensity: p.intensity, type: p.type, altFt: p.altFt, distNm, ageMin: Math.max(0, ageMin), acType: p.acType, inBand });
  }
  return out.sort((a, b) => INT_RANK[b.intensity] - INT_RANK[a.intensity] || a.ageMin - b.ageMin);
}

// ── The read ─────────────────────────────────────────────────────────────

export interface IcingInputs {
  nowMs: number;
  field: LatLonPt;
  metar: Pick<MetarObs, "tempC" | "dewpointC" | "clouds" | "wxRaw"> | null;
  taf: TafPeriod[] | null;
  /** The raw TAF and its issue time — read for U.S. military icing groups (6IchhhT). */
  tafRaw?: string | null;
  tafIssued?: string | null;
  /** The field's ICAO — places a SIGMET with no readable area by its FIR's region. */
  icao?: string | null;
  profile: FieldProfile | null;
  sigmets: { live: boolean; items: Sigmet[] } | null;
  pireps: { live: boolean; items: Pirep[] } | null;
}

export interface IcingRead {
  level: IcingLed;
  /** One sentence — the lead driver, or why the read is quiet / UNKNOWN. */
  summary: string;
  drivers: IcingDriver[];
  windows: IcingWindow[];
  tafWindows: TafIcingWindow[];
  /** Military TAF icing groups inside the next 24 h (base inside the approach band). */
  tafGroups: TafIcingGroup[];
  /** The TAF is a U.S. military TAF — the absence of an icing group is the forecaster saying none. */
  militaryTaf: boolean;
  sigmets: SigmetIcing[];
  pireps: PirepNear[];
  /** Freezing level now (model), feet MSL and AGL. */
  freezingLevel: { msl: number; agl: number } | null;
  /** Freezing / frozen precipitation at the field now or forecast — feeds the crosswind contamination check. */
  contaminationWindows: { fromMs: number; toMs: number; what: string }[];
  sources: { metar: boolean; taf: boolean; model: boolean; sigmet: boolean | null; pirep: boolean | null };
  elevFt: number | null;
}

const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`; };
const win = (a: number, b: number) => `${hhmm(a)}–${hhmm(b)}`;
const ftStr = (f: number) => (f <= 0 ? "SFC" : `${f.toLocaleString("en-US")} ft`);

export function readIcing(i: IcingInputs): IcingRead {
  const now = i.nowMs;
  const drivers: IcingDriver[] = [];
  const contamination: IcingRead["contaminationWindows"] = [];
  const elevM = i.profile?.elevationM ?? null;
  const elevFt = elevM != null ? Math.round(elevM * M_TO_FT) : null;

  // 1. METAR
  const metarLive = Boolean(i.metar);
  if (i.metar) {
    const c = wxCodes(i.metar.wxRaw);
    const cold = i.metar.tempC != null && i.metar.tempC <= 2;
    if (c.freezingPrecip) {
      drivers.push({ tone: "r", source: "METAR", text: "Freezing rain / drizzle observed at the field — airframe and runway icing now; de-ice and anti-ice, braking degraded" });
      contamination.push({ fromMs: now, toMs: now + 3_600_000, what: "freezing precipitation (observed)" });
    }
    if (c.freezingFog) drivers.push({ tone: "a", source: "METAR", text: "Freezing fog at the field — rime on surfaces and airframes on the ground and at low level" });
    if (c.pellets && cold) {
      drivers.push({ tone: "a", source: "METAR", text: "Ice pellets at the field — freezing rain usually lies above" });
      contamination.push({ fromMs: now, toMs: now + 3_600_000, what: "ice pellets (observed)" });
    }
    if (c.snow && cold) contamination.push({ fromMs: now, toMs: now + 3_600_000, what: "snow (observed)" });
    const cloud = metarCloudIcing(i.metar);
    if (cloud) drivers.push({ tone: "a", source: "METAR", text: `${cloud.cover} cloud base ${cloud.baseFt.toLocaleString("en-US")} ft AGL at an estimated ${cloud.estC} °C — the approach descends through cloud at icing temperatures (surface ${i.metar.tempC} °C, standard lapse)` });
  }

  // 2. TAF
  const tafLive = Boolean(i.taf && i.taf.length);
  const tafWindows = i.taf ? tafIcing(i.taf, now) : [];
  for (const w of tafWindows.slice(0, 3)) {
    drivers.push({ tone: "a", source: "TAF", text: `TAF ${w.change ? `${w.change} ` : ""}${w.what} ${win(w.fromMs, w.toMs)}` });
    if (w.freezing || /pellets/.test(w.what)) contamination.push({ fromMs: w.fromMs, toMs: w.toMs, what: `${w.what} (TAF)` });
  }
  // 2b. Military TAF icing groups — the forecaster's own icing statement.
  // A forecast, so never red (red is observed or warned); moderate / severe
  // amber, light a note; severe leads.
  const hz = i.tafRaw ? parseTafHazards(i.tafRaw, i.tafIssued ?? null, now) : null;
  const militaryTaf = Boolean(hz?.military);
  const horizon = now + 24 * 3_600_000;
  const INT_ORDER = { severe: 0, moderate: 1, light: 2, trace: 3 } as const;
  const tafGroups = (hz?.groups ?? [])
    .filter((g) => g.toMs > now && g.fromMs < horizon && g.intensity !== "trace" && g.baseFtAgl <= APPROACH_TOP_AGL_FT)
    .map((g) => ({ ...g, fromMs: Math.max(g.fromMs, now), toMs: Math.min(g.toMs, horizon) }))
    .sort((a, b) => INT_ORDER[a.intensity] - INT_ORDER[b.intensity] || a.fromMs - b.fromMs);
  for (const g of tafGroups.slice(0, 4)) {
    const inEffect = g.fromMs <= now;
    drivers.push({
      tone: g.intensity === "light" ? "i" : "a", source: "TAF",
      text: `TAF ${g.change ? `${g.change} ` : ""}forecasts ${g.intensity === "severe" ? icingGroupLabel(g).replace(/^severe/, "SEVERE") : icingGroupLabel(g)} ${inEffect ? `now–${hhmm(g.toMs)}` : win(g.fromMs, g.toMs)} (military icing group ${g.code})`,
    });
  }

  // 3. Model profile
  const modelLive = Boolean(i.profile?.live && elevM != null);
  const windows = modelLive ? modelWindows(i.profile!, now) : [];
  for (const w of windows) {
    const soon = w.fromMs <= now + MODEL_AMBER_HOURS * 3_600_000;
    const tone: IcingTone = w.potential === "likely" && soon ? "a" : "i";
    if (drivers.filter((d) => d.source === "model").length >= 3) break;
    const band = w.baseFtAgl === w.topFtAgl ? `near ${ftStr(w.baseFtAgl)}` : `${ftStr(w.baseFtAgl)}–${ftStr(w.topFtAgl)}`;
    const temps = w.maxC === w.minC ? `${w.maxC} °C` : `${w.maxC} to ${w.minC} °C`;
    drivers.push({ tone, source: "model", text: `Icing ${w.potential} on approach ${win(w.fromMs, w.toMs)} · ${band} AGL · ${temps}, RH to ${w.maxRh}% (model, planning-grade)` });
  }
  const sfcFz = modelLive ? modelSurfaceFreezing(i.profile!, now) : null;
  if (sfcFz) {
    drivers.push({ tone: "a", source: "model", text: `Model forecasts freezing ${sfcFz.code === 56 || sfcFz.code === 57 ? "drizzle" : "rain"} at the field ${win(sfcFz.fromMs, sfcFz.toMs)}` });
    contamination.push({ fromMs: sfcFz.fromMs, toMs: sfcFz.toMs, what: "freezing precipitation (model)" });
  }
  let freezingLevel: IcingRead["freezingLevel"] = null;
  if (modelLive) {
    const h = i.profile!.hours.filter((x) => x.t <= now).sort((a, b) => b.t - a.t)[0] ?? i.profile!.hours[0];
    if (h?.freezingLevelM != null) {
      const msl = Math.round((h.freezingLevelM * M_TO_FT) / 100) * 100;
      freezingLevel = { msl, agl: Math.max(0, msl - (elevFt ?? 0)) };
    }
  }

  // 4. SIGMET
  const sig = i.sigmets?.live ? sigmetIcing(i.sigmets.items, i.field, elevFt ?? 0, now, 12, i.icao ?? null) : [];
  for (const s of sig) {
    if (s.unplaced) { drivers.push({ tone: "i", source: "SIGMET", text: s.line }); continue; }
    drivers.push({ tone: s.inEffect ? "r" : "a", source: "SIGMET", text: s.inEffect ? `${s.line} — in effect${s.toMs ? ` until ${hhmm(s.toMs)}` : ""} (a SIGMET icing is severe icing)` : `${s.line} — from ${s.fromMs ? hhmm(s.fromMs) : "?"}` });
  }

  // 5. PIREPs
  const near = i.pireps?.live ? pirepsNear(i.pireps.items, i.field, elevFt ?? 0, now) : [];
  for (const p of near.slice(0, 4)) {
    if (p.intensity === "NEG") continue;
    const tone: IcingTone = !p.inBand ? "i" : p.intensity === "SEV" ? "r" : p.intensity === "MOD" ? "a" : "i";
    drivers.push({ tone, source: "PIREP", text: `PIREP ${p.intensity}${p.type ? ` ${p.type}` : ""} icing ${p.altFt != null ? `at ${p.altFt.toLocaleString("en-US")} ft MSL` : "(altitude not given)"} · ${p.distNm} NM · ${p.ageMin} min ago${p.acType ? ` · ${p.acType}` : ""}${p.inBand ? "" : " (above the approach band)"}` });
  }
  const negOnly = near.length > 0 && near.every((p) => p.intensity === "NEG");

  const order: Record<IcingTone, number> = { r: 0, a: 1, i: 2 };
  drivers.sort((a, b) => order[a.tone] - order[b.tone]);
  const level: IcingLed = drivers.some((d) => d.tone === "r") ? "r"
    : drivers.some((d) => d.tone === "a") ? "a"
    : metarLive || modelLive ? "g" : "u";
  const summary = level === "u" ? "Icing UNKNOWN — neither the METAR nor the model profile answered"
    : drivers[0] && drivers[0].tone !== "i" ? drivers[0].text
    : drivers[0] ? `No icing expected inside 12 h; ${drivers[0].text.charAt(0).toLowerCase()}${drivers[0].text.slice(1)}`
    : `No icing indicated at the field or on approach${militaryTaf && !tafGroups.length ? " · the military TAF forecasts no icing group" : ""}${negOnly ? " · a PIREP reported no icing nearby" : ""}${freezingLevel ? ` · freezing level ${freezingLevel.msl.toLocaleString("en-US")} ft MSL` : ""}`;

  return {
    level, summary, drivers, windows, tafWindows, tafGroups, militaryTaf, sigmets: sig, pireps: near, freezingLevel,
    contaminationWindows: contamination,
    sources: { metar: metarLive, taf: tafLive, model: modelLive, sigmet: i.sigmets ? i.sigmets.live : null, pirep: i.pireps ? i.pireps.live : null },
    elevFt,
  };
}
