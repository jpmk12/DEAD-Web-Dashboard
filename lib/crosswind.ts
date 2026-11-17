// CROSSWIND across the next 24 h at an airfield — PURE, client-safe;
// tested in tests/crosswind.test.ts.
//
// The SITREP already gave crosswind per runway end from the METAR NOW. That
// answered "what is it doing" and said nothing about the wind the crews will
// land in. This reads the TAF (and, when the TAF carries no wind, the model's
// 10-m wind) period by period, and for each one picks the BEST runway end —
// the one with the least crosswind among the ends with a headwind — because a
// field with two runways is limited by the better one, not the worse.
//
// Disciplines:
//   - Advisory thresholds, never flight-manual limits (the same 20 / 30 kt,
//     gust 25 / 35 bands as `crosswindFlag`), and the surfaces say so.
//   - A TEMPO / PROB period's gust is risk, not the expected state: it can
//     colour the peak, it is labelled as such.
//   - A variable wind has no crosswind component: the period is listed as
//     variable, never computed from a guessed direction.
//   - Contamination: freezing / frozen precipitation (from the icing read)
//     overlapping a period with ≥ CONTAM_XWIND_KT crosswind turns it amber —
//     a wet-ice runway cuts the usable crosswind well below the dry figure.
//   - No runway headings (OurAirports did not answer) → UNKNOWN, never green.

import { runwayWindComponents, crosswindFlag } from "./sitrepSignals";
import type { TafPeriod } from "./types";

export const CONTAM_XWIND_KT = 15;
export const CONTAM_GUST_XWIND_KT = 20;

export interface RunwayEnd { ident: string; headingDegT: number }

export function runwayEnds(runways: { leIdent: string; heIdent: string; leHeadingDegT: number | null; heHeadingDegT: number | null }[]): RunwayEnd[] {
  const out: RunwayEnd[] = [];
  for (const r of runways) {
    if (r.leIdent && r.leHeadingDegT != null) out.push({ ident: r.leIdent, headingDegT: r.leHeadingDegT });
    if (r.heIdent && r.heHeadingDegT != null) out.push({ ident: r.heIdent, headingDegT: r.heHeadingDegT });
  }
  return out;
}

export interface EndWind { ident: string; headingDegT: number; headKt: number; crossKt: number; gustCrossKt: number | null; flag: "g" | "a" | "r" }

/** The best end for a wind: least crosswind (then gust crosswind, then most headwind) among ends with a headwind or none. */
export function bestEnd(ends: RunwayEnd[], dir: number | null, kt: number | null, gust: number | null): EndWind | null {
  if (dir == null || kt == null || !ends.length) return null;
  const all = ends.map((e) => {
    const c = runwayWindComponents(e.headingDegT, dir, kt, gust);
    return { ident: e.ident, headingDegT: e.headingDegT, ...c, flag: crosswindFlag(c.crossKt, c.gustCrossKt) };
  });
  const pool = all.filter((e) => e.headKt >= 0);
  const use = pool.length ? pool : all;
  return use.sort((a, b) => a.crossKt - b.crossKt || (a.gustCrossKt ?? a.crossKt) - (b.gustCrossKt ?? b.crossKt) || b.headKt - a.headKt)[0];
}

export interface XwindRow {
  fromMs: number;
  toMs: number;
  /** "" base / FM / BECMG; "TEMPO" / "PROB30" … for a risk period; "model" for model hours. */
  change: string;
  src: "taf" | "model";
  wind: string;            // "240/18G28", "VRB/05", "calm"
  variable: boolean;
  best: EndWind | null;
  flag: "g" | "a" | "r" | "u";
  /** Freezing / frozen precipitation overlapping this period with a crosswind worth noting. */
  contaminated: string | null;
}

export interface XwindOutlook {
  now: EndWind | null;
  rows: XwindRow[];
  peak: XwindRow | null;
  level: "g" | "a" | "r" | "u";
  summary: string;
  source: "taf" | "model" | null;
  runwaysKnown: boolean;
}

const pad3 = (n: number) => String(Math.round(n) % 360 || 360).padStart(3, "0");
export function windLabel(dir: number | null, variable: boolean, kt: number | null, gust: number | null): string {
  if (kt == null) return "—";
  if (kt === 0) return "calm";
  return `${variable || dir == null ? "VRB" : pad3(dir)}/${String(Math.round(kt)).padStart(2, "0")}${gust ? `G${Math.round(gust)}` : ""}`;
}

const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`; };

interface ModelHour { t: number; windDir: number | null; windKt: number | null; gustKt: number | null }

export interface XwindInputs {
  nowMs: number;
  runways: { leIdent: string; heIdent: string; leHeadingDegT: number | null; heHeadingDegT: number | null }[];
  metar: { windDir: number | null; windVariable: boolean; windSpeedKt: number | null; windGustKt: number | null } | null;
  taf: TafPeriod[] | null;
  model: ModelHour[] | null;
  contamination: { fromMs: number; toMs: number; what: string }[];
  horizonH?: number;
}

const flagRank = { g: 0, u: 0, a: 1, r: 2 } as const;
const severity = (r: XwindRow) => (r.best ? Math.max(r.best.crossKt, r.best.gustCrossKt ?? 0) : -1);

export function crosswindOutlook(i: XwindInputs): XwindOutlook {
  const now = i.nowMs;
  const end = now + (i.horizonH ?? 24) * 3_600_000;
  const ends = runwayEnds(i.runways);
  const runwaysKnown = ends.length > 0;
  const nowBest = i.metar && !i.metar.windVariable ? bestEnd(ends, i.metar.windDir, i.metar.windSpeedKt, i.metar.windGustKt) : null;

  const rows: XwindRow[] = [];
  const contam = (from: number, to: number, best: EndWind | null): string | null => {
    if (!best) return null;
    if (best.crossKt < CONTAM_XWIND_KT && (best.gustCrossKt ?? 0) < CONTAM_GUST_XWIND_KT) return null;
    const c = i.contamination.find((w) => w.fromMs < to && w.toMs > from);
    return c ? c.what : null;
  };
  const push = (from: number, to: number, change: string, src: "taf" | "model", dir: number | null, variable: boolean, kt: number | null, gust: number | null) => {
    if (kt == null) return;
    const f = Math.max(from, now), t = Math.min(to, end);
    if (t <= f) return;
    const best = variable || kt === 0 ? null : bestEnd(ends, dir, kt, gust);
    const contaminated = contam(f, t, best);
    let flag: XwindRow["flag"] = !runwaysKnown && kt > 0 && !variable ? "u" : best ? best.flag : "g";
    if (contaminated && flag === "g") flag = "a";
    rows.push({ fromMs: f, toMs: t, change, src, wind: windLabel(dir, variable, kt, gust), variable: variable && kt > 0, best, flag, contaminated });
  };

  const tafWind = (i.taf ?? []).filter((p) => p.windSpeedKt != null);
  let source: XwindOutlook["source"] = null;
  if (tafWind.length) {
    source = "taf";
    for (const p of tafWind) {
      const from = Date.parse(p.from), to = Date.parse(p.to);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= now || from >= end) continue;
      push(from, to, p.changeType || "", "taf", p.windDir ?? null, Boolean(p.windVariable), p.windSpeedKt ?? null, p.windGustKt ?? null);
    }
  } else if (i.model?.length) {
    source = "model";
    // Hourly model wind, merged into runs with the same best end and flag.
    for (const h of i.model) {
      if (h.t + 3_600_000 <= now || h.t >= end || h.windKt == null) continue;
      push(h.t, h.t + 3_600_000, "model", "model", h.windDir, false, Math.round(h.windKt), h.gustKt != null ? Math.round(h.gustKt) : null);
      const a = rows[rows.length - 2], b = rows[rows.length - 1];
      if (a && b && a.src === "model" && a.toMs === b.fromMs && a.flag === b.flag && a.best?.ident === b.best?.ident && a.contaminated === b.contaminated) {
        if (severity(b) > severity(a)) { a.wind = b.wind; a.best = b.best; }
        a.toMs = b.toMs;
        rows.pop();
      }
    }
  }
  rows.sort((a, b) => a.fromMs - b.fromMs || (a.change === "" ? -1 : 1));

  const peak = rows.reduce<XwindRow | null>((acc, r) => (!acc || flagRank[r.flag] > flagRank[acc.flag] || (flagRank[r.flag] === flagRank[acc.flag] && severity(r) > severity(acc)) ? r : acc), null);
  const nowFlag = nowBest?.flag ?? "g";
  const worstFlag = [nowFlag, ...rows.map((r) => r.flag)].reduce((a, b) => (flagRank[b] > flagRank[a] ? b : a), "g" as XwindRow["flag"]);
  const level: XwindOutlook["level"] = !runwaysKnown ? "u" : worstFlag === "u" ? "u" : worstFlag;

  const desc = (r: XwindRow) => r.best
    ? `${r.best.crossKt}${r.best.gustCrossKt ? `G${r.best.gustCrossKt}` : ""} kt on RWY ${r.best.ident} ${hhmm(r.fromMs)}–${hhmm(r.toMs)}${r.change && r.change !== "model" ? ` (${r.change})` : ""}${r.src === "model" ? " (model)" : ""}`
    : `${r.wind} ${hhmm(r.fromMs)}–${hhmm(r.toMs)}`;
  const summary = !runwaysKnown ? "Crosswind UNKNOWN — runway headings not available (OurAirports did not answer)"
    : !rows.length && !nowBest ? "No wind forecast to read — TAF and model carried no wind"
    : peak && peak.contaminated ? `Peak crosswind ${desc(peak)} with ${peak.contaminated} — a contaminated runway cuts the usable crosswind`
    : peak && peak.best ? `Peak crosswind ${desc(peak)}${peak.flag === "g" ? " — within the advisory bands" : ""}`
    : nowBest ? `Best runway now RWY ${nowBest.ident}, crosswind ${nowBest.crossKt} kt` : "Winds light or variable — no crosswind component";
  return { now: nowBest, rows: rows.slice(0, 12), peak, level, summary, source, runwaysKnown };
}
