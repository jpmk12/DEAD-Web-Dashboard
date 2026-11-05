// Crisis-map batch 2 helpers — PURE, client-safe, tested in
// tests/mapLayers.test.ts. Each one turns a read the app ALREADY computes
// into something the map can draw; none of them sets a level.
//
//   • straitTone — the chokepoint board's graded read as one marker colour:
//     a reported act › a declared threat › reporting › quiet. Quiet is
//     "no reporting", never green (absence of signal, not evidence of calm).
//   • boardArea — an I&W board's declared box, coloured by the board's level.
//   • lineLegs — a declared line as legs between consecutive PLACED fields,
//     each leg coloured by the worse of its two ends; an unplaced field is
//     named and its legs left out (never a guessed position).
//   • the time window — filters EVENTS (things that happened: strikes,
//     incidents, disasters), never CONDITIONS in effect (an ordered departure,
//     a storm, a hazard). An undated event stays visible and is counted as
//     undated, so a window never silently hides what the source did not date.

import type { IwLevel } from "./commandBoard";
import type { LineLed, LineRead } from "./lineRead";

// ── Straits ──
export type StraitTone = "act" | "threat" | "reporting" | "quiet";

export interface StraitReadLite {
  acts: number;
  threats: number;
  analysis: number;
  events: unknown[];
  line?: string | null;
  transit?: { state?: string; why?: string } | null;
}

export function straitTone(r: StraitReadLite): StraitTone {
  if (r.acts > 0) return "act";
  if (r.threats > 0) return "threat";
  if (r.analysis >= 2 || r.events.length >= 3) return "reporting";
  return "quiet";
}

export const STRAIT_COLOR: Record<StraitTone, string> = {
  act: "#ef4444",
  threat: "#f59e0b",
  reporting: "#94a3b8",
  quiet: "#475569",
};

export function straitLabel(r: StraitReadLite): string {
  const t = straitTone(r);
  const parts = [
    t === "act" ? `${r.acts} reported act${r.acts === 1 ? "" : "s"}`
      : t === "threat" ? `${r.threats} declared threat${r.threats === 1 ? "" : "s"}`
      : t === "reporting" ? "reporting, no act or threat"
      : "no reporting — absence of signal, not calm",
  ];
  const ts = r.transit?.state;
  if (ts === "suppressed" || ts === "elevated") parts.push(`AIS traffic ${ts.toUpperCase()}`);
  else if (ts === "normal") parts.push("AIS traffic normal");
  else if (ts) parts.push(`AIS ${ts}`);
  return parts.join(" · ");
}

// ── I&W board areas ──
export interface BoardAreaIn { problemId: string; label: string; level: IwLevel; learning: boolean; bbox?: { latMin: number; latMax: number; lonMin: number; lonMax: number } }
export interface BoardArea { problemId: string; label: string; level: IwLevel; learning: boolean; bounds: [[number, number], [number, number]]; color: string; weight: number; dash?: string }

const LEVEL_COLOR: Record<IwLevel, string> = { calm: "#64748b", watch: "#38bdf8", warning: "#f59e0b", alert: "#ef4444" };

export function boardAreas(boards: BoardAreaIn[]): BoardArea[] {
  const seen = new Set<string>();
  const out: BoardArea[] = [];
  for (const b of boards) {
    const x = b.bbox;
    if (!x || seen.has(b.problemId)) continue;
    if (![x.latMin, x.latMax, x.lonMin, x.lonMax].every(Number.isFinite) || x.latMin >= x.latMax || x.lonMin >= x.lonMax) continue;
    seen.add(b.problemId);
    out.push({
      problemId: b.problemId, label: b.label, level: b.level, learning: b.learning,
      bounds: [[x.latMin, x.lonMin], [x.latMax, x.lonMax]],
      color: LEVEL_COLOR[b.level],
      weight: b.level === "alert" || b.level === "warning" ? 2 : 1.2,
      // A board still learning its baseline is drawn dashed — its level is held.
      dash: b.learning ? "6 5" : undefined,
    });
  }
  return out;
}

// ── Lines as routes ──
export const LINE_LED_COLOR: Record<LineLed, string> = { g: "#10b981", a: "#f59e0b", r: "#ef4444", u: "#94a3b8" };
const LED_RANK: Record<LineLed, number> = { g: 0, u: 1, a: 2, r: 3 };

export interface LineLeg { from: string; to: string; path: [[number, number], [number, number]]; led: LineLed }
export interface LineRoute { id: string; label: string; dayLabel: string; status: string; worst: LineLed; legs: LineLeg[]; unplaced: string[]; points: { icao: string; at: [number, number]; led: LineLed }[] }

export function lineRoutes(reads: Pick<LineRead, "id" | "label" | "dayLabel" | "status" | "worst" | "perField">[]): LineRoute[] {
  return reads.map((r) => {
    const placed = r.perField.filter((f) => f.at);
    const unplaced = r.perField.filter((f) => !f.at).map((f) => f.icao);
    const legs: LineLeg[] = [];
    for (let i = 1; i < placed.length; i++) {
      const a = placed[i - 1], b = placed[i];
      if (a.icao === b.icao) continue;
      legs.push({
        from: a.icao, to: b.icao,
        path: [[a.at!.lat, a.at!.lon], [b.at!.lat, b.at!.lon]],
        led: LED_RANK[a.worst] >= LED_RANK[b.worst] ? a.worst : b.worst,
      });
    }
    return {
      id: r.id, label: r.label, dayLabel: r.dayLabel, status: r.status, worst: r.worst, legs, unplaced: [...new Set(unplaced)],
      points: placed.map((f) => ({ icao: f.icao, at: [f.at!.lat, f.at!.lon] as [number, number], led: f.worst })),
    };
  });
}

// ── Time window ──
export type TimeWindowKey = "24h" | "72h" | "7d" | "30d" | "all";
export const TIME_WINDOWS: { key: TimeWindowKey; label: string; hours: number | null }[] = [
  { key: "24h", label: "24 h", hours: 24 },
  { key: "72h", label: "72 h", hours: 72 },
  { key: "7d", label: "7 d", hours: 24 * 7 },
  { key: "30d", label: "30 d", hours: 24 * 30 },
  { key: "all", label: "all", hours: null },
];

export function windowHours(key: TimeWindowKey): number | null {
  return TIME_WINDOWS.find((w) => w.key === key)?.hours ?? null;
}

/** Does an EVENT with this time fall inside the window? Undated → true (the
 *  caller counts it as undated); a date-only stamp counts for its whole day. */
export function inWindow(time: string | null | undefined, nowMs: number, hours: number | null): boolean {
  if (hours == null) return true;
  if (!time) return true;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(time.trim());
  const t = Date.parse(dateOnly ? `${time.trim()}T23:59:59Z` : time);
  if (!Number.isFinite(t)) return true;
  return t >= nowMs - hours * 3_600_000;
}

/** Count what a window keeps, hides and could not judge. */
export function windowTally(times: (string | null | undefined)[], nowMs: number, hours: number | null): { kept: number; hidden: number; undated: number } {
  let kept = 0, hidden = 0, undated = 0;
  for (const t of times) {
    const parsed = t ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(t.trim()) ? `${t.trim()}T23:59:59Z` : t) : NaN;
    if (!t || !Number.isFinite(parsed)) { undated++; kept++; continue; }
    if (inWindow(t, nowMs, hours)) kept++; else hidden++;
  }
  return { kept, hidden, undated };
}
