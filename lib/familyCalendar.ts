// Family dates for the Calendar tab — one dated list over data already stored.
//
// PURE, client-safe, unit-tested. No Gmail, no model, no new fetch: every input
// is a table or column the Family/Household features already maintain —
// `family_deadlines.due_iso`, `household_bills.due_date`, declared document
// expiries, declared expected-by dates. The Calendar tab showed events, tasks,
// keep-in-touch and trips and NONE of these, so the household ran on four
// lists that never met the week view.
//
// ── Discipline ────────────────────────────────────────────────────────────
// ONLY ANCHORED DATES. An undated deadline has no place on a calendar, and
// putting a guessed one there would be worse than leaving it off — the same
// refusal familyDates and familyDeadlines already make.
//
// A DOCUMENT'S ACTIONABLE DATE, NOT JUST ITS EXPIRY. A passport with a 183-day
// lead becomes actionable six months before it expires; both dates are shown,
// labelled, because the first is when you must act and the second is when the
// world stops accepting it.
//
// A BILL'S DUE DATE IS THE NEWEST SIGHTING'S. Older sightings of the same
// biller are history, not upcoming.

import type { StoredDeadline } from "./familyDeadlines";
import type { FamilyDocument, DocExpectationEntry, FamilyBiller } from "./familyProfile";
import { resolveLeadDays } from "./familyProposals";

export type FamilyDateKind = "deadline" | "bill" | "document" | "document-expiry" | "expected";

export interface FamilyDate {
  id: string;
  dateISO: string;          // yyyy-mm-dd
  kind: FamilyDateKind;
  title: string;
  /** One clause of context for the row. */
  note?: string;
  /** Presentation tone; "late" when the date has passed and the item is still open. */
  tone: "late" | "soon" | "normal" | "handled";
  personId?: string | null;
}

/** A bill sighting, narrowed to what this needs. */
export interface BillSightingLite {
  billerId: string;
  seenISO: string;
  dueISO: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

const shift = (iso: string, days: number): string | null => {
  if (!ISO.test(iso)) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t + days * DAY).toISOString().slice(0, 10) : null;
};

const daysFrom = (iso: string, today: string): number | null => {
  if (!ISO.test(iso) || !ISO.test(today)) return null;
  const a = Date.parse(`${iso}T00:00:00Z`), b = Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((a - b) / DAY) : null;
};

/** Within this many days a date is "soon". */
export const SOON_DAYS = 7;
/** Dates older than this are dropped — the calendar is about what is ahead;
 *  the Family tab keeps the full lapsed record. */
export const LOOKBACK_DAYS = 7;

function toneFor(dateISO: string, today: string, handled: boolean): FamilyDate["tone"] {
  if (handled) return "handled";
  const n = daysFrom(dateISO, today);
  if (n === null) return "normal";
  if (n < 0) return "late";
  if (n <= SOON_DAYS) return "soon";
  return "normal";
}

export function familyDates(
  input: {
    deadlines: StoredDeadline[];
    billers: FamilyBiller[];
    sightings: BillSightingLite[];
    documents: FamilyDocument[];
    expectations: DocExpectationEntry[];
  },
  today: string,
  opts: { lookbackDays?: number; horizonDays?: number } = {},
): FamilyDate[] {
  const lookback = opts.lookbackDays ?? LOOKBACK_DAYS;
  const horizon = opts.horizonDays ?? 120;
  const out: FamilyDate[] = [];

  const inWindow = (iso: string): boolean => {
    const n = daysFrom(iso, today);
    return n !== null && n >= -lookback && n <= horizon;
  };

  // 1. Tracked deadlines — anchored only; handled ones are shown dimmed within
  //    the window (you may still want to see what you finished this week).
  for (const d of input.deadlines) {
    if (!d.dueISO || !ISO.test(d.dueISO) || !inWindow(d.dueISO)) continue;
    const handled = d.state === "done" || d.state === "dismissed";
    out.push({
      id: `dl:${d.id}`, dateISO: d.dueISO, kind: "deadline", title: d.title,
      note: d.buried ? "buried in a longer newsletter" : undefined,
      tone: toneFor(d.dueISO, today, handled), personId: d.personId,
    });
  }

  // 2. Bills — newest sighting per biller that carries a due date.
  const newest = new Map<string, BillSightingLite>();
  for (const s of input.sightings) {
    if (!s.dueISO || !ISO.test(s.dueISO)) continue;
    const cur = newest.get(s.billerId);
    if (!cur || s.seenISO > cur.seenISO) newest.set(s.billerId, s);
  }
  const billerById = new Map(input.billers.map((b) => [b.id, b]));
  for (const [billerId, s] of newest) {
    if (!s.dueISO || !inWindow(s.dueISO)) continue;
    const b = billerById.get(billerId);
    out.push({
      id: `bill:${billerId}:${s.dueISO}`, dateISO: s.dueISO, kind: "bill",
      title: b?.label ?? billerId,
      note: b?.autopay ? "autopay" : "manual — will not pay itself",
      tone: b?.autopay ? "normal" : toneFor(s.dueISO, today, false),
    });
  }

  // 3. Documents — the actionable date (expiry − lead) and the expiry itself.
  for (const doc of input.documents) {
    if (!ISO.test(doc.expiresISO)) continue;
    // Declared lead wins; otherwise the type default (a passport is unusable
    // six months out whether or not anyone typed 183).
    const lead = resolveLeadDays(doc);
    if (lead > 0) {
      const act = shift(doc.expiresISO, -lead);
      if (act && inWindow(act)) {
        out.push({
          id: `doc:${doc.id}:act`, dateISO: act, kind: "document",
          title: `${doc.label} — renew by`,
          note: `${lead}-day lead${doc.leadDays ? "" : " (type default)"}; expires ${doc.expiresISO}`,
          tone: toneFor(act, today, false),
        });
      }
    }
    if (inWindow(doc.expiresISO)) {
      out.push({
        id: `doc:${doc.id}:exp`, dateISO: doc.expiresISO, kind: "document-expiry",
        title: `${doc.label} expires`, note: doc.note, tone: toneFor(doc.expiresISO, today, false),
      });
    }
  }

  // 4. Expected documents — the by-date. Arrival status lives on the Family tab;
  //    here the date is the point.
  for (const x of input.expectations) {
    if (!ISO.test(x.byISO) || !inWindow(x.byISO)) continue;
    out.push({
      id: `exp:${x.id}`, dateISO: x.byISO, kind: "expected",
      title: `${x.label} — expected by`, note: `watching for “${x.match}”`,
      tone: toneFor(x.byISO, today, false),
    });
  }

  out.sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));
  return out;
}

/** Group for a day-keyed calendar. */
export function familyDatesByDay(items: FamilyDate[]): Map<string, FamilyDate[]> {
  const m = new Map<string, FamilyDate[]>();
  for (const it of items) (m.get(it.dateISO) ?? m.set(it.dateISO, []).get(it.dateISO)!).push(it);
  return m;
}

export const FAMILY_DATE_GLYPH: Record<FamilyDateKind, string> = {
  deadline: "⚑", bill: "$", document: "⬒", "document-expiry": "⬒", expected: "⬒",
};
