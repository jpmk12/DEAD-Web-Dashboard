// Moves & counter-moves timeline — PURE, client-safe, unit-tested.
//
// The review's step D: sequence is the predictive signal in economic warfare
// (designation → seizure → premium spike → counter-designation). The tab had
// every one of those in a separate card and no time axis. This module puts
// them on one axis and names the sequences — a counter-move within days of
// a pressure move is a pattern the reader can LEARN, which is the whole of
// "predict" that a rules-based board can honestly offer.
//
// Dot kinds:  us       — a U.S. action (Federal Register)
//             foreign  — an EU / UK designation wave
//             actor    — the actor's own act or declared threat (analysis is
//                        NOT plotted: commentary is not a move)
//             shipping — a georeferenced incident at the actor's chokepoint
//             market   — a Brent day-over-day move beyond MARKET_MOVE_PCT
// An undated move cannot be placed and is omitted from the strip (it stays
// on the coercion board); a date is never guessed.

import type { CoercionMove } from "./economicWarfare";

export type DotKind = "us" | "foreign" | "actor" | "shipping" | "market";

export interface TimelineDot {
  day: string;                 // yyyy-mm-dd
  kind: DotKind;
  label: string;
  actorId?: string;
  actorLabel?: string;
  /** Relative size for the strip (0-100). */
  weight: number;
  link?: string;
}

export interface Sequence {
  actorId: string;
  actorLabel: string;
  /** "retaliation": pressure (us/foreign) then the actor moved within the window.
   *  "counter": the actor moved, then pressure followed within the window. */
  kind: "retaliation" | "counter";
  firstDay: string;
  firstLabel: string;
  secondDay: string;
  secondLabel: string;
  gapDays: number;
}

export interface ShippingIncident {
  date?: string;
  title: string;
  chokepointName: string;
  actorId: string;
  actorLabel: string;
}

export interface PricePoint { date: string; close: number }

export const TIMELINE_DAYS = 30;
export const SEQUENCE_WINDOW_DAYS = 10;
export const MARKET_MOVE_PCT = 3;

const DAY = 86_400_000;
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function dayOf(pubDate: string | undefined): string | null {
  if (!pubDate) return null;
  if (isYmd(pubDate)) return pubDate;
  const t = Date.parse(pubDate);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/** The day columns, oldest → newest, ending on `today`. */
export function timelineDays(today: string, days = TIMELINE_DAYS): string[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(end)) return [];
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(new Date(end - i * DAY).toISOString().slice(0, 10));
  return out;
}

const gap = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

export function buildTimeline(input: {
  moves: CoercionMove[];
  incidents?: ShippingIncident[];
  brent?: PricePoint[];
  today: string;
  days?: number;
}): { days: string[]; dots: TimelineDot[]; sequences: Sequence[] } {
  const days = timelineDays(input.today, input.days ?? TIMELINE_DAYS);
  if (days.length === 0) return { days: [], dots: [], sequences: [] };
  const inWindow = new Set(days);
  const dots: TimelineDot[] = [];

  for (const m of input.moves) {
    if (m.modality === "analysis") continue;
    const day = dayOf(m.pubDate);
    if (!day || !inWindow.has(day)) continue;
    const kind: DotKind = m.direction === "by"
      ? "actor"
      : /^EU |^UK /.test(m.source ?? "") ? "foreign" : "us";
    dots.push({
      day, kind,
      label: kind === "actor" ? `${m.actorLabel}: ${m.cls} (${m.modality})` : `${m.source ?? "U.S."} → ${m.actorLabel}: ${m.cls}`,
      actorId: m.actorId, actorLabel: m.actorLabel,
      weight: Math.max(10, Math.min(100, m.weight)),
      link: m.link,
    });
  }

  for (const inc of input.incidents ?? []) {
    const day = inc.date && isYmd(inc.date) ? inc.date : null;
    if (!day || !inWindow.has(day)) continue;
    dots.push({ day, kind: "shipping", label: `${inc.chokepointName}: ${inc.title}`, actorId: inc.actorId, actorLabel: inc.actorLabel, weight: 60 });
  }

  const series = (input.brent ?? []).filter((p) => isYmd(p.date) && Number.isFinite(p.close));
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].close;
    if (!prev) continue;
    const pct = ((series[i].close - prev) / prev) * 100;
    if (Math.abs(pct) < MARKET_MOVE_PCT || !inWindow.has(series[i].date)) continue;
    dots.push({ day: series[i].date, kind: "market", label: `Brent ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% on the day`, weight: Math.min(100, 40 + Math.abs(pct) * 8) });
  }

  dots.sort((a, b) => a.day.localeCompare(b.day) || b.weight - a.weight);
  return { days, dots, sequences: findSequences(dots) };
}

/** Pressure-then-response and move-then-counter pairs per actor inside the
 *  window. One sequence per (pressure dot), the nearest response; a dot is
 *  used as the response of at most one sequence so a single seizure is not
 *  "retaliation" for five designations at once. */
export function findSequences(dots: TimelineDot[], windowDays = SEQUENCE_WINDOW_DAYS): Sequence[] {
  const out: Sequence[] = [];
  const byActor = new Map<string, TimelineDot[]>();
  for (const d of dots) if (d.actorId) (byActor.get(d.actorId) ?? byActor.set(d.actorId, []).get(d.actorId)!).push(d);

  for (const [actorId, list] of byActor) {
    const pressure = list.filter((d) => d.kind === "us" || d.kind === "foreign");
    const own = list.filter((d) => d.kind === "actor" || d.kind === "shipping");
    const used = new Set<TimelineDot>();
    const label = list[0].actorLabel ?? actorId;

    for (const p of pressure) {
      const resp = own.filter((o) => !used.has(o) && gap(p.day, o.day) >= 0 && gap(p.day, o.day) <= windowDays)
        .sort((a, b) => a.day.localeCompare(b.day))[0];
      if (!resp) continue;
      used.add(resp);
      out.push({ actorId, actorLabel: label, kind: "retaliation", firstDay: p.day, firstLabel: p.label, secondDay: resp.day, secondLabel: resp.label, gapDays: gap(p.day, resp.day) });
    }
    const usedP = new Set<TimelineDot>();
    for (const o of own) {
      const counter = pressure.filter((p) => !usedP.has(p) && gap(o.day, p.day) > 0 && gap(o.day, p.day) <= windowDays)
        .sort((a, b) => a.day.localeCompare(b.day))[0];
      if (!counter) continue;
      usedP.add(counter);
      out.push({ actorId, actorLabel: label, kind: "counter", firstDay: o.day, firstLabel: o.label, secondDay: counter.day, secondLabel: counter.label, gapDays: gap(o.day, counter.day) });
    }
  }
  return out.sort((a, b) => b.secondDay.localeCompare(a.secondDay) || a.gapDays - b.gapDays);
}
