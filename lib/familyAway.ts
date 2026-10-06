// "While you are away" as the list for the call home.
// PURE, client-safe, unit-tested (REVIEW-2026-10 F6).
//
// The old block matched every trip the app had ever stored, so a lapsed
// item inside a trip that ended months ago still read "while you are in X",
// and every row repeated the trip's dates. This picks ONE trip — the one
// you are on, else the next one — names it once, and splits what has
// ALREADY HAPPENED since you left (the things to ask the kids about) from
// what is still AHEAD before you are back. Only anchored dates, never a
// guess; handled items count as happened (they happened), never as ahead.

import { withinTrip, type TripWindow, type DatedItem } from "./familyTripConflict";

export interface AwayRow {
  id: string;
  kind: DatedItem["kind"];
  title: string;
  dateISO: string;
  personId: string | null;
  handled: boolean;
}

export interface AwayList {
  trip: TripWindow;
  /** "on" = inside the trip today; "ahead" = the trip has not started. */
  status: "on" | "ahead";
  /** Day N of M (inclusive), when on the trip. */
  day: number | null;
  days: number;
  happened: AwayRow[];
  ahead: AwayRow[];
}

const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayNum = (ymd: string) => Math.round(Date.parse(`${ymd}T00:00:00Z`) / DAY);

/** The trip you are on today, else the next one to start. Past trips never match. */
export function pickTrip(trips: TripWindow[], today: string): { trip: TripWindow; status: "on" | "ahead" } | null {
  const ok = trips.filter((t) => ISO.test(t.startDate) && ISO.test(t.endDate) && t.endDate >= t.startDate);
  const on = ok.filter((t) => t.startDate <= today && t.endDate >= today).sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  if (on) return { trip: on, status: "on" };
  const next = ok.filter((t) => t.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  return next ? { trip: next, status: "ahead" } : null;
}

export function awayList(items: DatedItem[], trips: TripWindow[], today: string, opts: { lookbackDays?: number; max?: number } = {}): AwayList | null {
  const picked = pickTrip(trips, today);
  if (!picked) return null;
  const { trip, status } = picked;
  const lookback = opts.lookbackDays ?? 14;
  const max = opts.max ?? 10;
  const tn = dayNum(today);
  const happened: AwayRow[] = [];
  const ahead: AwayRow[] = [];
  for (const it of items) {
    if (!it.dateISO || !ISO.test(it.dateISO)) continue;    // never guess
    if (!withinTrip(it.dateISO, trip)) continue;
    const row: AwayRow = { id: it.id, kind: it.kind, title: it.title, dateISO: it.dateISO, personId: it.personId ?? null, handled: !!it.handled };
    const n = dayNum(it.dateISO);
    if (n < tn) { if (tn - n <= lookback) happened.push(row); }
    else if (!row.handled) ahead.push(row);
  }
  const byDate = (a: AwayRow, b: AwayRow) => a.dateISO.localeCompare(b.dateISO) || (a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === "deadline" ? -1 : 1);
  happened.sort(byDate); ahead.sort(byDate);
  const days = Math.max(1, dayNum(trip.endDate) - dayNum(trip.startDate) + 1);
  const day = status === "on" ? Math.min(days, Math.max(1, tn - dayNum(trip.startDate) + 1)) : null;
  return { trip, status, day, days, happened: happened.slice(-max), ahead: ahead.slice(0, max) };
}

/** Plain-text list for the clipboard — one line per item, grouped. */
export function awayText(list: AwayList, nameOf: (personId: string | null) => string): string {
  const line = (r: AwayRow) => `- ${r.dateISO.slice(5).replace("-", "/")} · ${nameOf(r.personId)} — ${r.title}`;
  const parts: string[] = [`While I am away (${list.trip.label}, ${list.trip.startDate} → ${list.trip.endDate})`];
  if (list.happened.length) parts.push("", "Happened since I left:", ...list.happened.map(line));
  if (list.ahead.length) parts.push("", "Before I am back:", ...list.ahead.map(line));
  return parts.join("\n");
}
