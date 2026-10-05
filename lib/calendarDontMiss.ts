// The Calendar's "Don't miss" list and the agenda hygiene around it —
// PURE, client-safe, unit-tested (REVIEW-2026-10 C1–C3, C9).
//
// Four sources each kept their own overdue state in four places on one
// screen — family deadlines (LATE), tasks (Overdue), keep-in-touch (overdue
// / never contacted), tasks due this week. One list, deduplicated, each row
// with its source and the action it needs. Late items LEAVE the agenda:
// a calendar that opens on last Thursday reads as broken.

import type { FamilyDate } from "./familyCalendar";
import type { GoogleTask } from "./types";
import type { Contact, ContactStatus } from "./contacts";

export type DontMissSource = "family" | "task" | "people";
export type DontMissSeverity = "late" | "today" | "week";

export interface DontMissRow {
  id: string;
  source: DontMissSource;
  severity: DontMissSeverity;
  title: string;
  sub: string;
  /** "late 4 d" · "today" · "this week" · "overdue 18 d" · "never contacted" */
  when: string;
  /** Days late (positive) for ordering; 0 otherwise. */
  lateDays: number;
  family?: FamilyDate & { mergedCount: number };
  task?: GoogleTask;
  contact?: Contact & { status: ContactStatus };
}

const DAY = 86_400_000;
const dayNum = (ymd: string): number => Math.round(Date.parse(`${ymd}T00:00:00Z`) / DAY);
const tokens = (s: string): Set<string> => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3));

/** Title overlap at or above this merges two family rows on the same date. */
export const MERGE_OVERLAP = 0.6;

function overlap(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let n = 0;
  for (const w of ta) if (tb.has(w)) n++;
  return n / Math.min(ta.size, tb.size);
}

/** One row per obligation: same date + kind + title overlap ≥ MERGE_OVERLAP.
 *  Render-time only — the store keeps every extraction (its key is message +
 *  title by design, so one deadline in three newsletters is three rows). */
export function dedupeFamilyDates(items: FamilyDate[]): (FamilyDate & { mergedCount: number; mergedIds: string[] })[] {
  const out: (FamilyDate & { mergedCount: number; mergedIds: string[] })[] = [];
  for (const it of items) {
    const hit = out.find((o) => o.dateISO === it.dateISO && o.kind === it.kind && overlap(o.title, it.title) >= MERGE_OVERLAP);
    if (hit) {
      hit.mergedCount++;
      hit.mergedIds.push(it.id);
      // The shortest title tends to be the cleanest.
      if (it.title.length < hit.title.length) hit.title = it.title;
      // A late/soon tone outranks handled.
      if (hit.tone === "handled" && it.tone !== "handled") hit.tone = it.tone;
    } else {
      out.push({ ...it, mergedCount: 1, mergedIds: [it.id] });
    }
  }
  return out;
}

/** The agenda keeps only today and the future (and never a handled past). */
export function agendaFamilyDates<T extends FamilyDate>(items: T[], today: string): T[] {
  return items.filter((f) => f.dateISO >= today);
}

export const taskDue = (t: Pick<GoogleTask, "due">): string | null => (t.due ? t.due.slice(0, 10) : null);

export function dontMissRows(input: {
  famDates: (FamilyDate & { mergedCount: number })[];
  tasks: GoogleTask[];
  contacts: (Contact & { status: ContactStatus })[];
  today: string;
}): DontMissRow[] {
  const { today } = input;
  const tn = dayNum(today);
  const rows: DontMissRow[] = [];

  for (const f of input.famDates) {
    if (f.tone === "handled") continue;
    const n = dayNum(f.dateISO);
    if (!Number.isFinite(n) || n > tn) continue;
    const late = tn - n;
    rows.push({
      id: `fam:${f.id}`, source: "family", severity: late > 0 ? "late" : "today",
      title: f.title,
      sub: [f.mergedCount > 1 ? `×${f.mergedCount} mentions` : "", f.dateISO.slice(5).replace("-", "/"), f.note ?? ""].filter(Boolean).join(" · "),
      when: late > 0 ? `late ${late} d` : "today", lateDays: late, family: f,
    });
  }

  for (const t of input.tasks) {
    if (t.status === "completed") continue;
    const d = taskDue(t);
    if (!d) continue;
    const n = dayNum(d);
    if (!Number.isFinite(n) || n - tn > 7) continue;
    const late = tn - n;
    rows.push({
      id: `task:${t.id}`, source: "task", severity: late > 0 ? "late" : late === 0 ? "today" : "week",
      title: t.title, sub: [`due ${d.slice(5).replace("-", "/")}`, t.notes ? t.notes.split("\n")[0].slice(0, 80) : ""].filter(Boolean).join(" · "),
      when: late > 0 ? `late ${late} d` : late === 0 ? "today" : "this week", lateDays: Math.max(0, late), task: t,
    });
  }

  for (const c of input.contacts) {
    const s = c.status.state;
    if (s !== "never" && s !== "overdue" && s !== "due") continue;
    const late = s === "overdue" ? Math.abs(c.status.daysUntil ?? 0) : s === "never" ? 0 : 0;
    rows.push({
      id: `ppl:${c.id}`, source: "people", severity: s === "due" ? "today" : "late",
      title: c.name, sub: `every ${c.cadenceDays} d`,
      when: s === "never" ? "never contacted" : s === "overdue" ? `overdue ${late} d` : "due today", lateDays: late, contact: c,
    });
  }

  const sev: Record<DontMissSeverity, number> = { late: 0, today: 1, week: 2 };
  return rows.sort((a, b) => sev[a.severity] - sev[b.severity] || b.lateDays - a.lateDays || a.title.localeCompare(b.title));
}

export interface TodayCounts { overdueTasks: number; familyDue: number; checkinsDue: number }

export function todayCounts(rows: DontMissRow[]): TodayCounts {
  return {
    overdueTasks: rows.filter((r) => r.source === "task" && r.severity === "late").length,
    familyDue: rows.filter((r) => r.source === "family").length,
    checkinsDue: rows.filter((r) => r.source === "people").length,
  };
}

/** "TDY · Amman — day 5 of 9" for a day inside a trip; null otherwise. */
export function tripChipFor(ymd: string, trips: { label: string; startDate: string; endDate: string }[]): string | null {
  const t = trips.filter((x) => x.startDate <= ymd && x.endDate >= ymd).sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
  if (!t) return null;
  const days = Math.max(1, dayNum(t.endDate) - dayNum(t.startDate) + 1);
  const day = Math.min(days, Math.max(1, dayNum(ymd) - dayNum(t.startDate) + 1));
  return `TDY · ${t.label.split(/[,(]/)[0].trim()} — day ${day} of ${days}`;
}
