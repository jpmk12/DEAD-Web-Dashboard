// PURE helpers for the OSINT SITREP pane: NOTAM display grouping, the impact
// filter for local news, the TAF timeline, and the status-LED rollups.
// Client-imported (SitrepPanel) — no node:*, no fetch, no lib/notams import
// (that module is server-only); inputs are structural. Unit-tested.

import type { TafPeriod, FlightCategory } from "./types";
import { CAT_RANK } from "./aviationWx";

// Minimal structural NOTAM shape (matches lib/notams Notam without importing it).
export interface SitrepNotam {
  category: string;
  rank: number;
  text: string;
  start?: string;
  end?: string;
  runwaysClosed?: string[];
}

export type NotamGroupKey = "runway" | "navaid" | "hours" | "airspace" | "bird" | "other";

export interface NotamGroup {
  key: NotamGroupKey;
  label: string;
  items: (SitrepNotam & { amber: boolean })[];
}

const GROUP_OF: Record<string, NotamGroupKey> = {
  runway: "runway", taxiway: "runway", lighting: "runway", obstacle: "runway",
  navaid: "navaid", approach: "navaid", gps_raim: "navaid",
  services: "hours",
  airspace: "airspace",
  bird: "bird",
};

const GROUP_LABELS: Record<NotamGroupKey, string> = {
  runway: "Runway / surface",
  navaid: "NAVAID / approach",
  hours: "Hours / services",
  airspace: "Airspace / TFR",
  bird: "Bird / wildlife (BASH)",
  other: "Other",
};

const AMBER_RE = /\bAD\s+CLSD|AERODROME\s+CLSD|FUEL\s+(NOT\s+|UN)AVBL/i;

// Group NOTAMs into the SITREP display buckets, items ranked most-significant
// first, empty groups omitted. `amber` marks the operationally limiting ones
// (runway closures, aerodrome closed, fuel unavailable).
export function groupNotams(notams: SitrepNotam[]): { groups: NotamGroup[]; limiting: boolean; fieldClosed: boolean } {
  const buckets = new Map<NotamGroupKey, NotamGroup["items"]>();
  let limiting = false;
  let fieldClosed = false;
  for (const n of notams) {
    const key = GROUP_OF[n.category] ?? "other";
    const amber = (n.runwaysClosed?.length ?? 0) > 0 || AMBER_RE.test(n.text);
    if (amber && key === "runway") limiting = true;
    if (/\bAD\s+CLSD|AERODROME\s+CLSD/i.test(n.text)) { fieldClosed = true; limiting = true; }
    const arr = buckets.get(key) ?? [];
    arr.push({ ...n, amber });
    buckets.set(key, arr);
  }
  const order: NotamGroupKey[] = ["runway", "navaid", "hours", "airspace", "bird", "other"];
  const groups = order
    .filter((k) => buckets.has(k))
    .map((k) => ({
      key: k,
      label: GROUP_LABELS[k],
      items: buckets.get(k)!.sort((a, b) => Number(b.amber) - Number(a.amber) || a.rank - b.rank),
    }));
  return { groups, limiting, fieldClosed };
}

// ─── Impact-filtered local news ──────────────────────────────────────────────

// Mission-impact vocabulary: things that hurt operations at/around a base.
export const IMPACT_TERMS = [
  "power outage", "outage", "blackout", "power restored",
  "water main", "boil water", "water service",
  "internet", "cell service", "cellular", "fiber cut",
  "closure", "closed", "shut down", "lockdown", "curfew",
  "protest", "strike", "walkout", "picket",
  "shooting", "shelter in place", "evacuation", "evacuate",
  "gate", "base access", "security incident",
  "uas", "drone", "unmanned",
  "road closed", "bridge closed", "derailment", "spill", "hazmat",
  "flood", "flooding", "wildfire",
] as const;

// Terms found in the text (case-insensitive, word-bounded where sensible).
export function impactMatches(text: string): string[] {
  const lower = ` ${text.toLowerCase()} `;
  const out: string[] = [];
  for (const term of IMPACT_TERMS) {
    // Scan every occurrence — the first hit may sit inside another word
    // ("Delegate…") while a later one is a true match ("…gate closed").
    let from = 0;
    while (true) {
      const idx = lower.indexOf(term, from);
      if (idx === -1) break;
      from = idx + 1;
      const before = lower[idx - 1] ?? " ";
      const after = lower[idx + term.length] ?? " ";
      if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue;
      out.push(term);
      break;
    }
  }
  return [...new Set(out)];
}

export function filterImpactNews<T extends { title: string }>(items: T[]): (T & { matched: string[] })[] {
  return items
    .map((it) => ({ ...it, matched: impactMatches(it.title) }))
    .filter((it) => it.matched.length > 0);
}

// ─── TAF timeline ────────────────────────────────────────────────────────────

export interface TafSegment {
  cat: FlightCategory;
  fromMs: number;
  toMs: number;
  label: string; // e.g. "18Z"
}

const zHour = (ms: number) => `${String(new Date(ms).getUTCHours()).padStart(2, "0")}Z`;

// Compress TAF periods into a ≤8-segment category bar over [now, now+24h].
// TEMPO/PROB variations are folded into their base period by taking the WORSE
// category when they overlap — a planning bar should show the risk, not hide
// it. Gaps (before the first period) render as UNKNOWN.
export function tafTimeline(periods: TafPeriod[], nowMs: number, horizonH = 24): TafSegment[] {
  const end = nowMs + horizonH * 3600_000;
  const base = periods
    .filter((p) => !/^(TEMPO|PROB)/i.test(p.changeType))
    .map((p) => ({ from: Date.parse(p.from), to: Date.parse(p.to), cat: p.flightCategory }))
    .filter((p) => Number.isFinite(p.from) && Number.isFinite(p.to) && p.to > nowMs && p.from < end);
  if (base.length === 0) return [];
  base.sort((a, b) => a.from - b.from);

  const segs: TafSegment[] = [];
  for (const p of base) {
    const from = Math.max(p.from, nowMs);
    const to = Math.min(p.to, end);
    if (to <= from) continue;
    // fold overlapping TEMPO/PROB: worst category wins for the overlap window
    let cat = p.cat;
    for (const o of periods) {
      if (!/^(TEMPO|PROB)/i.test(o.changeType)) continue;
      const of_ = Date.parse(o.from), ot = Date.parse(o.to);
      if (!Number.isFinite(of_) || !Number.isFinite(ot)) continue;
      if (of_ < to && ot > from && CAT_RANK[o.flightCategory] > CAT_RANK[cat]) cat = o.flightCategory;
    }
    const last = segs[segs.length - 1];
    if (last && last.cat === cat) { last.toMs = to; continue; }
    segs.push({ cat, fromMs: from, toMs: to, label: zHour(from) });
  }
  return segs.slice(0, 8);
}

// ─── Runway wind components ─────────────────────────────────────────────────
//
// Planning-grade crosswind/headwind per runway end from the decoded METAR.
// Advisory ONLY — thresholds are coarse heavy-aircraft planning numbers, not
// flight-manual limits, and say so in the UI.

export interface RunwayWind {
  ident: string;          // runway end, e.g. "24"
  headingDegT: number;
  headKt: number;         // positive = headwind for this end, negative = tailwind
  crossKt: number;        // absolute crosswind component
  gustCrossKt: number | null;
  flag: "g" | "a" | "r";  // advisory: a ≥20kt cross (or gust ≥25), r ≥30
}

export function runwayWindComponents(headingDegT: number, windDirDeg: number, windKt: number, gustKt: number | null): Omit<RunwayWind, "ident" | "headingDegT" | "flag"> {
  const delta = ((windDirDeg - headingDegT) * Math.PI) / 180;
  const headKt = Math.round(Math.cos(delta) * windKt);
  const crossKt = Math.abs(Math.round(Math.sin(delta) * windKt));
  const gustCrossKt = gustKt != null ? Math.abs(Math.round(Math.sin(delta) * gustKt)) : null;
  return { headKt, crossKt, gustCrossKt };
}

export function crosswindFlag(crossKt: number, gustCrossKt: number | null): "g" | "a" | "r" {
  if (crossKt >= 30 || (gustCrossKt ?? 0) >= 35) return "r";
  if (crossKt >= 20 || (gustCrossKt ?? 0) >= 25) return "a";
  return "g";
}

// Components for every runway end with a known heading. Variable wind → no
// rows (a direction-less crosswind is noise, not information).
export function runwayWinds(
  runways: { leIdent: string; heIdent: string; leHeadingDegT: number | null; heHeadingDegT: number | null }[],
  windDirDeg: number | null,
  windVariable: boolean,
  windKt: number | null,
  gustKt: number | null,
): RunwayWind[] {
  if (windDirDeg == null || windVariable || windKt == null) return [];
  const out: RunwayWind[] = [];
  for (const r of runways) {
    for (const [ident, hdg] of [[r.leIdent, r.leHeadingDegT], [r.heIdent, r.heHeadingDegT]] as const) {
      if (!ident || hdg == null) continue;
      const c = runwayWindComponents(hdg, windDirDeg, windKt, gustKt);
      out.push({ ident, headingDegT: hdg, ...c, flag: crosswindFlag(c.crossKt, c.gustCrossKt) });
    }
  }
  // favoured ends first (most headwind), then by ident for stability
  return out.sort((a, b) => b.headKt - a.headKt || a.ident.localeCompare(b.ident));
}

// ─── Status LEDs ─────────────────────────────────────────────────────────────

export type Led = "g" | "a" | "r" | "u";

export function wxLed(catNow: FlightCategory | null, tafWorst: FlightCategory | null, alertCount: number, severeAlert: boolean): Led {
  if (!catNow && !tafWorst && alertCount === 0) return "u";
  if (catNow === "LIFR" || severeAlert) return "r";
  if (catNow === "IFR" || tafWorst === "IFR" || tafWorst === "LIFR" || alertCount > 0) return "a";
  if (catNow === "UNKNOWN" && !tafWorst) return "u";
  return "g";
}

export function opsLed(configured: boolean, live: boolean, limiting: boolean, fieldClosed: boolean): Led {
  if (!configured || !live) return "u";
  if (fieldClosed) return "r";
  if (limiting) return "a";
  return "g";
}

export function threatLed(composite: string | null): Led {
  if (composite === "red") return "r";
  if (composite === "amber") return "a";
  if (composite === "green") return "g";
  return "u";
}
