// The 72-hour ops timeline at a SITREP field — PURE, client-safe, tested in
// tests/opsTimeline.test.ts (2026-11-26, "analyzing the next 2-3 days to see
// potential limiting factors in the weather or other ops limitations … cold,
// rain, ice … enhance the graphical timeline").
//
// One hourly axis, one LANE per question an operator asks about the next three
// days, each lane read from the sources the SITREP already holds:
//   sky       — flight category: the TAF inside its window (TEMPO / PROB folded,
//               dashed), the model's VISIBILITY beyond it (ceiling is not
//               modelled, and the label says "vis only")
//   precip    — what falls: the TAF's weather codes inside its window, the
//               model's weather code beyond (thunder › freezing › pellets ›
//               snow › heavy rain › rain › drizzle)
//   temp      — the 2-m temperature, dew point and feels-like as a line with
//               the 0 °C crossing marked (no tone — a picture, not a verdict)
//   deice     — ground icing on airframes: freezing precipitation, snow or
//               pellets near freezing, freezing fog, rain at or below 0 °C,
//               and FROST (≤ 0 °C, dew-point spread ≤ 2 °C, no precipitation)
//   runway    — surface condition: ice, snow (with the model's cm), standing
//               water from heavy rain, and REFREEZE (the temperature falling
//               to ≤ 0 °C within 12 h of precipitation — black ice)
//   icing     — airframe icing in the approach band (field to 10,000 ft AGL):
//               the model's conducive layers and the military TAF's 6-groups
//   xwind     — crosswind on the BEST runway end (lib/crosswind), TAF wind in
//               its window and model wind beyond, raised to amber when the
//               runway lane says contaminated
//   ramp      — people and equipment outside: thunder (lightning holds),
//               wind chill and frostbite, heat stress, gusts at stand / door
//               limits
// plus the LIGHT under every lane (day · civil · nautical · night).
//
// Disciplines, all tested:
//   - A FORECAST IS AMBER AT MOST, except the crosswind lane, which keeps
//     lib/crosswind's own advisory bands so the lane and the crosswind table
//     never disagree. RED is for what is observed, and the timeline reads no
//     observation — the METAR lives on the card above it.
//   - The TAF governs its window: a TAF hour with no weather code is "nothing
//     falling" even when the model has rain.
//   - A model hour that did not answer is UNKNOWN, never clear; a lane whose
//     source is missing says so (`unknown`), it does not render empty.
//   - Every model judgement says "(model)"; the thresholds are planning
//     guidance, never a flight manual's limits or local de-ice policy.
//   - The timeline NEVER moves the weather LED — icing, crosswind and
//     turbulence already do, inside their own horizons and rules.

import type { ProfileHour } from "./icingSignals";
import type { TafPeriod } from "./types";
import type { TafIcingGroup } from "./tafGroups";
import { runwayEnds, bestEnd } from "./crosswind";
import { sunAltitude } from "./moon";

export const TIMELINE_HOURS = 72;
export const H = 3_600_000;

/** Frost: air ≤ 0 °C and the dew point within this many degrees (saturation). */
export const FROST_SPREAD_C = 2;
/** Snow / pellets count for de-icing at or below this air temperature. */
export const SNOW_DEICE_C = 2;
/** Rain at or below this is glaze on cold surfaces (amber); up to NEAR is a note. */
export const RAIN_GLAZE_C = 0;
export const RAIN_NEAR_C = 2;
/** Precipitation rate (mm in the hour) that risks standing water. */
export const HEAVY_RAIN_MM = 4;
/** Refreeze: a fall to ≤ 0 °C within this many hours of precipitation. */
export const REFREEZE_LOOKBACK_H = 12;
export const REFREEZE_MIN_PRECIP_MM = 0.2;
/** Wind chill: a note at COLD, amber at FROSTBITE (≈ 30 min to frostbite on exposed skin). */
export const WINDCHILL_COLD_C = -18;
export const WINDCHILL_FROSTBITE_C = -27;
/** Heat stress: a note at WARM, amber at HOT (feels-like). */
export const HEAT_WARM_C = 32;
export const HEAT_HOT_C = 40;
/** Gusts that reach door / stairs / maintenance-stand limits. */
export const RAMP_GUST_KT = 35;
/** Model icing "likely" inside this many hours is amber (lib/icingSignals' own rule). */
export const ICING_AMBER_H = 12;
/** Contamination × crosswind (lib/crosswind's CONTAM bands). */
const CONTAM_X_KT = 15, CONTAM_GX_KT = 20;
const M_TO_FT = 3.28084;

export type Tone = "r" | "a" | "i" | "g" | "u";
/** Worse first: red › amber › UNKNOWN › note › green. */
const TONE_RANK: Record<Tone, number> = { r: 4, a: 3, u: 2, i: 1, g: 0 };
export type LaneKey = "sky" | "precip" | "deice" | "runway" | "icing" | "xwind" | "ramp" | "notam";
export type Cat = "VFR" | "MVFR" | "IFR" | "LIFR";

export interface TlSeg {
  fromMs: number;
  toMs: number;
  tone: Tone;
  /** The short label drawn on the bar ("FZRA", "IFR", "18G28 R23"). */
  label: string;
  /** The sentence for the tooltip / the limiting-window list. */
  detail: string;
  /** A TEMPO / PROB risk period or a model-only read — drawn dashed. */
  dashed?: boolean;
  src: "taf" | "model" | "mixed";
  cat?: Cat;
  /** A shorter bar label for a narrow bar ("CLSD" for "RWY 05/23 CLSD"); the full label stays on window chips. */
  short?: string;
}

export interface TlLane {
  key: LaneKey;
  title: string;
  segs: TlSeg[];
  /** Why the lane cannot be read (all of it or past the TAF) — null when it can. */
  unknown: string | null;
}

export interface TlTempPoint { t: number; c: number | null; dew: number | null; feels: number | null; fzlFtAgl: number | null }

export interface LimitWindow {
  fromMs: number;
  toMs: number;
  tone: "a" | "r";
  /** One short factor per contributing lane, worst first. */
  factors: { lane: LaneKey; label: string; detail: string }[];
  text: string;
}

export interface OpsTimeline {
  live: boolean;
  startMs: number;
  hours: number;
  /** End of the TAF's validity — beyond it the lanes are model only. */
  tafEndMs: number | null;
  light: { fromMs: number; toMs: number; state: "day" | "civil" | "nautical" | "night" }[];
  lanes: TlLane[];
  temps: TlTempPoint[];
  /** Coldest / warmest 2-m temperature in the window, and the 0 °C crossings. */
  temp: { minC: number | null; maxC: number | null; crossings: { t: number; dir: "down" | "up" }[] };
  windows: LimitWindow[];
  summary: string;
  reason: string | null;
}

// ── Weather words ────────────────────────────────────────────────────────

export type Wx = "thunder" | "fzra" | "fzdz" | "pellets" | "hail" | "snow" | "heavyrain" | "rain" | "showers" | "drizzle" | "fzfog" | "fog" | "none";

const WX_RANK: Record<Wx, number> = { thunder: 10, fzra: 9, fzdz: 8, pellets: 7, hail: 7, snow: 6, heavyrain: 5, rain: 4, showers: 4, drizzle: 3, fzfog: 2, fog: 1, none: 0 };
export const WX_CHIP: Record<Wx, string> = { thunder: "TS", fzra: "FZRA", fzdz: "FZDZ", pellets: "PL", hail: "GR", snow: "SN", heavyrain: "+RA", rain: "RA", showers: "SHRA", drizzle: "DZ", fzfog: "FZFG", fog: "FG", none: "" };
export const WX_WORD: Record<Wx, string> = {
  thunder: "thunderstorms", fzra: "freezing rain", fzdz: "freezing drizzle", pellets: "ice pellets", hail: "hail", snow: "snow",
  heavyrain: "heavy rain", rain: "rain", showers: "showers", drizzle: "drizzle", fzfog: "freezing fog", fog: "fog", none: "nothing falling",
};
const worseWx = (a: Wx, b: Wx): Wx => (WX_RANK[b] > WX_RANK[a] ? b : a);

/** A TAF / METAR weather string → the worst kind it names. */
export function wxFromCodes(raw: string | null | undefined): Wx {
  const s = ` ${(raw ?? "").toUpperCase()} `;
  if (/\bNSW\b/.test(s) || !s.trim()) return "none";
  let w: Wx = "none";
  for (const tok of s.trim().split(/\s+/)) {
    const t = tok.replace(/^VC/, "");
    if (/TS/.test(t)) w = worseWx(w, "thunder");
    if (/FZRA/.test(t)) w = worseWx(w, "fzra");
    if (/FZDZ/.test(t)) w = worseWx(w, "fzdz");
    if (/FZFG/.test(t)) w = worseWx(w, "fzfog");
    if (/(^|[+-])(SH)?PL|GS/.test(t)) w = worseWx(w, "pellets");
    if (/GR/.test(t)) w = worseWx(w, "hail");
    if (/S[NG]/.test(t) && !/^(BL|DR)SN$/.test(t)) w = worseWx(w, "snow");
    if (/RA/.test(t) && !/FZRA/.test(t)) w = worseWx(w, t.startsWith("+") ? "heavyrain" : /^-?SH/.test(t) ? "showers" : "rain");
    if (/DZ/.test(t) && !/FZDZ/.test(t)) w = worseWx(w, "drizzle");
    if (/^(MI|BC|PR)?FG$/.test(t)) w = worseWx(w, "fog");
  }
  return w;
}

/** A WMO weather code (model) → the kind it names. */
export function wxFromWmo(code: number | null | undefined): Wx {
  if (code == null) return "none";
  if (code >= 95) return code >= 96 ? "hail" : "thunder";
  if (code === 66 || code === 67) return "fzra";
  if (code === 56 || code === 57) return "fzdz";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code === 65 || code === 82) return "heavyrain";
  if (code === 80 || code === 81) return "showers";
  if (code >= 61 && code <= 64) return "rain";
  if (code >= 51 && code <= 55) return "drizzle";
  if (code === 48) return "fzfog";
  if (code === 45) return "fog";
  return "none";
}

// ── The hour read ────────────────────────────────────────────────────────

const CAT_RANK: Record<Cat, number> = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 };
const asCat = (c: unknown): Cat | null => (c === "VFR" || c === "MVFR" || c === "IFR" || c === "LIFR" ? c : null);
const isOverlay = (change: string) => /^(TEMPO|PROB)/i.test(change || "");

interface HourRead {
  t: number;
  inTaf: boolean;
  cat: Cat | null;
  catOverlay: boolean;
  wx: Wx;
  wxOverlay: boolean;
  wxSrc: "taf" | "model" | null;
  model: ProfileHour | null;
  windDir: number | null;
  windKt: number | null;
  gustKt: number | null;
  windVariable: boolean;
  windSrc: "taf" | "model" | null;
  tempC: number | null;
  dewC: number | null;
  feelsC: number | null;
  precipMm: number | null;
  snowCm: number | null;
}

/** The model's visibility as a flight category — ceiling is NOT modelled, so this is a floor on how bad, never a VFR claim. */
export function visCategory(visM: number | null | undefined): Cat | null {
  if (visM == null) return null;
  const mi = visM / 1609.34;
  return mi < 1 ? "LIFR" : mi < 3 ? "IFR" : mi <= 5 ? "MVFR" : "VFR";
}

function readHours(i: TimelineInputs, start: number, n: number): HourRead[] {
  const taf = (i.taf ?? [])
    .map((p) => ({ p, from: Date.parse(p.from), to: Date.parse(p.to) }))
    .filter((x) => Number.isFinite(x.from) && Number.isFinite(x.to) && x.to > x.from);
  const bases = taf.filter((x) => !isOverlay(x.p.changeType)).sort((a, b) => a.from - b.from);
  // A base period prevails until the next one starts (a BECMG transition
  // window followed by a gap is still that period's weather), never past the
  // TAF's validity.
  const validTo = taf.length ? Math.max(...taf.map((x) => x.to)) : 0;
  bases.forEach((b, k) => { const next = bases[k + 1]; if (next && b.to < next.from) b.to = next.from; else if (!next && b.to < validTo) b.to = validTo; });
  const overlays = taf.filter((x) => isOverlay(x.p.changeType));
  const model = new Map<number, ProfileHour>();
  for (const h of i.hours ?? []) model.set(Math.floor(h.t / H) * H, h);
  const out: HourRead[] = [];
  for (let k = 0; k < n; k++) {
    const t = start + k * H, mid = t + H / 2;
    // The prevailing period: the latest-starting base period covering the hour.
    let base: (typeof bases)[number] | null = null;
    for (const b of bases) if (b.from <= mid && b.to > mid) base = b;
    const ov = overlays.filter((o) => o.from < t + H && o.to > t);
    const m = model.get(t) ?? null;
    const r: HourRead = {
      t, inTaf: Boolean(base), cat: null, catOverlay: false, wx: "none", wxOverlay: false, wxSrc: null, model: m,
      windDir: null, windKt: null, gustKt: null, windVariable: false, windSrc: null,
      tempC: m?.tempC2m ?? null, dewC: m?.dewC ?? null, feelsC: m?.feelsC ?? null, precipMm: m?.precipMm ?? null, snowCm: m?.snowCm ?? null,
    };
    if (base) {
      r.cat = asCat(base.p.flightCategory);
      r.wx = wxFromCodes(base.p.wxRaw);
      r.wxSrc = "taf";
      if (base.p.windSpeedKt != null) {
        r.windDir = base.p.windDir ?? null; r.windKt = base.p.windSpeedKt; r.gustKt = base.p.windGustKt ?? null;
        r.windVariable = Boolean(base.p.windVariable); r.windSrc = "taf";
      }
      for (const o of ov) {
        const c = asCat(o.p.flightCategory);
        if (c && (!r.cat || CAT_RANK[c] > CAT_RANK[r.cat])) { r.cat = c; r.catOverlay = true; }
        const w = wxFromCodes(o.p.wxRaw);
        if (WX_RANK[w] > WX_RANK[r.wx]) { r.wx = w; r.wxOverlay = true; }
        // A TEMPO gust is the gust the hour may see.
        if (o.p.windGustKt != null && r.windSrc === "taf" && (r.gustKt == null || o.p.windGustKt > r.gustKt)) r.gustKt = o.p.windGustKt;
      }
    } else if (m) {
      r.cat = visCategory(m.visM);
      r.wx = wxFromWmo(m.weatherCode);
      r.wxSrc = m.weatherCode != null ? "model" : null;
    }
    if (r.windSrc == null && m?.windKt != null) {
      r.windDir = m.windDir; r.windKt = Math.round(m.windKt); r.gustKt = m.gustKt != null ? Math.round(m.gustKt) : null; r.windSrc = "model";
    }
    out.push(r);
  }
  return out;
}

// ── Per-lane hourly verdicts ─────────────────────────────────────────────

type Cell = Omit<TlSeg, "fromMs" | "toMs"> | null;
const srcOf = (r: HourRead, which: "wx" | "wind" | "model"): "taf" | "model" =>
  which === "model" ? "model" : (which === "wx" ? r.wxSrc : r.windSrc) === "taf" ? "taf" : "model";
const tag = (s: "taf" | "model") => (s === "taf" ? "TAF" : "model");

function skyCell(r: HourRead): Cell {
  if (!r.cat) return null;
  const tone: Tone = r.cat === "LIFR" || r.cat === "IFR" ? "a" : r.cat === "MVFR" ? "i" : "g";
  if (r.inTaf) {
    return { tone, label: r.cat, cat: r.cat, src: "taf", dashed: r.catOverlay,
      detail: `${r.cat} (TAF${r.catOverlay ? " TEMPO/PROB" : ""})` };
  }
  // Beyond the TAF: visibility only — a VFR here is "visibility fine", not a ceiling claim.
  return { tone, label: r.cat === "VFR" ? "vis ok" : `${r.cat} vis`, cat: r.cat, src: "model", dashed: true,
    detail: `${r.cat} by model visibility (ceiling not modelled — planning-grade)` };
}

function precipCell(r: HourRead): Cell {
  if (r.wxSrc == null || r.wx === "none") return null;
  const s = srcOf(r, "wx");
  const amber = ["thunder", "fzra", "fzdz", "pellets", "hail", "snow", "heavyrain"].includes(r.wx);
  const fogOnly = r.wx === "fog" || r.wx === "fzfog";
  if (fogOnly) return null; // fog lives in the sky and ground-ice lanes
  const mm = r.precipMm != null && r.precipMm > 0 && s === "model" ? ` · ${r.precipMm.toFixed(1)} mm/h` : "";
  return { tone: amber ? "a" : "i", label: WX_CHIP[r.wx], src: s, dashed: r.wxOverlay || s === "model",
    detail: `${WX_WORD[r.wx]} (${tag(s)}${r.wxOverlay ? " TEMPO/PROB" : ""})${mm}` };
}

function deiceCell(r: HourRead): Cell {
  const s = srcOf(r, "wx");
  const t = r.tempC;
  const tTxt = t != null ? ` at ${Math.round(t)} °C` : "";
  if (r.wx === "fzra" || r.wx === "fzdz") {
    // The TAF can name freezing precipitation where the model's 2-m air is
    // well above 0 °C — say the two disagree instead of "freezing rain at 6 °C".
    const disagree = s === "taf" && t != null && t > RAIN_NEAR_C;
    const tNote = disagree ? ` — the model has the air at ${Math.round(t)} °C; the TAF and the model disagree, plan on the TAF` : tTxt;
    return { tone: "a", label: "DE/ANTI-ICE", src: s, dashed: r.wxOverlay,
      detail: `${WX_WORD[r.wx]} (${tag(s)})${tNote} — de-ice and anti-ice; holdover times are short in freezing precipitation` };
  }
  if ((r.wx === "snow" || r.wx === "pellets") && (t == null || t <= SNOW_DEICE_C)) {
    return { tone: "a", label: "DE-ICE", src: s, dashed: r.wxOverlay,
      detail: `${WX_WORD[r.wx]} (${tag(s)})${tTxt} — de-ice before departure; check holdover for the fluid in use` };
  }
  if (r.wx === "fzfog" || (r.wx === "fog" && t != null && t <= 0)) {
    return { tone: "a", label: "FZFG", src: s, dashed: r.wxOverlay,
      detail: `freezing fog (${tag(s)})${tTxt} — rime on airframes and surfaces` };
  }
  if ((r.wx === "rain" || r.wx === "drizzle" || r.wx === "showers" || r.wx === "heavyrain") && t != null) {
    if (t <= RAIN_GLAZE_C) return { tone: "a", label: "GLAZE", src: "mixed", dashed: true,
      detail: `${WX_WORD[r.wx]} (${tag(s)}) with the air at ${Math.round(t)} °C (model) — glaze ice on cold-soaked surfaces` };
    if (t <= RAIN_NEAR_C) return { tone: "i", label: "near 0°", src: "mixed", dashed: true,
      detail: `${WX_WORD[r.wx]} (${tag(s)}) at ${Math.round(t)} °C (model) — cold-soaked wings can still ice` };
  }
  // Frost: at or below freezing, near saturation, nothing falling.
  if (r.wx === "none" && t != null && t <= 0 && r.dewC != null && t - r.dewC <= FROST_SPREAD_C) {
    return { tone: "i", label: "FROST", src: "model", dashed: true,
      detail: `frost likely (model: ${Math.round(t)} °C, dew point ${Math.round(r.dewC)} °C) — clear the airframe before departure` };
  }
  return null;
}

function runwayCell(r: HourRead, prior: HourRead[]): Cell {
  const s = srcOf(r, "wx");
  if (r.wx === "fzra" || r.wx === "fzdz") return { tone: "a", label: "ICE", src: s, dashed: r.wxOverlay, detail: `${WX_WORD[r.wx]} (${tag(s)}) — ice on the runway, braking poor` };
  if (r.wx === "pellets") return { tone: "a", label: "PL", src: s, dashed: r.wxOverlay, detail: `ice pellets (${tag(s)}) — contaminated runway` };
  if (r.wx === "snow" && (r.tempC == null || r.tempC <= SNOW_DEICE_C)) {
    const cm = r.snowCm != null && r.snowCm > 0 ? `${s === "model" ? ", " : "; model "}${r.snowCm.toFixed(1)} cm/h` : "";
    return { tone: "a", label: "SNOW", src: s, dashed: r.wxOverlay, detail: `snow (${tag(s)}${cm}) — contaminated runway, clearing ops` };
  }
  const heavy = r.wx === "heavyrain" || r.wx === "thunder" || (r.precipMm != null && r.precipMm >= HEAVY_RAIN_MM && s === "model");
  if (heavy && (r.tempC == null || r.tempC > 0)) {
    return { tone: "a", label: "WATER", src: s, dashed: r.wxOverlay || s === "model",
      detail: `${r.precipMm != null && r.precipMm >= HEAVY_RAIN_MM ? `${r.precipMm.toFixed(1)} mm/h (model)` : `${WX_WORD[r.wx]} (${tag(s)})`} — standing water, hydroplaning risk` };
  }
  // Refreeze: the air falls to ≤ 0 °C within the lookback of precipitation that fell above freezing.
  if (r.wx === "none" && r.tempC != null && r.tempC <= 0) {
    const wet = prior.filter((p) => p.t >= r.t - REFREEZE_LOOKBACK_H * H && p.t < r.t)
      .some((p) => p.tempC != null && p.tempC > 0 && ((p.precipMm ?? 0) >= REFREEZE_MIN_PRECIP_MM || ["rain", "showers", "drizzle", "heavyrain"].includes(p.wx)));
    if (wet) return { tone: "a", label: "REFREEZE", src: "model", dashed: true,
      detail: `temperature falls to ${Math.round(r.tempC)} °C after precipitation (model) — wet surfaces refreeze, black ice risk` };
  }
  return null;
}

function icingCell(r: HourRead, elevM: number | null, nowMs: number, groups: TafIcingGroup[]): Cell {
  // The military TAF's own icing group wins where it speaks.
  const g = groups.filter((x) => x.fromMs < r.t + H && x.toMs > r.t && x.baseFtAgl <= 10_000)
    .sort((a, b) => ({ severe: 3, moderate: 2, light: 1, trace: 0 }[b.intensity] - { severe: 3, moderate: 2, light: 1, trace: 0 }[a.intensity]))[0];
  if (g && g.intensity !== "trace") {
    const band = `${g.baseFtAgl.toLocaleString("en-US")}${g.topFtAgl != null ? `–${g.topFtAgl.toLocaleString("en-US")}` : "+"} ft AGL`;
    return { tone: g.intensity === "light" ? "i" : "a", label: `${g.intensity === "severe" ? "SEV" : g.intensity === "moderate" ? "MOD" : "LGT"} ICE`, src: "taf",
      dashed: /TEMPO|PROB/.test(g.change),
      detail: `${g.intensity} ${g.type ?? "icing"} ${band} (TAF group ${g.code})` };
  }
  const m = r.model;
  if (!m || elevM == null) return null;
  const conducive = m.levels
    .map((l) => ({ agl: (l.heightM - elevM) * M_TO_FT, p: l.tempC > 0 || l.tempC < -20 ? null : l.rh >= 95 && l.tempC >= -15 ? "likely" as const : l.rh >= 85 ? "possible" as const : null }))
    .filter((x) => x.p && x.agl >= 0 && x.agl <= 10_000);
  const best = conducive.some((x) => x.p === "likely") ? "likely" : conducive.length ? "possible" : null;
  // The band is bounded by the levels that earn its label (lib/icingSignals' rule).
  const band = conducive.filter((x) => x.p === best).map((x) => x.agl);
  const base = band.length ? Math.min(...band) : 0, top = band.length ? Math.max(...band) : 0;
  if (!best) return null;
  const r100 = (x: number) => Math.round(x / 100) * 100;
  // One model level earns the label → "near 900 ft", never "900–900 ft".
  const bandTxt = r100(base) === r100(top) ? `near ${r100(base).toLocaleString("en-US")} ft AGL`
    : `${r100(base).toLocaleString("en-US")}–${r100(top).toLocaleString("en-US")} ft AGL`;
  const tone: Tone = best === "likely" && r.t < nowMs + ICING_AMBER_H * H ? "a" : "i";
  return { tone, label: best === "likely" ? "ICE likely" : "ICE poss.", src: "model", dashed: true,
    detail: `icing ${best} ${bandTxt} (model, planning-grade — conducive, not reported)` };
}

function xwindCell(r: HourRead, ends: ReturnType<typeof runwayEnds>, contaminated: boolean): Cell {
  if (r.windKt == null) return null;
  const s = srcOf(r, "wind");
  if (r.windVariable || r.windKt === 0) return null;
  const be = bestEnd(ends, r.windDir, r.windKt, r.gustKt);
  if (!be) return null;
  const x = `${be.crossKt}${be.gustCrossKt ? `G${be.gustCrossKt}` : ""}`;
  let tone: Tone = be.flag === "r" ? "r" : be.flag === "a" ? "a" : "g";
  const onContam = contaminated && (be.crossKt >= CONTAM_X_KT || (be.gustCrossKt ?? 0) >= CONTAM_GX_KT);
  if (onContam && tone === "g") tone = "a";
  if (tone === "g" && be.crossKt < 10 && (be.gustCrossKt ?? 0) < 15) return null; // light crosswind is not a factor
  return { tone, label: `${x} R${be.ident}`, src: s, dashed: s === "model",
    detail: `crosswind ${x} kt on RWY ${be.ident} (best end, ${tag(s)})${be.headKt < 0 ? ` · TAILWIND ${-be.headKt} kt` : ""}${onContam ? " on a contaminated runway — usable crosswind is lower" : ""}` };
}

/** Wind chill (°C) from the air temperature and the wind (kt) — the NWS / MSC formula, valid ≤ 10 °C and ≥ 3 mph. */
export function windChillC(tempC: number, windKt: number): number {
  const v = windKt * 1.852; // km/h
  if (tempC > 10 || v < 4.8) return tempC;
  const p = Math.pow(v, 0.16);
  return Math.round((13.12 + 0.6215 * tempC - 11.37 * p + 0.3965 * tempC * p) * 10) / 10;
}

function rampCell(r: HourRead): Cell {
  const s = srcOf(r, "wx");
  if (r.wx === "thunder" || r.wx === "hail") {
    return { tone: "a", label: "LIGHTNING", src: s, dashed: r.wxOverlay || s === "model",
      detail: `thunderstorms (${tag(s)}) — expect lightning holds on the ramp, refuelling and loading (local radius policy)` };
  }
  if (r.gustKt != null && r.gustKt >= RAMP_GUST_KT) {
    return { tone: "a", label: `G${r.gustKt}`, src: srcOf(r, "wind"), dashed: srcOf(r, "wind") === "model",
      detail: `gusts ${r.gustKt} kt (${tag(srcOf(r, "wind"))}) — check door, stair, stand and refuel wind limits` };
  }
  const chill = r.tempC != null && r.windKt != null ? windChillC(r.tempC, r.windKt) : r.feelsC;
  if (chill != null && chill <= WINDCHILL_FROSTBITE_C) {
    return { tone: "a", label: `WC ${Math.round(chill)}°`, src: "model", dashed: true,
      detail: `wind chill ${Math.round(chill)} °C (model) — frostbite on exposed skin in about 30 min; work/rest and cold-weather gear` };
  }
  if (chill != null && chill <= WINDCHILL_COLD_C) {
    return { tone: "i", label: `WC ${Math.round(chill)}°`, src: "model", dashed: true,
      detail: `wind chill ${Math.round(chill)} °C (model) — cold-weather gear, limit exposure` };
  }
  const feels = r.feelsC;
  if (feels != null && feels >= HEAT_HOT_C) {
    return { tone: "a", label: `HEAT ${Math.round(feels)}°`, src: "model", dashed: true,
      detail: `feels like ${Math.round(feels)} °C (model) — heat stress; work/rest and water` };
  }
  if (feels != null && feels >= HEAT_WARM_C) {
    return { tone: "i", label: `${Math.round(feels)}°`, src: "model", dashed: true, detail: `feels like ${Math.round(feels)} °C (model) — heat precautions` };
  }
  return null;
}

// ── Assembly ─────────────────────────────────────────────────────────────

export interface TimelineInputs {
  nowMs: number;
  lat: number;
  lon: number;
  /** Field elevation in metres (the model's, used for the icing band). */
  elevationM: number | null;
  hours: ProfileHour[] | null;
  taf: TafPeriod[] | null;
  tafGroups?: TafIcingGroup[] | null;
  runways: { leIdent: string; heIdent: string; leHeadingDegT: number | null; heHeadingDegT: number | null }[];
  horizonH?: number;
}

const sameCell = (a: TlSeg, b: NonNullable<Cell>) =>
  a.tone === b.tone && a.label === b.label && Boolean(a.dashed) === Boolean(b.dashed) && a.src === b.src;

/** Hourly cells → segments (consecutive identical cells merge). */
function toSegs(cells: Cell[], start: number): TlSeg[] {
  const out: TlSeg[] = [];
  cells.forEach((c, k) => {
    if (!c) return;
    const from = start + k * H;
    const last = out[out.length - 1];
    if (last && last.toMs === from && sameCell(last, c)) { last.toMs = from + H; return; }
    out.push({ ...c, fromMs: from, toMs: from + H });
  });
  return out;
}

const hhZ = (ms: number) => `${String(new Date(ms).getUTCHours()).padStart(2, "0")}Z`;
const dow = (ms: number) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(ms).getUTCDay()];
/** "Tue 26 04Z–11Z" (a second day name when it crosses midnight). */
export function rangeLabel(fromMs: number, toMs: number): string {
  const d1 = `${dow(fromMs)} ${String(new Date(fromMs).getUTCDate()).padStart(2, "0")}`;
  const sameDay = new Date(fromMs).getUTCDate() === new Date(toMs - 1).getUTCDate();
  const d2 = sameDay ? "" : `${dow(toMs)} ${String(new Date(toMs).getUTCDate()).padStart(2, "0")} `;
  return `${d1} ${hhZ(fromMs)}–${d2}${hhZ(toMs)}`;
}

const LANE_TITLE: Record<LaneKey, string> = {
  sky: "Sky", precip: "Precip", deice: "Ground ice", runway: "Runway", icing: "Icing aloft", xwind: "Crosswind", ramp: "Ramp / crew", notam: "NOTAMs",
};
/** Lane order in a limiting window's factor list (what limits first). */
const FACTOR_ORDER: LaneKey[] = ["notam", "runway", "deice", "sky", "xwind", "icing", "ramp", "precip"];

/** Which of a lane's segments names the window: freezing beats frozen beats wet, LIFR beats IFR. */
export function labelSeverity(label: string): number {
  const l = label.toUpperCase();
  if (/^(ICE|DE\/ANTI-ICE|LIFR|SEV ICE)$/.test(l)) return 9;
  if (/^(PL|GLAZE|LIGHTNING|MOD ICE)$/.test(l)) return 8;
  if (/^(SNOW|DE-ICE|IFR|LIFR VIS)$/.test(l)) return 7;
  if (/^(REFREEZE|FZFG|IFR VIS|ICE LIKELY)$/.test(l) || /^(HEAT|WC) /.test(l)) return 6;
  if (/^(WATER|G\d)/.test(l)) return 5;
  return 0;
}

/** "Thu 15Z–21Z" or "Thu 15Z–Fri 11Z" — a lane's span inside a window. */
function spanLabel(f: number, t: number): string {
  const same = new Date(f).getUTCDate() === new Date(t - 1).getUTCDate();
  return same ? `${dow(f)} ${hhZ(f)}–${hhZ(t)}` : `${dow(f)} ${hhZ(f)}–${dow(t)} ${hhZ(t)}`;
}

/** Amber / red segments across all lanes → merged limiting windows (overlapping
 *  or touching). ONE factor per lane per window: its worst segment (red over
 *  amber, then the longest), with the hours that lane is limiting when it is
 *  not the whole window — a long window must not list every crosswind hour. */
export function limitingWindows(lanes: TlLane[]): LimitWindow[] {
  const hits = lanes.flatMap((l) => l.segs.filter((s) => s.tone === "a" || s.tone === "r").map((s) => ({ lane: l.key, s })))
    .sort((a, b) => a.s.fromMs - b.s.fromMs);
  const groups: { fromMs: number; toMs: number; hits: typeof hits }[] = [];
  for (const h of hits) {
    const last = groups[groups.length - 1];
    if (last && h.s.fromMs <= last.toMs) { last.toMs = Math.max(last.toMs, h.s.toMs); last.hits.push(h); }
    else groups.push({ fromMs: h.s.fromMs, toMs: h.s.toMs, hits: [h] });
  }
  return groups.map((g) => {
    const byLane = new Map<LaneKey, TlSeg[]>();
    for (const h of g.hits) byLane.set(h.lane, [...(byLane.get(h.lane) ?? []), h.s]);
    let factors = [...byLane.entries()].map(([lane, segs]) => {
      const worst = segs.slice().sort((a, b) => (a.tone === "r" ? 0 : 1) - (b.tone === "r" ? 0 : 1) || labelSeverity(b.label) - labelSeverity(a.label) || (b.toMs - b.fromMs) - (a.toMs - a.fromMs))[0];
      // The lane's own spans (merged), said only when they are not the whole window.
      const spans: { f: number; t: number }[] = [];
      for (const sg of segs.slice().sort((a, b) => a.fromMs - b.fromMs)) {
        const l = spans[spans.length - 1];
        if (l && sg.fromMs <= l.t) l.t = Math.max(l.t, sg.toMs); else spans.push({ f: sg.fromMs, t: sg.toMs });
      }
      const whole = spans.length === 1 && spans[0].f === g.fromMs && spans[0].t === g.toMs;
      const when = whole ? "" : ` [${spans.slice(0, 3).map((x) => spanLabel(x.f, x.t)).join(", ")}${spans.length > 3 ? ", …" : ""}]`;
      return { lane, label: worst.label, detail: `${worst.detail}${when}`, red: segs.some((x) => x.tone === "r") };
    });
    factors.sort((a, b) => FACTOR_ORDER.indexOf(a.lane) - FACTOR_ORDER.indexOf(b.lane));
    // The precip lane repeats what the impact lanes already say — keep it only when it is the only factor.
    if (factors.length > 1) factors = factors.filter((f) => f.lane !== "precip");
    const out: LimitWindow = {
      fromMs: g.fromMs, toMs: g.toMs, tone: factors.some((f) => f.red) ? "r" : "a",
      factors: factors.map(({ lane, label, detail }) => ({ lane, label, detail })), text: "",
    };
    out.text = `${rangeLabel(out.fromMs, out.toMs)} — ${out.factors.map((f) => `${LANE_TITLE[f.lane]}: ${f.detail}`).join("; ")}`;
    return out;
  });
}

export function opsTimeline(i: TimelineInputs): OpsTimeline {
  const n = i.horizonH ?? TIMELINE_HOURS;
  const start = Math.floor(i.nowMs / H) * H;
  const hours = readHours(i, start, n);
  const tafEndMs = (() => {
    const ends = (i.taf ?? []).map((p) => Date.parse(p.to)).filter(Number.isFinite);
    return ends.length ? Math.max(...ends) : null;
  })();
  const modelLive = (i.hours ?? []).some((h) => h.t + H > i.nowMs);
  const tafLive = tafEndMs != null && tafEndMs > i.nowMs;
  const light: OpsTimeline["light"] = [];
  for (let k = 0; k < n; k++) {
    const t = start + k * H;
    const alt = sunAltitude(t + H / 2, i.lat, i.lon);
    const state = alt > -0.833 ? "day" : alt > -6 ? "civil" : alt > -12 ? "nautical" : "night";
    const last = light[light.length - 1];
    if (last && last.state === state && last.toMs === t) last.toMs = t + H;
    else light.push({ fromMs: t, toMs: t + H, state });
  }

  if (!modelLive && !tafLive) {
    return { live: false, startMs: start, hours: n, tafEndMs, light, lanes: [], temps: [],
      temp: { minC: null, maxC: null, crossings: [] }, windows: [],
      summary: "72-h ops timeline UNKNOWN — neither the model profile nor a TAF answered", reason: "no model profile and no TAF" };
  }

  const ends = runwayEnds(i.runways);
  const groups = i.tafGroups ?? [];
  const sky = hours.map(skyCell);
  const precip = hours.map(precipCell);
  const deice = hours.map(deiceCell);
  const runway = hours.map((r, k) => runwayCell(r, hours.slice(0, k)));
  const icing = hours.map((r) => icingCell(r, i.elevationM, i.nowMs, groups));
  const xwind = hours.map((r, k) => {
    const rc = runway[k];
    return ends.length ? xwindCell(r, ends, Boolean(rc && rc.tone !== "g")) : null;
  });
  const ramp = hours.map(rampCell);

  const pastTaf = modelLive ? null : "beyond the TAF: UNKNOWN — the model profile did not answer";
  const lanes: TlLane[] = [
    { key: "sky", title: LANE_TITLE.sky, segs: toSegs(sky, start), unknown: pastTaf },
    { key: "precip", title: LANE_TITLE.precip, segs: toSegs(precip, start), unknown: pastTaf },
    { key: "deice", title: LANE_TITLE.deice, segs: toSegs(deice, start), unknown: modelLive ? null : "UNKNOWN — needs the model's temperature and dew point" },
    { key: "runway", title: LANE_TITLE.runway, segs: toSegs(runway, start), unknown: modelLive ? null : "UNKNOWN past the TAF — needs the model's temperature and precipitation" },
    { key: "icing", title: LANE_TITLE.icing, segs: toSegs(icing, start), unknown: modelLive && i.elevationM != null ? null : groups.length ? "model profile did not answer — TAF icing groups only" : "UNKNOWN — the model profile did not answer" },
    { key: "xwind", title: LANE_TITLE.xwind, segs: toSegs(xwind, start), unknown: ends.length ? (modelLive ? null : pastTaf) : "UNKNOWN — runway headings not available" },
    { key: "ramp", title: LANE_TITLE.ramp, segs: toSegs(ramp, start), unknown: modelLive ? null : "UNKNOWN — needs the model's temperature and wind" },
  ];

  const temps: TlTempPoint[] = hours.map((r) => ({
    t: r.t,
    c: r.tempC != null ? Math.round(r.tempC * 10) / 10 : null,
    dew: r.dewC != null ? Math.round(r.dewC * 10) / 10 : null,
    feels: r.feelsC != null ? Math.round(r.feelsC * 10) / 10 : null,
    fzlFtAgl: r.model?.freezingLevelM != null && i.elevationM != null ? Math.max(0, Math.round(((r.model.freezingLevelM - i.elevationM) * M_TO_FT) / 100) * 100) : null,
  }));
  const tv = temps.map((p) => p.c).filter((c): c is number => c != null);
  const crossings: OpsTimeline["temp"]["crossings"] = [];
  for (let k = 1; k < temps.length; k++) {
    const a = temps[k - 1].c, b = temps[k].c;
    if (a == null || b == null) continue;
    if (a > 0 && b <= 0) crossings.push({ t: temps[k].t, dir: "down" });
    else if (a <= 0 && b > 0) crossings.push({ t: temps[k].t, dir: "up" });
  }

  const windows = limitingWindows(lanes);
  const first = windows[0];
  const summary = windows.length
    ? `Next 72 h: ${windows.length} limiting window${windows.length === 1 ? "" : "s"} — first ${rangeLabel(first.fromMs, first.toMs)}: ${first.factors.slice(0, 3).map((f) => f.label).join(" · ")}`
    : `Next 72 h: no limiting window — no freezing or frozen precipitation, ground or airframe icing, contaminated runway, TAF IFR, crosswind beyond the bands or ramp limits (${modelLive ? "model planning-grade; the TAF governs its window" : "TAF only — the model did not answer"})`;

  return {
    live: true, startMs: start, hours: n, tafEndMs, light, lanes, temps,
    temp: { minC: tv.length ? Math.round(Math.min(...tv)) : null, maxC: tv.length ? Math.round(Math.max(...tv)) : null, crossings },
    windows, summary, reason: null,
  };
}

/** One line per limiting window for the Commander's Read, the markdown and the export. */
export function timelineLines(t: OpsTimeline | null | undefined, max = 6): string[] {
  if (!t) return [];
  if (!t.live) return [t.summary];
  if (!t.windows.length) return [t.summary];
  return t.windows.slice(0, max).map((w) => `${w.tone === "r" ? "[RED] " : ""}${w.text}`);
}

// ── NOTAM closures on the same axis ──────────────────────────────────────
// The closure windows come from lib/sitrepSignals' closureWindows (the Ops
// card's own read, computed where the payload is). A closure or an outage is
// a published LIMIT, amber here (the Ops card's closure timeline keeps its own
// red bar and the runway-count judgement); a published schedule that could
// not be read is UNKNOWN and joins no window; "limited" is a note.

export interface ClosureLike { fromMs: number; toMs: number; kind: "closure" | "unserviceable" | "limited"; label: string; text: string; indeterminate?: boolean }

/** Parking (apron, hardstands, shelters, stands) closed is a capacity NOTE,
 *  never a launch-or-recovery limit — three days of closed shelters made a
 *  three-day "limiting window" (ETAD, 2026-11-26) and taught the band to be
 *  ignored. MOG is the commander's LIMFAC to enter, not a guess from here. */
export const PARKING_LABELS = new Set(["Ramp / apron", "Parking", "Parking / HAS"]);

/** The NOTAM number, when the text carries one ("L0076/26"). */
function notamNumber(text: string): string | null {
  return text.match(/\b([A-Z]\d{4}\/\d{2})\b/)?.[1] ?? null;
}

/** The NOTAM text as read, without its number / series header and without
 *  repeating the label it already starts with. */
function notamBody(label: string, text: string): string {
  let t = text.trim().replace(/\s+/g, " ").replace(/^(?:[A-Z]\d{4}\/\d{2}\s+)?(?:NOTAM[NRC]\s+)?(?:E\)\s*)?/, "");
  const stem = label.replace(/…$/, "").trim();
  if (stem.length >= 6 && t.toUpperCase().startsWith(stem.toUpperCase())) t = t.slice(stem.length).replace(/^[\s.:,–-]+/, "");
  return t.length > 140 ? `${t.slice(0, 139)}…` : t;
}

export function notamLane(closures: ClosureLike[], startMs: number, hours = TIMELINE_HOURS): TlLane {
  const end = startMs + hours * H;
  const segs: TlSeg[] = closures
    .filter((w) => w.toMs > startMs && w.fromMs < end)
    .map((w) => {
      const parking = PARKING_LABELS.has(w.label);
      const verb = w.kind === "closure" ? "closed" : w.kind === "unserviceable" ? "unserviceable" : "limited";
      const num = notamNumber(w.text);
      const body = notamBody(w.label, w.text);
      return {
        fromMs: Math.max(w.fromMs, startMs), toMs: Math.min(w.toMs, end),
        tone: w.indeterminate ? "u" as const : w.kind === "limited" || parking ? "i" as const : "a" as const,
        label: w.indeterminate ? "SCHED" : `${w.label} ${w.kind === "closure" ? "CLSD" : w.kind === "unserviceable" ? "U/S" : "LTD"}`,
        short: w.indeterminate ? "SCHED" : w.kind === "closure" ? "CLSD" : w.kind === "unserviceable" ? "U/S" : "LTD",
        detail: w.indeterminate
          ? `${w.label}: schedule published, times not readable — read the NOTAM${num ? ` ${num}` : ""}`
          : `${w.label} ${verb}${num ? ` (NOTAM ${num})` : " (NOTAM)"}${parking ? " — parking capacity, not a launch or recovery limit" : ""}${body ? `: ${body}` : ""}`,
        dashed: Boolean(w.indeterminate),
        src: "taf" as const,
      };
    })
    .sort((a, b) => a.fromMs - b.fromMs);
  return { key: "notam", title: LANE_TITLE.notam, segs, unknown: null };
}

export const MAX_LANE_ROWS = 3;

/** Overlapping bars (several NOTAMs at once) get a row each, up to
 *  MAX_LANE_ROWS; a bar past that shares the row that frees first and carries no
 *  label — the readout lists every one. Bars arrive sorted by start. */
export function packRows(segs: { fromMs: number; toMs: number }[]): { row: number; over: boolean }[] {
  const ends: number[] = [];
  return segs.map((s) => {
    let r = ends.findIndex((e) => e <= s.fromMs);
    let over = false;
    if (r < 0) {
      if (ends.length < MAX_LANE_ROWS) { r = ends.length; ends.push(0); }
      else { r = ends.indexOf(Math.min(...ends)); over = true; }
    }
    ends[r] = Math.max(ends[r], s.toMs);
    return { row: r, over };
  });
}

/** The timeline's windows recomputed with the NOTAM lane folded in. */
export function windowsWithNotams(t: OpsTimeline, closures: ClosureLike[]): { lane: TlLane; windows: LimitWindow[] } {
  const lane = notamLane(closures, t.startMs, t.hours);
  return { lane, windows: t.live ? limitingWindows([...t.lanes, lane]) : [] };
}

// ── Scrubbing: one hour, every lane (the readout under the cursor) ───────

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Fri 27 Nov · 0515Z" — the scrub cursor's date-time, always Zulu. */
export function zuluStamp(ms: number, withMonth = true): string {
  const d = new Date(ms);
  const day = `${dow(ms)} ${String(d.getUTCDate()).padStart(2, "0")}${withMonth ? ` ${MON[d.getUTCMonth()]}` : ""}`;
  return `${day} · ${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
}

/** "16 h", "1 d 4 h", "40 min". */
export function spanText(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h`;
}

export type SliceTone = Tone | "n";
export interface SliceRow { key: LaneKey | "temp"; title: string; tone: SliceTone; label: string; text: string;
  /** Several bars in effect at once (NOTAMs): each one, worst first. */
  items?: { tone: SliceTone; text: string }[] }
export interface TimelineSlice {
  ms: number;
  stamp: string;
  /** Does the TAF govern this hour, or is it model only? */
  src: "taf" | "model";
  rows: SliceRow[];
  /** The limiting window the hour is in, and how long until it clears. */
  window: { index: number; tone: "a" | "r"; toMs: number; leftMs: number } | null;
  /** The next window when outside one. */
  next: { index: number; fromMs: number; inMs: number } | null;
}

/** Every lane's value at one instant — the scrub readout. A lane with nothing
 *  in the hour reads "nothing limiting" (tone n) unless it is UNKNOWN there,
 *  which is said as UNKNOWN, never as clear. */
export function sliceAt(t: OpsTimeline, extra: TlLane[], windows: LimitWindow[], ms: number): TimelineSlice | null {
  if (!t.live) return null;
  const end = t.startMs + t.hours * H;
  const at = Math.min(end - 1, Math.max(t.startMs, ms));
  const inTaf = t.tafEndMs != null && at < t.tafEndMs;
  const rows: SliceRow[] = [];
  const laneRow = (l: TlLane): SliceRow => {
    const here = l.segs.filter((x) => at >= x.fromMs && at < x.toMs);
    // Several NOTAMs in effect at once: every one is read, worst first.
    if (here.length > 1) {
      const sorted = [...here].sort((a, b) => TONE_RANK[b.tone] - TONE_RANK[a.tone]);
      return { key: l.key, title: l.title, tone: sorted[0].tone, label: `${here.length} in effect`, text: sorted.map((x) => x.detail).join(" · "),
        items: sorted.map((x) => ({ tone: x.tone, text: x.detail })) };
    }
    const s = here[0];
    if (s) return { key: l.key, title: l.title, tone: s.tone, label: s.label, text: s.detail };
    // A lane UNKNOWN only past the TAF is readable inside it.
    const unknownHere = l.unknown != null && !(inTaf && /^beyond the TAF/.test(l.unknown));
    if (unknownHere) return { key: l.key, title: l.title, tone: "u", label: "UNKNOWN", text: l.unknown! };
    return { key: l.key, title: l.title, tone: "n", label: "—", text: l.key === "notam" ? "no closure in effect" : "nothing limiting" };
  };
  const lanes = [...t.lanes, ...extra];
  for (const l of lanes.filter((x) => x.key === "sky" || x.key === "precip")) rows.push(laneRow(l));
  const p = t.temps[Math.min(t.temps.length - 1, Math.floor((at - t.startMs) / H))];
  if (p && p.c != null) {
    const parts = [`${Math.round(p.c)} °C`];
    if (p.dew != null) parts.push(`dew ${Math.round(p.dew)}`);
    if (p.feels != null && Math.round(p.feels) !== Math.round(p.c)) parts.push(`feels ${Math.round(p.feels)}`);
    if (p.fzlFtAgl != null) parts.push(p.fzlFtAgl === 0 ? "0 °C at the surface" : `0 °C at ${p.fzlFtAgl.toLocaleString("en-US")} ft AGL`);
    rows.push({ key: "temp", title: "Temp", tone: p.c <= 0 ? "i" : "n", label: `${Math.round(p.c)}°`, text: `${parts.join(" · ")} (model)` });
  } else {
    rows.push({ key: "temp", title: "Temp", tone: "u", label: "UNKNOWN", text: "UNKNOWN — the model profile did not answer" });
  }
  for (const l of lanes.filter((x) => x.key !== "sky" && x.key !== "precip")) rows.push(laneRow(l));
  const wi = windows.findIndex((w) => at >= w.fromMs && at < w.toMs);
  const nx = wi < 0 ? windows.findIndex((w) => w.fromMs > at) : -1;
  return {
    ms: at, stamp: zuluStamp(at), src: inTaf ? "taf" : "model", rows,
    window: wi >= 0 ? { index: wi, tone: windows[wi].tone, toMs: windows[wi].toMs, leftMs: windows[wi].toMs - at } : null,
    next: nx >= 0 ? { index: nx, fromMs: windows[nx].fromMs, inMs: windows[nx].fromMs - at } : null,
  };
}

/** Every instant something changes — a bar starts or ends, or the air crosses 0 °C — for stepping the cursor. */
export function changePoints(t: OpsTimeline, extra: TlLane[] = []): number[] {
  const end = t.startMs + t.hours * H;
  const set = new Set<number>();
  for (const l of [...t.lanes, ...extra]) for (const s of l.segs) { set.add(s.fromMs); set.add(s.toMs); }
  for (const c of t.temp.crossings) set.add(c.t);
  return [...set].filter((x) => x > t.startMs && x < end).sort((a, b) => a - b);
}

/** The windows as a compact band for an airfield card: fractions of the 72 h. */
export interface WindowBand { startMs: number; hours: number; live: boolean; windows: { fromMs: number; toMs: number; tone: "a" | "r"; label: string }[] }
export function windowBand(t: OpsTimeline | null | undefined, windows: LimitWindow[]): WindowBand | null {
  if (!t) return null;
  return {
    startMs: t.startMs, hours: t.hours, live: t.live,
    windows: windows.map((w) => ({ fromMs: w.fromMs, toMs: w.toMs, tone: w.tone, label: `${rangeLabel(w.fromMs, w.toMs)} — ${w.factors.slice(0, 3).map((f) => f.label).join(" · ")}` })),
  };
}
