// Decoders for the NWS Aviation Weather Center JSON API into the plain-English
// MetarObs / TafReport shapes the Weather tab renders. AWC already returns
// parsed fields, so this is mostly normalisation + flight-category derivation
// + building a readable summary. All pure functions — no I/O here.

import type { FlightCategory, MetarObs, TafReport, TafPeriod } from "./types";

// ── flight category from ceiling (ft AGL) + visibility (statute miles) ──
export function flightCategory(ceilingFt: number | null, visibilityMi: number | null): FlightCategory {
  const c = ceilingFt ?? Infinity;
  const v = visibilityMi ?? Infinity;
  if (c < 500 || v < 1) return "LIFR";
  if (c < 1000 || v < 3) return "IFR";
  if (c <= 3000 || v <= 5) return "MVFR";
  if (ceilingFt === null && visibilityMi === null) return "UNKNOWN";
  return "VFR";
}

const CLOUD_COVER: Record<string, string> = {
  SKC: "sky clear", CLR: "clear", NSC: "no significant cloud", NCD: "no cloud detected",
  FEW: "few clouds", SCT: "scattered clouds", BKN: "broken clouds", OVC: "overcast",
  OVX: "obscured", VV: "vertical visibility",
};

const CEILING_COVERS = new Set(["BKN", "OVC", "OVX", "VV"]);

// Present-weather token decoding (intensity/descriptor/phenomena).
const WX_INTENSITY: Record<string, string> = { "-": "light", "+": "heavy" };
const WX_DESCRIPTOR: Record<string, string> = {
  MI: "shallow", PR: "partial", BC: "patches of", DR: "low drifting", BL: "blowing",
  SH: "showers of", TS: "thunderstorm", FZ: "freezing",
};
const WX_PHENOMENA: Record<string, string> = {
  DZ: "drizzle", RA: "rain", SN: "snow", SG: "snow grains", IC: "ice crystals",
  PL: "ice pellets", GR: "hail", GS: "small hail", UP: "unknown precip",
  BR: "mist", FG: "fog", FU: "smoke", VA: "volcanic ash", DU: "dust", SA: "sand",
  HZ: "haze", PY: "spray", PO: "dust whirls", SQ: "squalls", FC: "funnel cloud",
  SS: "sandstorm", DS: "duststorm", TS: "thunderstorm", SH: "showers",
};

// Decode a raw present-weather group like "-SHRA" or "+TSRA" or "VCSH".
function decodeWxToken(tok: string): string {
  let t = tok.trim();
  if (!t) return "";
  const parts: string[] = [];
  if (t.startsWith("VC")) { parts.push("nearby"); t = t.slice(2); }
  let intensity = "";
  if (t[0] === "-" || t[0] === "+") { intensity = WX_INTENSITY[t[0]]; t = t.slice(1); }
  else if (t.startsWith("RE")) { parts.push("recent"); t = t.slice(2); }
  const words: string[] = [];
  for (let i = 0; i + 2 <= t.length; i += 2) {
    const code = t.slice(i, i + 2);
    if (WX_DESCRIPTOR[code]) words.push(WX_DESCRIPTOR[code]);
    else if (WX_PHENOMENA[code]) words.push(WX_PHENOMENA[code]);
  }
  const phrase = [intensity, ...words].filter(Boolean).join(" ");
  return [...parts, phrase].filter(Boolean).join(" ").trim();
}

export function decodeWeatherString(wxString: string | null | undefined): string {
  if (!wxString) return "";
  return wxString.trim().split(/\s+/).map(decodeWxToken).filter(Boolean).join(", ");
}

// hPa→inHg if the source reports altimeter in millibars; pass through inHg.
function normalizeAltimeter(altim: number | null): number | null {
  if (altim == null || !Number.isFinite(altim)) return null;
  if (altim > 100) return Math.round(altim * 0.0295299831 * 100) / 100; // hPa → inHg
  return Math.round(altim * 100) / 100;
}

// AWC visibility can be a number (mi) or strings like "10+", "1/2", "1 1/2", "6+".
function parseVisibility(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace("+", "").trim();
  if (!s) return null;
  let total = 0;
  let ok = false;
  for (const part of s.split(/\s+/)) {
    if (!part) continue;
    if (part.includes("/")) {
      const [a, b] = part.split("/").map(Number);
      if (Number.isFinite(a) && b) { total += a / b; ok = true; }
    } else {
      const n = Number(part);
      if (Number.isFinite(n)) { total += n; ok = true; }
    }
  }
  return ok ? total : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function cToF(c: number): number {
  return Math.round((c * 9) / 5 + 32);
}

interface AwcCloud { cover?: string; base?: number | null }

function lowestCeiling(clouds: AwcCloud[]): number | null {
  let ceil: number | null = null;
  for (const c of clouds) {
    if (c.cover && CEILING_COVERS.has(c.cover) && typeof c.base === "number") {
      if (ceil === null || c.base < ceil) ceil = c.base;
    }
  }
  return ceil;
}

function windPhrase(dir: number | null, variable: boolean, spd: number | null, gust: number | null): string {
  if (spd === 0 || spd === null) return "calm winds";
  const from = variable ? "variable" : dir === null ? "variable" : `${String(dir).padStart(3, "0")}°`;
  let s = `winds ${from} at ${spd} kt`;
  if (gust) s += ` gusting ${gust} kt`;
  return s;
}

interface AwcMetar {
  icaoId?: string; name?: string; rawOb?: string; obsTime?: number;
  temp?: number | null; dewp?: number | null; wdir?: number | string | null;
  wspd?: number | null; wgst?: number | null; visib?: number | string | null;
  altim?: number | null; presTend?: number | null; wxString?: string | null; clouds?: AwcCloud[];
}

export function decodeMetar(m: AwcMetar): MetarObs {
  const clouds = (m.clouds ?? []).map((c) => ({ cover: c.cover ?? "", baseFt: num(c.base) }));
  const ceilingFt = lowestCeiling(m.clouds ?? []);
  const visibilityMi = parseVisibility(m.visib);
  const wdirRaw = m.wdir;
  const windDir = typeof wdirRaw === "number" ? wdirRaw : null;
  const windSpeedKt = num(m.wspd);
  const windGustKt = num(m.wgst);
  const tempC = num(m.temp);
  const dewpointC = num(m.dewp);
  const altimeterInHg = normalizeAltimeter(num(m.altim));
  const weather = decodeWeatherString(m.wxString);
  const cat = flightCategory(ceilingFt, visibilityMi);

  const skyPhrase = clouds.length === 0
    ? "no cloud layers reported"
    : clouds.map((c) => `${CLOUD_COVER[c.cover] ?? c.cover}${c.baseFt != null ? ` at ${c.baseFt.toLocaleString()} ft` : ""}`).join(", ");

  const bits: string[] = [];
  bits.push(`${cat}.`);
  bits.push(windPhrase(windDir, wdirRaw === "VRB", windSpeedKt, windGustKt) + ".");
  if (visibilityMi != null) bits.push(`Visibility ${visibilityMi >= 10 ? "10+" : visibilityMi} mi.`);
  if (weather) bits.push(`${weather.charAt(0).toUpperCase()}${weather.slice(1)}.`);
  bits.push(`${skyPhrase.charAt(0).toUpperCase()}${skyPhrase.slice(1)}.`);
  if (tempC != null) bits.push(`Temp ${cToF(tempC)}°F (${tempC}°C)${dewpointC != null ? `, dewpoint ${cToF(dewpointC)}°F` : ""}.`);
  if (altimeterInHg != null) bits.push(`Altimeter ${altimeterInHg.toFixed(2)} inHg.`);

  return {
    icao: m.icaoId ?? "",
    name: m.name ?? "",
    observedAt: m.obsTime ? new Date(m.obsTime * 1000).toISOString() : "",
    raw: m.rawOb ?? "",
    flightCategory: cat,
    windDir, windVariable: wdirRaw === "VRB",
    windSpeedKt, windGustKt,
    visibilityMi, ceilingFt, tempC, dewpointC, altimeterInHg,
    pressureTendency: num(m.presTend),
    weather, clouds,
    summary: bits.join(" "),
  };
}

interface AwcTafPeriod {
  timeFrom?: number; timeTo?: number; fcstChange?: string | null;
  wdir?: number | string | null; wspd?: number | null; wgst?: number | null;
  visib?: number | string | null; wxString?: string | null; clouds?: AwcCloud[];
}
interface AwcTaf {
  icaoId?: string; rawTAF?: string; issueTime?: number | string; fcsts?: AwcTafPeriod[];
}

export function decodeTaf(t: AwcTaf): TafReport {
  const periods: TafPeriod[] = (t.fcsts ?? []).map((p) => {
    const ceilingFt = lowestCeiling(p.clouds ?? []);
    const visibilityMi = parseVisibility(p.visib);
    const windDir = typeof p.wdir === "number" ? p.wdir : null;
    const windSpeedKt = num(p.wspd);
    const weather = decodeWeatherString(p.wxString);
    const cat = flightCategory(ceilingFt, visibilityMi);
    const bits = [windPhrase(windDir, p.wdir === "VRB", windSpeedKt, num(p.wgst))];
    if (visibilityMi != null) bits.push(`vis ${visibilityMi >= 10 ? "10+" : visibilityMi} mi`);
    if (weather) bits.push(weather);
    if (ceilingFt != null) bits.push(`ceiling ${ceilingFt.toLocaleString()} ft`);
    return {
      from: p.timeFrom ? new Date(p.timeFrom * 1000).toISOString() : "",
      to: p.timeTo ? new Date(p.timeTo * 1000).toISOString() : "",
      changeType: p.fcstChange ?? "",
      flightCategory: cat,
      summary: bits.join(", "),
    };
  });
  const issued = typeof t.issueTime === "number"
    ? new Date(t.issueTime * 1000).toISOString()
    : typeof t.issueTime === "string" ? t.issueTime : "";
  return { icao: t.icaoId ?? "", issuedAt: issued, raw: t.rawTAF ?? "", periods };
}
