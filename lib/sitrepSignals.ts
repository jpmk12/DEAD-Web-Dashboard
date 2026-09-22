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

// ─── Closure-window timeline ─────────────────────────────────────────────────
//
// NOTAM B)/C) times → horizontal bars over the next horizon. Only NOTAMs whose
// text matches a window-worthy pattern (closure / unserviceable / fuel-limited)
// AND that carry at least one parseable time become bars — everything else
// stays a text row in the groups above. Never a guessed bar.

export type WindowKind = "closure" | "unserviceable" | "limited";

export interface ClosureWindow {
  label: string;         // "RWY 06/24" · "TWY A" · "ILS RWY 24" · "Airfield" · "Fuel"
  kind: WindowKind;
  fromMs: number;        // clamped to [now, now+horizon]
  toMs: number;
  openEnded: boolean;    // no C) end time — bar runs to the horizon edge (→ UFN)
  beyondHorizon: boolean; // has a C) end, but it falls past the horizon (→ continues)
  text: string;          // source NOTAM snippet (tooltip)
  recurring?: boolean;   // one occurrence of a day/hour schedule inside the validity span
  indeterminate?: boolean; // schedule detected but NOT parseable — extent unknown, never claim CLOSED
}

// ── NOTAM activity schedules ────────────────────────────────────────────────
// A NOTAM's B)/C) times bound how long the NOTICE is valid, not when the
// condition is actually in effect. Construction closures routinely read
// "SUN TUE WED 1400-1800, MON 1400-1700" inside a two-month validity span.
// Painting the validity span as one solid bar claims the runway is shut for
// two months when it is shut four hours a day on four days a week — wrong in
// the direction that manufactures a permanent CCIR and teaches the commander
// to stop believing the board.
//
// PURE + unit-tested. Returns null when the text carries no schedule at all
// (a genuinely continuous closure, which SHOULD draw as one bar).

const DOW_NUM: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const DAY_TOKEN = "MON|TUE|WED|THU|FRI|SAT|SUN";
// A day-of-week token is the marker that a schedule exists at all. Matched
// case-sensitively against the upper-cased text so "Mon" inside a word can't
// trip it.
const HAS_SCHEDULE_RE = new RegExp(`\\b(?:${DAY_TOKEN}|DAILY)\\b`);
// day list (possibly ranges) immediately followed by an HHMM-HHMM span
const SCHEDULE_CLAUSE_RE = new RegExp(
  `((?:(?:${DAY_TOKEN}|DAILY)(?:\\s*-\\s*(?:${DAY_TOKEN}))?[\\s,]*)+)(\\d{4})\\s*-\\s*(\\d{4})`,
  "g",
);

export interface ScheduleRule {
  days: number[];    // 0 = Sunday … 6 = Saturday
  startMin: number;  // minutes past 00:00Z
  endMin: number;    // when ≤ startMin the window crosses midnight
}

function expandDayTokens(raw: string): number[] {
  const days = new Set<number>();
  // Normalise "MON - FRI" → "MON-FRI" so a range survives the split.
  for (const tok of raw.replace(/\s*-\s*/g, "-").split(/[\s,]+/).filter(Boolean)) {
    if (tok === "DAILY") { for (let d = 0; d < 7; d++) days.add(d); continue; }
    const range = tok.match(new RegExp(`^(${DAY_TOKEN})-(${DAY_TOKEN})$`));
    if (range) {
      const a = DOW_NUM[range[1]], b = DOW_NUM[range[2]];
      // Inclusive, wrapping (FRI-MON = Fri, Sat, Sun, Mon).
      for (let i = 0; i < 7; i++) { const d = (a + i) % 7; days.add(d); if (d === b) break; }
      continue;
    }
    if (tok in DOW_NUM) days.add(DOW_NUM[tok]);
  }
  return [...days].sort((x, y) => x - y);
}

const hhmmToMin = (s: string): number | null => {
  const h = Number(s.slice(0, 2)), m = Number(s.slice(2, 4));
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 24 || m > 59) return null;
  return h * 60 + m;
};

export function parseNotamSchedule(text: string): ScheduleRule[] | null {
  const up = text.toUpperCase();
  if (!HAS_SCHEDULE_RE.test(up)) return null;     // no schedule → continuous
  const rules: ScheduleRule[] = [];
  SCHEDULE_CLAUSE_RE.lastIndex = 0;
  for (const m of up.matchAll(SCHEDULE_CLAUSE_RE)) {
    const days = expandDayTokens(m[1]);
    const startMin = hhmmToMin(m[2]);
    const endMin = hhmmToMin(m[3]);
    if (!days.length || startMin === null || endMin === null) continue;
    rules.push({ days, startMin, endMin });
  }
  return rules.length ? rules : [];               // [] = schedule present but unreadable
}

// Occurrences of a schedule inside [fromMs, toMs], already clipped.
export function scheduleOccurrences(
  rules: ScheduleRule[],
  fromMs: number,
  toMs: number,
): { fromMs: number; toMs: number }[] {
  if (toMs <= fromMs) return [];
  const out: { fromMs: number; toMs: number }[] = [];
  const d0 = new Date(fromMs);
  // Start one day early so a window that began yesterday and crosses midnight
  // is still caught. UTC midnights are exactly 86 400 000 ms apart — no DST.
  let day = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()) - 86_400_000;
  for (; day <= toMs; day += 86_400_000) {
    const dow = new Date(day).getUTCDay();
    for (const r of rules) {
      if (!r.days.includes(dow)) continue;
      const s = day + r.startMin * 60_000;
      const e = day + r.endMin * 60_000 + (r.endMin <= r.startMin ? 86_400_000 : 0);
      const cs = Math.max(s, fromMs), ce = Math.min(e, toMs);
      if (ce > cs) out.push({ fromMs: cs, toMs: ce });
    }
  }
  return out.sort((a, b) => a.fromMs - b.fromMs);
}

const CLSD_RE = /\bCLSD\b|\bCLOSED\b/i;
const US_RE = /\bU\/S\b|\bUNSERVICEABLE\b|\bOTS\b|\bOUT OF SERVICE\b|\bINOP(?:ERATIVE)?\b/i;
const FUEL_LIM_RE = /\bFUEL\b.*(\bNOT\s+AVBL\b|\bUNAVBL\b|\bLIMITED\b|\bU\/S\b)|(\bNOT\s+AVBL\b|\bUNAVBL\b|\bLIMITED\b).*\bFUEL\b/i;
// A lighting-COMPONENT outage (covert / edge / centreline / RAI / REIL / PAPI /
// approach lights U/S) is advisory — it does NOT close the runway or an approach
// aid, so it must not become a closure-window bar (it stays a NOTAM text row).
// Electronic NAVAIDs (ILS/VOR/TACAN/DME/GS) are NOT lighting and still bar.
const LIGHTING_RE = /\b(LGT|LGTS|LGTD|LIGHT|LIGHTS|LIGHTING|REIL|RAIL|RAI|PAPI|VASI|VGSI|APAPI|PLASI|ALSF?|MALSR?|SSAL[RF]|ODALS|RCLL|RCLS|RTIL|TDZL|HIRL|MIRL|LIRL)\b|RWY\s+ALIGNMENT\s+INDICATOR/i;

function windowKind(text: string): WindowKind | null {
  if (FUEL_LIM_RE.test(text)) return "limited";
  if (CLSD_RE.test(text)) return "closure";
  if (US_RE.test(text)) return LIGHTING_RE.test(text) ? null : "unserviceable";
  return null;
}

export function windowLabel(text: string, category: string): string {
  const up = text.toUpperCase();
  if (/\bAD\s+CLSD|AERODROME\s+CLSD/.test(up)) return "Airfield";
  const rwy = up.match(/RWY\s*([0-9]{2}[LRC]?(?:\/[0-9]{2}[LRC]?)?)/);
  const navaid = up.match(/\b(ILS|LOC|VOR|TACAN|NDB|RNAV|PAPI|VASI|ALS|GLIDESLOPE|GS|DME)\b/);
  if (navaid) return rwy ? `${navaid[1]} RWY ${rwy[1]}` : navaid[1];
  if (rwy) return `RWY ${rwy[1]}`;
  const twy = up.match(/TWY\s*([A-Z]{1,2}\d{0,2}\b)/);
  if (twy) return `TWY ${twy[1]}`;
  if (/\bFUEL\b/.test(up)) return "Fuel";
  if (/\bAPRON|RAMP\b/.test(up)) return "Ramp / apron";
  if (/\bPARKING|PRKG|STAND\b/.test(up)) return "Parking";
  if (/\b(GPS|RAIM|WAAS)\b/.test(up)) return "GPS / RAIM";
  if (/\bOBST|OBSTACLE|CRANE|TOWER\b/.test(up)) return "Obstacle";
  if (/\b(PJE|PARACHUTE|PARA\s+JUMP|JUMP)\b/.test(up)) return "Parachute (PJE)";
  if (/\b(UAS|UAV|DRONE|UNMANNED|RPA)\b/.test(up)) return "UAS / drone";
  if (/\b(TFR|RESTRICTED|PROHIBITED|MOA|AIRSPACE)\b/.test(up)) return "Airspace";
  if (/\b(REIL|PAPI|VASI|ALS|EDGE\s+LIGHT|RWY\s+LIGHT|TWY\s+LIGHT|LGT|LIGHTING)\b/.test(up)) return "Lighting";
  if (/\b(DEICE|DE-ICE|ANTI-ICE)\b/.test(up)) return "De-ice";
  if (/\b(HEL|HELIPAD|HELO|PAD)\b/.test(up)) return "Helipad";
  if (/\b(TWR|CTL|CONTROL|ATC|CLNC)\b/.test(up)) return "ATC / tower";
  // Last resort — a short snippet of the NOTAM subject beats the bucket word
  // "Other", which tells the reader nothing about what actually closed.
  const clean = text.trim().replace(/\s+/g, " ");
  const snippet = clean.slice(0, 22).trimEnd();
  if (!snippet) return category.charAt(0).toUpperCase() + category.slice(1);
  return snippet.length < clean.length ? `${snippet}…` : snippet;
}

const KIND_ORDER: Record<WindowKind, number> = { closure: 0, unserviceable: 1, limited: 2 };

export function closureWindows(notams: SitrepNotam[], nowMs: number, horizonH = 48): ClosureWindow[] {
  const horizonEnd = nowMs + horizonH * 3600_000;
  const out: ClosureWindow[] = [];
  for (const n of notams) {
    const kind = windowKind(n.text);
    if (!kind) continue;
    const startMs = n.start ? Date.parse(n.start) : NaN;
    const endMs = n.end ? Date.parse(n.end) : NaN;
    const hasStart = Number.isFinite(startMs);
    const hasEnd = Number.isFinite(endMs);
    if (!hasStart && !hasEnd) continue;                 // no parseable window → text row only
    const from = hasStart ? startMs : nowMs;            // already in effect
    const to = hasEnd ? endMs : horizonEnd;             // open-ended → horizon edge
    if (to <= nowMs || from >= horizonEnd || to <= from) continue;
    const base = {
      label: windowLabel(n.text, n.category),
      kind,
      text: n.text.slice(0, 160),
    };
    const clipFrom = Math.max(from, nowMs);
    const clipTo = Math.min(to, horizonEnd);

    // A day/hour schedule inside the validity span wins over the span itself.
    const rules = parseNotamSchedule(n.text);
    if (rules && rules.length > 0) {
      for (const occ of scheduleOccurrences(rules, clipFrom, clipTo)) {
        out.push({ ...base, fromMs: occ.fromMs, toMs: occ.toMs, openEnded: false, beyondHorizon: false, recurring: true });
      }
      // No occurrence inside the horizon means the condition simply isn't in
      // effect in the next 48 h. Drawing nothing is the correct answer — the
      // NOTAM still shows in the text list above.
      continue;
    }
    if (rules && rules.length === 0) {
      // Schedule markers present but the times didn't parse. A solid bar here
      // would be exactly the guess this timeline promises never to make, so
      // mark it indeterminate and let the UI draw it as "extent unknown".
      out.push({ ...base, fromMs: clipFrom, toMs: clipTo, openEnded: !hasEnd, beyondHorizon: hasEnd && endMs > horizonEnd, indeterminate: true });
      continue;
    }
    out.push({
      ...base,
      fromMs: clipFrom,
      toMs: clipTo,
      openEnded: !hasEnd,
      beyondHorizon: hasEnd && endMs > horizonEnd,
    });
  }
  return out
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.fromMs - b.fromMs)
    .slice(0, 24);   // a scheduled closure emits one bar PER occurrence, not one per NOTAM
}

const zHhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
};

// Runway/airfield closure windows that overlap a forecast IFR/LIFR segment —
// the "single-runway ops in instrument conditions" trap the text list hides.
export function windowConflicts(windows: ClosureWindow[], segments: TafSegment[]): string[] {
  const out: string[] = [];
  for (const w of windows) {
    if (w.kind !== "closure") continue;
    if (w.indeterminate) continue;   // unknown extent → cannot assert a weather overlap
    if (!/^RWY|^Airfield/.test(w.label)) continue;
    let worst: TafSegment | null = null;
    for (const s of segments) {
      if (s.cat !== "IFR" && s.cat !== "LIFR") continue;
      if (s.fromMs < w.toMs && s.toMs > w.fromMs) {
        if (!worst || CAT_RANK[s.cat] > CAT_RANK[worst.cat]) worst = s;
      }
    }
    if (worst) {
      out.push(`${w.label} ${w.kind} (${zHhmm(w.fromMs)}–${w.openEnded ? "UFN" : zHhmm(w.toMs)}) overlaps forecast ${worst.cat} (${zHhmm(worst.fromMs)}–${zHhmm(worst.toMs)})`);
    }
  }
  return [...new Set(out)].slice(0, 3);
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
