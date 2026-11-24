// 72-hour outlook at a SITREP field — PURE, client-safe, tested in
// tests/fieldOutlook.test.ts. Reads the model profile the SITREP already
// fetches (Open-Meteo, UTC, knots — lib/fieldWx) and the decoded TAF, and
// cuts the next 72 h into 6-hour Zulu blocks (00 / 06 / 12 / 18Z), the way
// the Weather tab's cards read a week in days: one icon, temperature, wind,
// precipitation chance, visibility and cloud per block, plus the TAF's
// flight category for the blocks the TAF covers.
//
// Disciplines: the model is planning-grade and every surface says so; the
// TAF governs its own window (a block inside it shows the TAF category, and a
// TAF IFR / LIFR block is flagged by the TAF, not the model); a block flag is
// AMBER at most — a forecast is never red here, and the outlook never moves
// the weather LED (icing, crosswind and turbulence do that, with their own
// rules). No profile → the outlook is UNKNOWN, never "quiet".

import type { ProfileHour } from "./icingSignals";
import type { TafPeriod } from "./types";

export const OUTLOOK_HOURS = 72;
export const OUTLOOK_BLOCK_H = 6;
export const FLAG_GUST_KT = 30;
export const FLAG_WIND_KT = 25;
export const FLAG_VIS_MI = 3;

export type OutlookCategory = "VFR" | "MVFR" | "IFR" | "LIFR";

export interface OutlookBlock {
  fromMs: number;
  toMs: number;
  /** Worst WMO weather code in the block (thunder › freezing › snow › rain › fog › cloud). */
  code: number | null;
  isDay: boolean;
  tempMinC: number | null;
  tempMaxC: number | null;
  windDir: number | null;
  windKt: number | null;
  gustKt: number | null;
  precipPct: number | null;
  precipMm: number | null;
  visMi: number | null;
  cloudPct: number | null;
  /** Worst TAF category over the block (base + TEMPO / PROB folded); null outside the TAF. */
  taf: OutlookCategory | null;
  inTaf: boolean;
  flags: string[];
  hours: number;
}

export interface OutlookDay {
  date: string; // Zulu YYYY-MM-DD
  hiC: number | null;
  loC: number | null;
  maxPrecipPct: number | null;
  code: number | null;
  blocks: OutlookBlock[];
}

export interface FieldOutlook {
  live: boolean;
  blocks: OutlookBlock[];
  days: OutlookDay[];
  /** End of the TAF's validity (ms) — beyond it the outlook is model only. */
  tafEndMs: number | null;
  summary: string;
  flagged: number;
}

/** WMO code → severity for "worst weather in the block". */
export function wmoSeverity(code: number | null): number {
  if (code == null) return -1;
  if (code >= 95) return 90;                                  // thunderstorm
  if ([56, 57, 66, 67].includes(code)) return 80;             // freezing drizzle / rain
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 70; // snow
  if (code === 65 || code === 82) return 60;                  // heavy rain
  if (code >= 61 && code <= 64 || code === 80 || code === 81) return 50;
  if (code >= 51 && code <= 55) return 40;                    // drizzle
  if (code === 45 || code === 48) return 35;                  // fog
  return code;                                                // 0–3 cloud
}

export function wmoWordShort(code: number | null): string {
  if (code == null) return "—";
  if (code >= 95) return "thunderstorms";
  if ([56, 57].includes(code)) return "freezing drizzle";
  if ([66, 67].includes(code)) return "freezing rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code === 65 || code === 82) return "heavy rain";
  if ((code >= 61 && code <= 64) || code === 80 || code === 81) return "rain";
  if (code >= 51 && code <= 55) return "drizzle";
  if (code === 45 || code === 48) return "fog";
  if (code === 3) return "overcast";
  if (code === 2) return "partly cloudy";
  if (code === 1) return "mostly clear";
  return "clear";
}

/**
 * A block flag as a short chip for the tile face ("TS", "FZRA", "SN",
 * "G34", "WIND 27", "VIS 2", "IFR") — the full sentence stays the tooltip.
 */
export function flagChip(flag: string): string {
  const f = flag.toLowerCase();
  if (/thunder/.test(f)) return "TS";
  if (/freezing rain/.test(f)) return "FZRA";
  if (/freezing drizzle/.test(f)) return "FZDZ";
  if (/freezing/.test(f)) return "FZ";
  if (/snow/.test(f)) return "SN";
  const g = /gusts? to (\d+)/.exec(f); if (g) return `G${g[1]}`;
  const w = /wind (\d+)/.exec(f); if (w) return `WIND ${w[1]}`;
  const v = /visibility ([\d.]+)/.exec(f); if (v) return `VIS ${v[1]}`;
  const c = /\b(lifr|ifr)\b/.exec(f); if (c) return c[1].toUpperCase();
  return flag.split(" ")[0].toUpperCase().slice(0, 6);
}

/** Short word for the tile face (capitalised), from the block's worst WMO code. */
export function wmoTileWord(code: number | null): string {
  if (code == null) return "—";
  if (code >= 95) return code >= 96 ? "T-storm + hail" : "T-storms";
  if (code === 45 || code === 48) return code === 48 ? "Rime fog" : "Fog";
  if ([80, 81, 82].includes(code)) return code === 82 ? "Heavy showers" : "Showers";
  if ([85, 86].includes(code)) return "Snow showers";
  if (code === 77) return "Snow grains";
  const w = wmoWordShort(code);
  const light = [51, 56, 61, 66, 71].includes(code) ? "Light " : "";
  return (light + w).replace(/^./, (c) => c.toUpperCase());
}

const CAT_RANK: Record<OutlookCategory, number> = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 };
const asCat = (c: unknown): OutlookCategory | null => (c === "VFR" || c === "MVFR" || c === "IFR" || c === "LIFR" ? c : null);

/** Day by local SOLAR hour at the block's middle — enough for the icon. */
function dayAt(ms: number, lon: number): boolean {
  const solar = ((new Date(ms).getUTCHours() + new Date(ms).getUTCMinutes() / 60 + lon / 15) % 24 + 24) % 24;
  return solar >= 6 && solar < 18;
}

const zday = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const hhZ = (ms: number) => `${String(new Date(ms).getUTCHours()).padStart(2, "0")}Z`;
const dow = (ms: number) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(ms).getUTCDay()];
export const blockLabel = (b: Pick<OutlookBlock, "fromMs" | "toMs">) => `${dow(b.fromMs)} ${hhZ(b.fromMs)}–${hhZ(b.toMs)}`;

export function fieldOutlook(i: {
  nowMs: number;
  lon: number;
  hours: ProfileHour[] | null;
  taf: TafPeriod[] | null;
  horizonH?: number;
}): FieldOutlook {
  const H = 3_600_000;
  const blockMs = OUTLOOK_BLOCK_H * H;
  const start = Math.floor(i.nowMs / blockMs) * blockMs;
  const n = Math.ceil((i.horizonH ?? OUTLOOK_HOURS) / OUTLOOK_BLOCK_H);
  const hours = (i.hours ?? []).filter((h) => h.t + H > i.nowMs);
  const tafPeriods = (i.taf ?? [])
    .map((p) => ({ from: Date.parse(p.from), to: Date.parse(p.to), cat: asCat(p.flightCategory) }))
    .filter((p) => Number.isFinite(p.from) && Number.isFinite(p.to) && p.to > p.from);
  const tafEndMs = tafPeriods.length ? Math.max(...tafPeriods.map((p) => p.to)) : null;
  if (!hours.length) {
    return { live: false, blocks: [], days: [], tafEndMs, summary: "72-h outlook UNKNOWN — the model profile did not answer", flagged: 0 };
  }

  const blocks: OutlookBlock[] = [];
  for (let k = 0; k < n; k++) {
    const from = start + k * blockMs, to = from + blockMs;
    const hs = hours.filter((h) => h.t >= from && h.t < to);
    if (!hs.length) continue;
    const vals = (f: (h: ProfileHour) => number | null | undefined) => hs.map(f).filter((v): v is number => v != null && Number.isFinite(v));
    const max = (a: number[]) => (a.length ? Math.max(...a) : null);
    const min = (a: number[]) => (a.length ? Math.min(...a) : null);
    const worst = hs.reduce<number | null>((acc, h) => (wmoSeverity(h.weatherCode) > wmoSeverity(acc) ? h.weatherCode : acc), null);
    const windHour = hs.reduce<ProfileHour | null>((acc, h) => (h.windKt != null && (acc?.windKt == null || h.windKt > acc.windKt) ? h : acc), null);
    const visM = min(vals((h) => h.visM));
    const precipMm = vals((h) => h.precipMm);
    const temps = vals((h) => h.tempC2m);
    const cats = tafPeriods.filter((p) => p.from < to && p.to > from && p.cat).map((p) => p.cat!) ;
    const taf = cats.length ? cats.reduce((a, b) => (CAT_RANK[b] > CAT_RANK[a] ? b : a)) : null;
    const inTaf = tafEndMs != null && from < tafEndMs && tafPeriods.some((p) => p.from < to && p.to > from);
    const b: OutlookBlock = {
      fromMs: from, toMs: to, code: worst, isDay: dayAt(from + blockMs / 2, i.lon),
      tempMinC: temps.length ? Math.round(Math.min(...temps)) : null,
      tempMaxC: temps.length ? Math.round(Math.max(...temps)) : null,
      windDir: windHour?.windDir != null ? Math.round(windHour.windDir / 10) * 10 : null,
      windKt: windHour?.windKt != null ? Math.round(windHour.windKt) : null,
      gustKt: (() => { const g = max(vals((h) => h.gustKt)); return g != null ? Math.round(g) : null; })(),
      precipPct: (() => { const p = max(vals((h) => h.precipPct)); return p != null ? Math.round(p) : null; })(),
      precipMm: precipMm.length ? Math.round(precipMm.reduce((a, v) => a + v, 0) * 10) / 10 : null,
      visMi: visM != null ? Math.round((visM / 1609.34) * 10) / 10 : null,
      cloudPct: (() => { const c = max(vals((h) => h.cloudPct)); return c != null ? Math.round(c) : null; })(),
      taf, inTaf, flags: [], hours: hs.length,
    };
    const sev = wmoSeverity(b.code);
    if (sev >= 90) b.flags.push("thunderstorms (model)");
    else if (sev === 80) b.flags.push(`${wmoWordShort(b.code)} (model)`);
    else if (sev === 70) b.flags.push("snow (model)");
    if (b.gustKt != null && b.gustKt >= FLAG_GUST_KT) b.flags.push(`gusts to ${b.gustKt} kt (model)`);
    else if (b.windKt != null && b.windKt >= FLAG_WIND_KT) b.flags.push(`wind ${b.windKt} kt (model)`);
    if (b.visMi != null && b.visMi < FLAG_VIS_MI && !b.inTaf) b.flags.push(`visibility ${b.visMi} mi (model)`);
    if (b.taf === "IFR" || b.taf === "LIFR") b.flags.push(`${b.taf} (TAF)`);
    blocks.push(b);
  }

  const days: OutlookDay[] = [];
  for (const b of blocks) {
    const date = zday(b.fromMs);
    let d = days.find((x) => x.date === date);
    if (!d) { d = { date, hiC: null, loC: null, maxPrecipPct: null, code: null, blocks: [] }; days.push(d); }
    d.blocks.push(b);
    if (b.tempMaxC != null) d.hiC = d.hiC == null ? b.tempMaxC : Math.max(d.hiC, b.tempMaxC);
    if (b.tempMinC != null) d.loC = d.loC == null ? b.tempMinC : Math.min(d.loC, b.tempMinC);
    if (b.precipPct != null) d.maxPrecipPct = d.maxPrecipPct == null ? b.precipPct : Math.max(d.maxPrecipPct, b.precipPct);
    if (wmoSeverity(b.code) > wmoSeverity(d.code)) d.code = b.code;
  }

  // Summary: each flag kind once, with the first block it lands in, worst kinds first.
  const kinds = new Map<string, { label: string; from: number; to: number; rank: number }>();
  const kindOf = (f: string) => f.replace(/\s\d.*| to \d.*/, "").replace(/ \((model|TAF)\)$/, "");
  const RANK = (f: string) => (/thunder/.test(f) ? 0 : /freezing/.test(f) ? 1 : /IFR/.test(f) ? 2 : /snow/.test(f) ? 3 : /gust|wind/.test(f) ? 4 : 5);
  for (const b of blocks) for (const f of b.flags) {
    const k = kindOf(f);
    const prev = kinds.get(k);
    if (!prev) kinds.set(k, { label: f, from: b.fromMs, to: b.toMs, rank: RANK(f) });
    else if (prev.to === b.fromMs) prev.to = b.toMs;
  }
  const flagged = blocks.filter((b) => b.flags.length).length;
  const parts = [...kinds.values()].sort((a, b) => a.rank - b.rank || a.from - b.from).slice(0, 4)
    .map((k) => `${k.label} ${dow(k.from)} ${hhZ(k.from)}–${hhZ(k.to)}`);
  const summary = parts.length
    ? `Next 72 h: ${parts.join(" · ")}`
    : "Next 72 h: nothing flagged — no thunderstorms, freezing precipitation, snow, strong wind or TAF IFR (model planning-grade; the TAF governs its window)";
  return { live: true, blocks, days, tafEndMs, summary, flagged };
}
