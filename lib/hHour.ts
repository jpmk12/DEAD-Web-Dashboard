// H-hour considerations — PURE, client-safe, tested (tests/hHour.test.ts).
//
// Given ONE instant (H, or any offset from it) at ONE place, what a planner
// should know: the light (sun state, the moon's altitude and illumination,
// the night's budget), the forecast hour that contains the instant, the TAF
// period that covers it, the NOTAM windows in effect, the host nation's
// posture and holidays, and the space-weather outlook for that day — and a
// ranked list of the ones that matter. Every source is optional and a
// missing one is said (UNKNOWN), never read as clear. The server route
// (app/api/tools/hhour) gathers the inputs; this file does the reading.

import { sunAltitude, moonAltitudeTopo, moonPhase, MOON_USEFUL_ALT_DEG, type LunarNight } from "./moon";
import type { HourlyForecast } from "./currentConditions";
import type { TafPeriod, FlightCategory } from "./types";
import { CAT_RANK } from "./aviationWx";
import type { ClosureWindow } from "./sitrepSignals";
import { localIsoToMs } from "./lunarCloud";
import type { ScaleDay } from "./spaceWeatherOps";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ── Light ───────────────────────────────────────────────────────────────────

export type SunState = "day" | "civil" | "nautical" | "night";

export interface LightAt {
  sun: SunState;
  sunAltDeg: number;
  moonUp: boolean;
  moonAltDeg: number;
  /** Moon ≥ MOON_USEFUL_ALT_DEG — lighting the ground, not sitting on the horizon. */
  moonUseful: boolean;
  illumPct: number;
  phaseName: string;
  waxing: boolean;
}

/** Sun state by altitude: day above −0.833° (the disc's upper limb), civil
 *  twilight to −6°, nautical to −12° (the OPORD's EENT / BMNT line), night
 *  below. Moon up = topocentric altitude above the horizon. */
export function lightAt(ms: number, lat: number, lon: number): LightAt {
  const s = sunAltitude(ms, lat, lon);
  const m = moonAltitudeTopo(ms, lat, lon);
  const ph = moonPhase(ms);
  const sun: SunState = s > -0.833 ? "day" : s > -6 ? "civil" : s > -12 ? "nautical" : "night";
  return { sun, sunAltDeg: Math.round(s * 10) / 10, moonUp: m > 0, moonAltDeg: Math.round(m), moonUseful: m >= MOON_USEFUL_ALT_DEG, illumPct: ph.illumPct, phaseName: ph.phaseName, waxing: ph.waxing };
}

export const SUN_STATE_LABEL: Record<SunState, string> = { day: "daylight", civil: "civil twilight", nautical: "nautical twilight", night: "night" };

/** "0:45 before BMNT" / "2:10 after sunset" — the nearest light event within
 *  `withinH` hours of the instant, from the night's own times; null when none. */
export function nearestLightEvent(night: LunarNight, ms: number, withinH = 6): string | null {
  const ev: [string, number | null][] = [["sunset", night.sunset], ["EENT", night.eent], ["BMNT", night.bmnt], ["sunrise", night.sunrise]];
  let best: { name: string; d: number } | null = null;
  for (const [name, t] of ev) {
    if (t == null) continue;
    const d = ms - t;
    if (Math.abs(d) > withinH * HOUR_MS) continue;
    if (!best || Math.abs(d) < Math.abs(best.d)) best = { name, d };
  }
  if (!best) return null;
  const a = Math.abs(best.d);
  const h = Math.floor(a / HOUR_MS), mnt = Math.round((a % HOUR_MS) / 60_000);
  if (h === 0 && mnt === 0) return `at ${best.name}`;
  return `${h}:${String(mnt).padStart(2, "0")} ${best.d < 0 ? "before" : "after"} ${best.name}`;
}

/** The local calendar date whose NIGHT (local noon → next noon) contains the
 *  instant: the date itself from noon on, the day before until noon. */
export function nightDateFor(ms: number, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ms)).reduce<Record<string, string>>((a, p) => { if (p.type !== "literal") a[p.type] = p.value; return a; }, {});
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  if (hour >= 12) return ymd;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

// ── Forecast ────────────────────────────────────────────────────────────────

/** The hourly sample whose hour CONTAINS the instant (a sample stands for
 *  the hour that begins at its stamp). Null when the series does not cover it. */
export function forecastHourAt(hourly: HourlyForecast[], ms: number, zone: string): HourlyForecast | null {
  for (const h of hourly) {
    const t = localIsoToMs(h.time, zone);
    if (t == null) continue;
    if (ms >= t && ms < t + HOUR_MS) return h;
  }
  return null;
}

/** WMO weather code → a word. Deliberately its own small map (the icon
 *  vocabulary in lib/weatherIcon.tsx is a React module). */
export function wmoWord(code: number | null): string {
  if (code == null) return "—";
  if (code === 0) return "clear";
  if (code === 1) return "mainly clear";
  if (code === 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return code >= 66 ? "freezing rain" : "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain showers";
  if (code === 85 || code === 86) return "snow showers";
  if (code === 95) return "thunderstorm";
  if (code >= 96) return "thunderstorm with hail";
  return "—";
}

export function forecastLine(h: HourlyForecast): string {
  const parts = [wmoWord(h.weatherCode)];
  if (h.tempF != null) parts.push(`${h.tempF}°F`);
  if (h.windMph != null) parts.push(`wind ${h.windDir != null ? `${String(h.windDir).padStart(3, "0")}° ` : ""}${h.windMph} mph${h.gustMph != null && h.gustMph > h.windMph + 5 ? ` G${h.gustMph}` : ""}`);
  if (h.precipPct != null) parts.push(`precip ${h.precipPct}%`);
  if (h.cloudPct != null) parts.push(`cloud ${h.cloudPct}%`);
  if (h.visMi != null) parts.push(`vis ${h.visMi >= 6 ? "6+" : h.visMi} mi`);
  return parts.join(" · ");
}

// ── TAF ─────────────────────────────────────────────────────────────────────

export interface TafAt {
  cat: FlightCategory;
  /** The base period's line. */
  summary: string;
  /** A TEMPO / PROB overlapping the instant with a WORSE category, when any. */
  tempo: { changeType: string; cat: FlightCategory; summary: string } | null;
}

/** The TAF period covering the instant: the base period (FM / BECMG / the
 *  initial line) plus any TEMPO / PROB variation that overlaps it — the
 *  category is the WORSE of the two, because a planning read shows the
 *  risk. Null when no base period covers the instant (the TAF does not
 *  reach it). */
export function tafAt(periods: TafPeriod[], ms: number): TafAt | null {
  const covers = (p: TafPeriod) => { const f = Date.parse(p.from), t = Date.parse(p.to); return Number.isFinite(f) && Number.isFinite(t) && ms >= f && ms < t; };
  const base = periods.filter((p) => !/^(TEMPO|PROB)/i.test(p.changeType) && covers(p)).sort((a, b) => Date.parse(b.from) - Date.parse(a.from))[0];
  if (!base) return null;
  const tempos = periods.filter((p) => /^(TEMPO|PROB)/i.test(p.changeType) && covers(p));
  const worstTempo = tempos.sort((a, b) => CAT_RANK[b.flightCategory] - CAT_RANK[a.flightCategory])[0];
  const tempo = worstTempo && CAT_RANK[worstTempo.flightCategory] > CAT_RANK[base.flightCategory]
    ? { changeType: worstTempo.changeType, cat: worstTempo.flightCategory, summary: worstTempo.summary } : null;
  return { cat: tempo ? tempo.cat : base.flightCategory, summary: base.summary, tempo };
}

// ── NOTAM windows ───────────────────────────────────────────────────────────

/** Closure / outage windows in effect at the instant. An indeterminate
 *  schedule (present but unreadable) is included — the planner must see it. */
export function windowsAt(windows: ClosureWindow[], ms: number): ClosureWindow[] {
  return windows.filter((w) => w.indeterminate || (ms >= w.fromMs && ms < w.toMs));
}

// ── Space weather ───────────────────────────────────────────────────────────

/** The scale day for the instant's UTC date, from today's observed max and
 *  the three predicted days; null when the outlook does not reach it. */
export function scaleDayFor(scales: { now: ScaleDay; outlook: ScaleDay[] } | null, ms: number, nowMs: number): ScaleDay | null {
  if (!scales) return null;
  const ymd = new Date(ms).toISOString().slice(0, 10);
  const today = new Date(nowMs).toISOString().slice(0, 10);
  if (ymd === today) return scales.now;
  const dated = scales.outlook.find((d) => d.date === ymd);
  if (dated) return dated;
  // Undated outlook rows are days 1..3 from today.
  const idx = Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS) - 1;
  const row = scales.outlook[idx];
  return row && !row.date ? row : null;
}

// ── The ranked summary ──────────────────────────────────────────────────────

export type Tone = "r" | "a" | "u" | "i" | "g";
export interface Consideration { tone: Tone; text: string; source: string }
const TONE_RANK: Record<Tone, number> = { r: 0, a: 1, u: 2, i: 3, g: 4 };

export interface ConsiderationInput {
  hMs: number;
  nowMs: number;
  placeLabel: string;
  zone: string;
  light: LightAt | null;
  night: LunarNight | null;
  forecast: { live: boolean; hour: HourlyForecast | null; horizonDays: number };
  hazard: { severity: "severe" | "elevated"; flags: string[] } | null;
  /** The 30-h model hazard window — H outside it reads nothing from hazards. */
  hazardWindowH: number;
  airfield: {
    icao: string;
    metarCat: FlightCategory | null;
    tafLive: boolean;
    taf: TafAt | null;
    tafValidToMs: number | null;
    notamsLive: boolean;
    notamsConfigured: boolean;
    fieldClosed: boolean;
    windows: ClosureWindow[];
  } | null;
  posture: { composite: string; country: string; signal: string | null } | null;
  /** False when the watch list itself could not be read. */
  postureKnown?: boolean;
  holidays: { date: string; label: string }[];
  holidaysKnown: boolean;
  scaleDay: ScaleDay | null;
  scalesLive: boolean;
}

/** NOTAMs are published days ahead, not weeks: past this a quiet NOTAM read
 *  says nothing about H, so it reads UNKNOWN, never "no closure" (code
 *  review 2026-10-28: H three weeks out read green). */
export const NOTAM_HORIZON_H = 7 * 24;

/** H's calendar day in the place's zone — host-nation holidays are LOCAL
 *  dates, so "holiday on H day" compares in the place's zone, not in UTC. */
export function localYmd(ms: number, zone: string): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)); }
  catch { return new Date(ms).toISOString().slice(0, 10); }
}

const fmtH = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h.toFixed(1)} h`);

export function summarize(i: ConsiderationInput): Consideration[] {
  const out: Consideration[] = [];
  const push = (tone: Tone, text: string, source: string) => out.push({ tone, text, source });
  const hoursOut = (i.hMs - i.nowMs) / HOUR_MS;
  const hPast = hoursOut < 0;
  const hYmd = localYmd(i.hMs, i.zone);

  // Airfield: closures first — they decide the plan.
  if (i.airfield) {
    const a = i.airfield;
    if (!a.notamsConfigured) push("u", `${a.icao}: NOTAMs not configured (no DoD CA) — closures at H UNKNOWN`, "DAIP");
    else if (!a.notamsLive) push("u", `${a.icao}: DAIP unreachable this pass — closures at H UNKNOWN`, "DAIP");
    else if (hPast) push("i", `${a.icao}: H has passed — the NOTAM read is for now, not for H`, "DAIP");
    else {
      if (a.fieldClosed) push("r", `${a.icao}: airfield CLOSED at H (NOTAM)`, "DAIP");
      for (const w of a.windows) {
        if (w.indeterminate) { push("a", `${a.icao}: ${w.label} — a closure schedule the app cannot read; confirm against the NOTAM`, "DAIP"); continue; }
        const rwy = /^(RWY|Airfield)/i.test(w.label);
        if (w.kind === "closure" && !(a.fieldClosed && /^Airfield/i.test(w.label))) push(rwy ? "r" : "a", `${a.icao}: ${w.label} closed at H${w.openEnded ? " (UFN)" : ""}`, "DAIP");
        else if (w.kind !== "closure") push("a", `${a.icao}: ${w.label} ${w.kind === "limited" ? "limited" : "unserviceable"} at H`, "DAIP");
      }
      if (!a.fieldClosed && a.windows.length === 0) {
        if (hoursOut > NOTAM_HORIZON_H) push("u", `${a.icao}: NOTAMs for H are not published yet (H is ${fmtH(hoursOut)} out) — closures at H UNKNOWN; the standing ones read none`, "DAIP");
        else push("g", `${a.icao}: no closure or outage window at H`, "DAIP");
      }
    }
    if (!a.tafLive) push("u", `${a.icao}: TAF unreachable — forecast category at H UNKNOWN`, "AWC");
    else if (a.taf) {
      const tone: Tone = a.taf.cat === "LIFR" ? "r" : a.taf.cat === "IFR" ? "r" : a.taf.cat === "MVFR" ? "a" : "g";
      push(tone, `${a.icao} TAF at H: ${a.taf.cat} — ${a.taf.summary}${a.taf.tempo ? ` · ${a.taf.tempo.changeType} ${a.taf.tempo.cat}: ${a.taf.tempo.summary}` : ""}`, "AWC TAF");
    } else if (a.tafValidToMs != null && i.hMs >= a.tafValidToMs) push("u", `${a.icao}: the TAF ends ${fmtH((i.hMs - a.tafValidToMs) / HOUR_MS)} before H — no forecast category at H yet`, "AWC TAF");
    else if (!hPast) push("u", `${a.icao}: no TAF period covers H`, "AWC TAF");
  }

  // Forecast hour (Open-Meteo, 7 days).
  if (!i.forecast.live) push("u", "Open-Meteo unreachable — the forecast at H is UNKNOWN", "Open-Meteo");
  else if (hoursOut > i.forecast.horizonDays * 24) push("u", `H is ${fmtH(hoursOut)} out — beyond the ${i.forecast.horizonDays}-day forecast; weather at H UNKNOWN`, "Open-Meteo");
  else if (hPast && !i.forecast.hour) push("i", "H has passed — no forecast for an hour already gone", "Open-Meteo");
  else if (i.forecast.hour) {
    const h = i.forecast.hour;
    const line = forecastLine(h);
    let tone: Tone = "g";
    const why: string[] = [];
    if (h.weatherCode != null && h.weatherCode >= 95) { tone = "r"; why.push("thunderstorm"); }
    if (h.gustMph != null && h.gustMph >= 35) { tone = "r"; why.push(`gusts ${h.gustMph} mph`); }
    else if (h.gustMph != null && h.gustMph >= 25) { if (tone !== "r") tone = "a"; why.push(`gusts ${h.gustMph} mph`); }
    if (h.visMi != null && h.visMi < 1) { tone = "r"; why.push(`vis ${h.visMi} mi`); }
    else if (h.visMi != null && h.visMi < 3) { if (tone !== "r") tone = "a"; why.push(`vis ${h.visMi} mi`); }
    if (h.weatherCode != null && ((h.weatherCode >= 71 && h.weatherCode <= 77) || h.weatherCode === 85 || h.weatherCode === 86 || h.weatherCode === 45 || h.weatherCode === 48 || (h.weatherCode >= 66 && h.weatherCode <= 67))) { if (tone !== "r") tone = "a"; why.push(wmoWord(h.weatherCode)); }
    if (h.precipPct != null && h.precipPct >= 60) { if (tone === "g") tone = "a"; why.push(`precip ${h.precipPct}%`); }
    else if (h.precipPct != null && h.precipPct >= 30 && tone === "g") tone = "i";
    push(tone, `Forecast at H: ${line}${why.length ? ` — ${why.join(", ")}` : ""}`, "Open-Meteo");
  } else push("u", "No forecast hour covers H", "Open-Meteo");

  if (i.hazard && hoursOut >= 0 && hoursOut <= i.hazardWindowH) push(i.hazard.severity === "severe" ? "r" : "a", `Model hazard inside the ${i.hazardWindowH}-h window: ${i.hazard.flags.join(" · ")}`, "Open-Meteo hazards");

  // Light.
  if (i.light) {
    const l = i.light;
    const rel = i.night ? nearestLightEvent(i.night, i.hMs) : null;
    push("i", `H in ${SUN_STATE_LABEL[l.sun]}${rel ? ` — ${rel}` : ""}${l.sun === "day" ? ` (sun ${l.sunAltDeg}°)` : ""}`, "lib/moon");
    if (l.sun !== "day") {
      if (l.moonUp) push("i", `Moon UP at H — ${l.illumPct}% ${l.phaseName}, ${l.moonAltDeg}° above the horizon${l.moonUseful ? " (useful light)" : " (low — little useful light)"}`, "lib/moon");
      else push("i", `Moon DOWN at H — ${l.illumPct}% ${l.phaseName}, no moonlight`, "lib/moon");
    }
    if (i.night && !i.night.polar && i.night.darkH != null) push("i", `The night of H: ${i.night.darkH} h dark · ${i.night.moonlitDarkH} h moonlit (${i.night.usefulMoonH} h ≥${MOON_USEFUL_ALT_DEG}°) · ${i.night.moonFreeDarkH} h moon-free`, "lib/moon");
    if (i.night?.polar) push("i", "No nautical darkness on the night of H (polar)", "lib/moon");
  }

  // Posture.
  if (i.postureKnown === false) push("u", "Force posture UNKNOWN — the watch list could not be read", "Force posture");
  else if (i.posture) {
    const c = i.posture.composite;
    const tone: Tone = c === "red" ? "r" : c === "amber" ? "a" : c === "green" ? "g" : "u";
    push(tone, `Force posture ${c.toUpperCase()} — ${i.posture.country}${i.posture.signal ? `: ${i.posture.signal}` : ""} (posture is now, not a forecast for H)`, "Force posture");
  }

  // Holidays.
  if (!i.holidaysKnown) push("u", "Host-nation holidays UNKNOWN for this place (country not mapped or the calendar is unreachable)", "Nager.Date");
  else for (const h of i.holidays) {
    if (h.date === hYmd) push("a", `Host-nation holiday on H day: ${h.label} — expect closed offices, customs and reduced ATC / ramp`, "Nager.Date");
    else push("i", `Host-nation holiday ${h.date < hYmd ? "the day before" : "the day after"} H: ${h.label}`, "Nager.Date");
  }

  // Space weather.
  if (!i.scalesLive) push("u", "SWPC unreachable — space weather for H day UNKNOWN", "SWPC");
  else if (i.scaleDay) {
    const d = i.scaleDay;
    const sev = [["G", d.G], ["R", d.R], ["S", d.S]].filter(([, v]) => typeof v === "number" && (v as number) >= 3) as [string, number][];
    if (sev.length) push("a", `Space weather on H day: ${sev.map(([k, v]) => `${k}${v}`).join(" ")} — HF / GPS / SATCOM degraded`, "SWPC");
    else if (d.probs && ((d.probs.rMajor ?? 0) >= 25 || (d.probs.s ?? 0) >= 25)) push("i", `Space weather outlook for H day: R-major ${d.probs.rMajor ?? 0}% · S ${d.probs.s ?? 0}%`, "SWPC");
    else push("g", "Space weather on H day: quiet in the outlook", "SWPC");
  } else if (hoursOut > 0) push("u", "H is beyond the 3-day space-weather outlook", "SWPC");

  return out.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
}
