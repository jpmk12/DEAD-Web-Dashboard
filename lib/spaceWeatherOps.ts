// Space weather → ops impact. PURE, client-safe, unit-tested.
//
// The rule this module exists to hold (docs/REVIEW-CYBER-SPACE.md §2):
// nature is not an adversary. Space weather degrades the same systems an
// adversary would target — HF, GPS, SATCOM — but it is ENVIRONMENT, not
// warning. It earns an LED on the SITREP and Weather surfaces and an alert
// at R3/G3/S3+, and it appears on the warning side only as a GUARD: a PNT
// anomaly during a geomagnetic storm is attributed to the storm first
// (`pntStormGuard`). It never raises an I&W level.
//
// Source: NOAA SWPC `noaa-scales.json` — keys "-1" (yesterday), "0" (today,
// observed so far), "1".."3" (predicted days). Each carries R/S/G with a
// `Scale` string ("0".."5" or null) and, for the predictions, probabilities.

import type { Led } from "./sitrepSignals";

export interface ScaleDay {
  /** yyyy-mm-dd when the feed gives one, else "". */
  date: string;
  R: number | null;
  S: number | null;
  G: number | null;
  /** Predicted days carry probabilities (0-100) — R minor / R major / S. */
  probs?: { rMinor: number | null; rMajor: number | null; s: number | null };
}

export interface NoaaScales {
  live: boolean;
  /** Today (key "0"): the observed maximum so far. */
  now: ScaleDay;
  /** Predicted days 1..3, in order. */
  outlook: ScaleDay[];
}

const scaleNum = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 5 ? Math.round(n) : null;
};
const probNum = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
};

function parseDay(raw: unknown): ScaleDay | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sub = (k: string) => (r[k] && typeof r[k] === "object" ? (r[k] as Record<string, unknown>) : {});
  const R = sub("R"), S = sub("S"), G = sub("G");
  const ds = typeof r.DateStamp === "string" ? r.DateStamp.slice(0, 10) : "";
  const day: ScaleDay = { date: ds, R: scaleNum(R.Scale), S: scaleNum(S.Scale), G: scaleNum(G.Scale) };
  const rMinor = probNum(R.MinorProb), rMajor = probNum(R.MajorProb), s = probNum(S.Prob);
  if (rMinor != null || rMajor != null || s != null) day.probs = { rMinor, rMajor, s };
  return day;
}

/** noaa-scales.json → today + the 3-day outlook. A feed with no "0" key is
 *  not live (the caller renders UNKNOWN, never a quiet G0). */
export function parseNoaaScales(json: unknown): NoaaScales {
  const empty: ScaleDay = { date: "", R: null, S: null, G: null };
  if (!json || typeof json !== "object") return { live: false, now: empty, outlook: [] };
  const r = json as Record<string, unknown>;
  const now = parseDay(r["0"]);
  if (!now) return { live: false, now: empty, outlook: [] };
  const outlook: ScaleDay[] = [];
  for (const k of ["1", "2", "3"]) { const d = parseDay(r[k]); if (d) outlook.push(d); }
  // Predicted days publish probabilities rather than an observed scale; when
  // the Scale is null, derive the planning-grade level from the probability
  // so the outlook can say something (≥50% of a minor storm → 1, major → 3).
  for (const d of outlook) {
    if (d.R == null && d.probs) d.R = (d.probs.rMajor ?? 0) >= 50 ? 3 : (d.probs.rMinor ?? 0) >= 50 ? 1 : 0;
    if (d.S == null && d.probs) d.S = (d.probs.s ?? 0) >= 50 ? 1 : 0;
  }
  return { live: true, now, outlook };
}

// ───────────────────────────── impacts ─────────────────────────────

export type ImpactKey = "hf" | "gps" | "satcom" | "radiation";

export interface SpaceWxImpact {
  key: ImpactKey;
  label: string;
  led: Led;
  /** What it means for the crew now, in plain words. */
  now: string;
  /** The 3-day outlook in one clause. */
  outlook: string;
  /** Whether this row bears on the declared force. */
  relevance: "always" | "declared" | "not declared" | "undeclared";
}

const maxOf = (vals: (number | null)[]): number | null => {
  const n = vals.filter((v): v is number => v != null);
  return n.length ? Math.max(...n) : null;
};

const ledFor = (level: number | null, redAt = 3, amberAt = 1): Led =>
  level == null ? "u" : level >= redAt ? "r" : level >= amberAt ? "a" : "g";

/**
 * Four impact rows from the scales. `polar` is the Mission Profile's
 * polar/HF-route declaration: true → the S-scale and polar-cap absorption
 * rows are live; false → they read "not declared, not a factor"; null →
 * UNKNOWN with a pointer to the declaration.
 */
export function spaceWeatherImpacts(scales: NoaaScales, opts: { polar: boolean | null }): SpaceWxImpact[] {
  if (!scales.live) {
    const u = (key: ImpactKey, label: string): SpaceWxImpact => ({ key, label, led: "u", now: "SWPC unreachable — UNKNOWN, not quiet", outlook: "—", relevance: "always" });
    return [u("hf", "HF radio"), u("gps", "GPS / PNT integrity"), u("satcom", "SATCOM"), u("radiation", "Radiation at altitude")];
  }
  const n = scales.now;
  const oR = maxOf(scales.outlook.map((d) => d.R)), oG = maxOf(scales.outlook.map((d) => d.G)), oS = maxOf(scales.outlook.map((d) => d.S));
  const days = scales.outlook.length;
  const outlookLine = (v: number | null, letter: string) => (v == null ? "no outlook" : `${letter}${v} worst over ${days} day${days === 1 ? "" : "s"}`);

  // HF: R-scale is dayside absorption for everyone; S-scale adds polar-cap
  // absorption only on polar routes.
  const hfLevel = opts.polar ? maxOf([n.R, n.S]) : n.R;
  const hfNow = n.R == null ? "R-scale unknown"
    : n.R >= 3 ? `R${n.R}: wide-area HF blackout on the sunlit side — plan SATCOM / relay for oceanic and HF-only legs`
    : n.R >= 1 ? `R${n.R}: occasional HF fades on the sunlit side — expect retries on oceanic HF`
    : "R0: HF normal";
  const hfPolar = opts.polar && (n.S ?? 0) >= 1 ? ` · S${n.S}: polar-cap absorption — HF unreliable on polar legs` : "";
  const hf: SpaceWxImpact = {
    key: "hf", label: "HF radio", led: ledFor(hfLevel), now: hfNow + hfPolar,
    outlook: `${outlookLine(oR, "R")}${opts.polar ? ` · ${outlookLine(oS, "S")}` : ""}`,
    relevance: "always",
  };

  // GPS / PNT: G-scale drives ionospheric disturbance; also the attribution
  // guard for the I&W PNT indicator.
  const gpsNow = n.G == null ? "G-scale unknown"
    : n.G >= 3 ? `G${n.G}: GPS integrity degraded — verify RAIM, expect approach NOTAMs, treat jamming reads with the storm in mind`
    : n.G >= 1 ? `G${n.G}: intermittent GPS degradation possible at high latitudes; equatorial scintillation at dusk`
    : "G0: no geomagnetic disturbance";
  const gps: SpaceWxImpact = { key: "gps", label: "GPS / PNT integrity", led: ledFor(n.G), now: gpsNow, outlook: outlookLine(oG, "G"), relevance: "always" };

  // SATCOM: geomagnetic (G) and radio-blackout (R) both bear on links.
  const satLevel = maxOf([n.G, n.R]);
  const satNow = satLevel == null ? "unknown"
    : satLevel >= 4 ? `G${n.G ?? 0}/R${n.R ?? 0}: SATCOM outages likely — brief lost-comms procedures`
    : satLevel >= 2 ? `G${n.G ?? 0}/R${n.R ?? 0}: SATCOM link margins reduced; equatorial scintillation at dusk`
    : "links normal";
  const satcom: SpaceWxImpact = { key: "satcom", label: "SATCOM", led: ledFor(satLevel, 4, 2), now: satNow, outlook: `${outlookLine(oG, "G")} · ${outlookLine(oR, "R")}`, relevance: "always" };

  // Radiation at altitude: S-scale, polar crews only.
  let radiation: SpaceWxImpact;
  if (opts.polar === true) {
    const rNow = n.S == null ? "S-scale unknown"
      : n.S >= 3 ? `S${n.S}: elevated dose on polar legs — consider lower altitude / re-route`
      : n.S >= 1 ? `S${n.S}: minor dose increase on polar legs; note for frequent flyers`
      : "S0: no radiation storm";
    radiation = { key: "radiation", label: "Radiation at altitude", led: ledFor(n.S), now: rNow, outlook: outlookLine(oS, "S"), relevance: "declared" };
  } else if (opts.polar === false) {
    radiation = { key: "radiation", label: "Radiation at altitude", led: "g", now: `polar / HF routes not declared — not a factor${(n.S ?? 0) >= 3 ? ` (S${n.S} in effect for anyone who is)` : ""}`, outlook: outlookLine(oS, "S"), relevance: "not declared" };
  } else {
    radiation = { key: "radiation", label: "Radiation at altitude", led: "u", now: "declare polar / HF routes in Preferences → Mission Profile → Spectrum dependencies", outlook: outlookLine(oS, "S"), relevance: "undeclared" };
  }
  return [hf, gps, satcom, radiation];
}

/** The card's own LED: the worst of the scales in effect now. UNKNOWN when
 *  the feed is down. */
export function spaceWxLed(scales: NoaaScales, opts: { polar: boolean | null } = { polar: false }): Led {
  if (!scales.live) return "u";
  const vals = [scales.now.R, scales.now.G, ...(opts.polar ? [scales.now.S] : [])];
  const worst = maxOf(vals);
  return ledFor(worst);
}

/** The attribution guard: a G3+ storm today (observed or forecast for the
 *  current day) means a PNT anomaly is the environment until shown otherwise. */
export function pntStormGuard(scales: NoaaScales): boolean {
  return scales.live && (scales.now.G ?? 0) >= 3;
}

/** Scales at 3 or above — the alert predicate's threshold. */
export function severeScales(scales: NoaaScales): { scale: "R" | "S" | "G"; level: number }[] {
  if (!scales.live) return [];
  const out: { scale: "R" | "S" | "G"; level: number }[] = [];
  for (const k of ["R", "S", "G"] as const) { const v = scales.now[k]; if (v != null && v >= 3) out.push({ scale: k, level: v }); }
  return out;
}

/**
 * The one sentence a crew can use (REVIEW-2026-10 W9): what space weather
 * does to HF, GPS approaches and SATCOM today, and whether the 3-day
 * outlook is quiet. At a scale of 3+ it names what breaks; a dead feed is
 * UNKNOWN, never quiet. PURE.
 */
export function spaceWxSentence(scales: NoaaScales, impacts: SpaceWxImpact[]): { lead: string; detail: string; tone: Led } {
  if (!scales.live) {
    return { lead: "Space weather UNKNOWN.", detail: "NOAA SWPC is unreachable — HF, GPS and SATCOM impact not known, not quiet.", tone: "u" };
  }
  const n = scales.now;
  const sev = ([["R", n.R], ["G", n.G], ["S", n.S]] as const).filter(([, v]) => (v ?? 0) >= 3).map(([k, v]) => `${k}${v}`);
  const maxOut = Math.max(0, ...scales.outlook.flatMap((d) => [d.R ?? 0, d.G ?? 0, d.S ?? 0]));
  const worstOutDay = scales.outlook.find((d) => Math.max(d.R ?? 0, d.G ?? 0, d.S ?? 0) === maxOut);
  const outlook = maxOut <= 1
    ? `3-day outlook quiet${scales.outlook.length ? "" : " (no outlook issued)"}.`
    : `3-day outlook: ${worstOutDay ? [["R", worstOutDay.R], ["G", worstOutDay.G], ["S", worstOutDay.S]].filter(([, v]) => (v as number ?? 0) >= 2).map(([k, v]) => `${k}${v}`).join("/") : ""} possible${worstOutDay ? ` on ${worstOutDay.date.slice(5)}` : ""}.`;
  const red = impacts.filter((i) => i.led === "r");
  const amber = impacts.filter((i) => i.led === "a");
  if (sev.length) {
    const what = (red.length ? red : amber).map((i) => `${i.label}: ${i.now}`).join("; ");
    return { lead: `${sev.join(" · ")} in effect.`, detail: `${what || "ops impact — see the rows"}. ${outlook}`, tone: "r" };
  }
  if (amber.length) {
    return { lead: "Minor space weather.", detail: `${amber.map((i) => `${i.label}: ${i.now}`).join("; ")}. ${outlook}`, tone: "a" };
  }
  return { lead: "No impact today.", detail: `HF, GPS approaches and SATCOM normal; ${outlook.charAt(0).toLowerCase()}${outlook.slice(1)}`, tone: "g" };
}
