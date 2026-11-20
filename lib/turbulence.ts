// Turbulence and wind shear at the field and on the approach — a PURE read
// (client-safe, tested in tests/turbulence.test.ts) over sources the SITREP
// already holds; no model call, no new fetch.
//
//   - Military TAF turbulence groups (5BhhhT, lib/tafGroups) — the base
//     weather flight's own forecast at USAF / Army fields.
//   - TAF low-level wind shear groups (WShhh/dddffKT) — civil and military.
//   - SIGMET turbulence / mountain wave over or within 30 NM of the field,
//     reaching the approach band (the icing read's geometry).
//   - Gust spread (gust minus mean wind) in the METAR and the TAF — the
//     planning rule of thumb for mechanical turbulence on short final.
//   - A wind-shear report in the METAR ("WS R24", "WS ALL RWY").
//
// Colour discipline, the icing read's: RED only for turbulence observed or
// warned (a SIGMET in effect over the approach, wind shear reported in the
// METAR); a TAF group is a FORECAST — moderate / severe / extreme amber, light
// a note; UNKNOWN when neither the METAR, the TAF nor the SIGMET list
// answered. A civil TAF carries no turbulence groups, and the read says so —
// its silence is not a forecast of smooth air.

import type { Sigmet } from "./sigmetParse";
import type { TafPeriod } from "./types";
import { sigmetsNear, APPROACH_TOP_AGL_FT, type LatLonPt, type SigmetIcing } from "./icingSignals";
import { turbGroupLabel, type TafHazards, type TafShearGroup, type TafTurbGroup } from "./tafGroups";

/** Gust spread at or above which mechanical turbulence near the ground is likely (kt). */
export const GUST_SPREAD_KT = 15;
export const TURB_HORIZON_H = 24;

export type TurbTone = "r" | "a" | "i";
export interface TurbDriver { tone: TurbTone; text: string; source: "METAR" | "TAF" | "SIGMET" }

export interface TurbulenceInputs {
  nowMs: number;
  field: LatLonPt;
  icao?: string | null;
  elevFt: number | null;
  metar: { windSpeedKt: number | null; windGustKt: number | null; raw: string } | null;
  taf: TafPeriod[] | null;
  hazards: TafHazards | null;
  sigmets: { live: boolean; items: Sigmet[] } | null;
}

export interface TurbulenceRead {
  level: "g" | "a" | "r" | "u";
  summary: string;
  drivers: TurbDriver[];
  groups: TafTurbGroup[];
  shear: TafShearGroup[];
  sigmets: SigmetIcing[];
  militaryTaf: boolean;
  sources: { metar: boolean; taf: boolean; sigmet: boolean | null };
}

const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`; };
const win = (a: number, b: number, now: number) => (a <= now ? `now–${hhmm(b)}` : `${hhmm(a)}–${hhmm(b)}`);

/** "WS R24", "WS RWY24", "WS ALL RWY" in a METAR → what it names; null when absent. */
export function metarWindShear(raw: string | null | undefined): string | null {
  const m = /\bWS (ALL RWY|R(?:WY)?\d{2}[LCR]?)\b/.exec((raw ?? "").toUpperCase());
  if (!m) return null;
  return m[1] === "ALL RWY" ? "all runways" : `RWY ${m[1].replace(/^R(WY)?/, "")}`;
}

const INT_ORDER: Record<TafTurbGroup["intensity"], number> = { extreme: 0, severe: 1, moderate: 2, light: 3, none: 4 };

export function readTurbulence(i: TurbulenceInputs): TurbulenceRead {
  const now = i.nowMs;
  const horizon = now + TURB_HORIZON_H * 3_600_000;
  const drivers: TurbDriver[] = [];

  // 1. METAR — observed.
  const metarLive = Boolean(i.metar);
  if (i.metar) {
    const ws = metarWindShear(i.metar.raw);
    if (ws) drivers.push({ tone: "r", source: "METAR", text: `Wind shear reported ${ws} in the METAR — observed, expect airspeed loss / gain on final` });
    const { windSpeedKt: kt, windGustKt: g } = i.metar;
    if (kt != null && g != null && g - kt >= GUST_SPREAD_KT) {
      drivers.push({ tone: "a", source: "METAR", text: `Gusting ${kt}G${g} kt now — a ${g - kt}-kt gust spread; mechanical turbulence on short final likely` });
    }
  }

  // 2. TAF — groups and gusts inside 24 h.
  const hz = i.hazards;
  const tafLive = Boolean((i.taf && i.taf.length) || hz?.ok);
  const inWindow = <T extends { fromMs: number; toMs: number }>(g: T) => g.toMs > now && g.fromMs < horizon;
  const clip = <T extends { fromMs: number; toMs: number }>(g: T): T => ({ ...g, fromMs: Math.max(g.fromMs, now), toMs: Math.min(g.toMs, horizon) });
  const groups = (hz?.turbulence ?? [])
    .filter((g) => inWindow(g) && g.intensity !== "none" && g.baseFtAgl <= APPROACH_TOP_AGL_FT)
    .map(clip)
    .sort((a, b) => INT_ORDER[a.intensity] - INT_ORDER[b.intensity] || a.fromMs - b.fromMs);
  for (const g of groups.slice(0, 4)) {
    const label = turbGroupLabel(g);
    drivers.push({
      tone: g.intensity === "light" ? "i" : "a", source: "TAF",
      text: `TAF ${g.change ? `${g.change} ` : ""}forecasts ${g.intensity === "severe" || g.intensity === "extreme" ? label.replace(/^\w+/, (w) => w.toUpperCase()) : label} ${win(g.fromMs, g.toMs, now)} (military turbulence group ${g.code})`,
    });
  }
  const shear = (hz?.shear ?? []).filter((g) => inWindow(g)).map(clip).sort((a, b) => a.fromMs - b.fromMs);
  for (const w of shear.slice(0, 3)) {
    drivers.push({
      tone: "a", source: "TAF",
      text: `TAF ${w.change ? `${w.change} ` : ""}forecasts low-level wind shear at ${w.heightFtAgl.toLocaleString("en-US")} ft AGL, wind ${String(w.windDir).padStart(3, "0")}/${w.windKt} kt, ${win(w.fromMs, w.toMs, now)}`,
    });
  }
  let gusty: { kt: number; g: number; from: number; to: number; change: string } | null = null;
  for (const p of i.taf ?? []) {
    const from = Date.parse(p.from), to = Date.parse(p.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= now || from >= horizon) continue;
    const kt = p.windSpeedKt ?? null, g = p.windGustKt ?? null;
    if (kt == null || g == null || g - kt < GUST_SPREAD_KT) continue;
    if (!gusty || g - kt > gusty.g - gusty.kt) gusty = { kt, g, from: Math.max(from, now), to: Math.min(to, horizon), change: p.changeType || "" };
  }
  if (gusty) drivers.push({ tone: "a", source: "TAF", text: `TAF ${gusty.change ? `${gusty.change} ` : ""}${gusty.kt}G${gusty.g} kt ${win(gusty.from, gusty.to, now)} — a ${gusty.g - gusty.kt}-kt gust spread; mechanical turbulence on short final likely` });

  // 3. SIGMET — warned (turbulence, or mountain wave).
  const sig = i.sigmets?.live
    ? [
        ...sigmetsNear(i.sigmets.items, "turbulence", i.field, i.elevFt ?? 0, now, 12, i.icao ?? null),
        ...sigmetsNear(i.sigmets.items, "mountain wave", i.field, i.elevFt ?? 0, now, 12, i.icao ?? null),
      ]
    : [];
  for (const s of sig) {
    if (s.unplaced) { drivers.push({ tone: "i", source: "SIGMET", text: s.line }); continue; }
    drivers.push({ tone: s.inEffect ? "r" : "a", source: "SIGMET", text: s.inEffect ? `${s.line} — in effect${s.toMs ? ` until ${hhmm(s.toMs)}` : ""} (a SIGMET turbulence is severe)` : `${s.line} — from ${s.fromMs ? hhmm(s.fromMs) : "?"}` });
  }

  const order: Record<TurbTone, number> = { r: 0, a: 1, i: 2 };
  drivers.sort((a, b) => order[a.tone] - order[b.tone]);
  const sigLive = i.sigmets ? i.sigmets.live : null;
  const militaryTaf = Boolean(hz?.military);
  const level: TurbulenceRead["level"] = drivers.some((d) => d.tone === "r") ? "r"
    : drivers.some((d) => d.tone === "a") ? "a"
    : metarLive || tafLive || sigLive ? "g" : "u";
  const quiet = [
    militaryTaf ? "the military TAF forecasts no turbulence group" : tafLive ? "a civil TAF carries no turbulence forecast — its silence is not smooth air" : "no TAF",
    sigLive ? "no SIGMET turbulence near the field" : sigLive === false ? "SIGMETs unreachable" : null,
  ].filter(Boolean).join(" · ");
  const summary = level === "u" ? "Turbulence UNKNOWN — neither the METAR, the TAF nor the SIGMET list answered"
    : drivers[0] && drivers[0].tone !== "i" ? drivers[0].text
    : drivers[0] ? `No turbulence warned or forecast above light; ${drivers[0].text.charAt(0).toLowerCase()}${drivers[0].text.slice(1)}`
    : `No turbulence or wind shear indicated · ${quiet}`;

  return {
    level, summary, drivers, groups, shear, sigmets: sig, militaryTaf,
    sources: { metar: metarLive, taf: tafLive, sigmet: sigLive },
  };
}
