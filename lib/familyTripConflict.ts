// "That deadline falls while you are away."
//
// PURE, client-safe, unit-tested. No model call, no new fetch — a join over two
// things the app already holds and has never compared: your trips (`trips`,
// synced from the calendar) and your family's dated obligations.
//
// Why it earns a place: for someone who flies for a living, WHEN a deadline
// lands matters as much as what it is. A form due Thursday is routine; a form
// due Thursday while you are in Stuttgart is a thing you will not do. Neither
// the Family tab nor the trip list can see this — one knows the date, the other
// knows the absence, and nothing put them together.
//
// ── Discipline ────────────────────────────────────────────────────────────
// ONLY ANCHORED DATES PRODUCE A CONFLICT. An undated deadline cannot be shown
// to fall inside a trip, and guessing would be the same invention
// `familyDates` refuses to make and `familyDeadlines` refuses to lapse on.
//
// A HANDLED ITEM IS NOT A CONFLICT. Something marked done needs nothing from
// you while you are away, and reporting it would dilute the rows that do.
//
// THE RETURN DAY IS NOT "AWAY". A trip's end date is the day you get back, so a
// deadline that lands on it is tight, not impossible — it is reported as
// `returns` rather than `away`, because telling someone they cannot do
// something they can is how a warning surface loses its credibility.

/** The trip fields this module needs — deliberately narrow so `lib/trips`
 *  (server-only) never has to be imported by a client component. */
export interface TripWindow {
  id: string;
  label: string;
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
}

/** A dated thing that might need you. */
export interface DatedItem {
  id: string;
  kind: "deadline" | "event";
  title: string;
  /** YYYY-MM-DD, or null when the source never gave one. */
  dateISO: string | null;
  personId?: string | null;
  /** True when the user has already dealt with it. */
  handled?: boolean;
}

export type ConflictSeverity = "away" | "returns";

export interface TripConflict {
  item: DatedItem;
  trip: TripWindow;
  severity: ConflictSeverity;
  /** Whole days into the trip the item falls — 0 is departure day. */
  dayOfTrip: number;
  /** The row in one sentence. */
  reason: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

const parse = (d: string): number | null => {
  if (!ISO.test(d)) return null;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
};

/** Inclusive containment, both ends. A malformed window matches nothing rather
 *  than everything — an unbounded trip would flag every deadline you have. */
export function withinTrip(dateISO: string, trip: TripWindow): boolean {
  const d = parse(dateISO), s = parse(trip.startDate), e = parse(trip.endDate);
  if (d === null || s === null || e === null || e < s) return false;
  return d >= s && d <= e;
}

export function findTripConflicts(
  items: DatedItem[],
  trips: TripWindow[],
  opts: { max?: number } = {},
): TripConflict[] {
  const out: TripConflict[] = [];

  for (const item of items) {
    if (item.handled) continue;
    if (!item.dateISO || !ISO.test(item.dateISO)) continue;   // never guess
    const d = parse(item.dateISO);
    if (d === null) continue;

    for (const trip of trips) {
      if (!withinTrip(item.dateISO, trip)) continue;
      const s = parse(trip.startDate)!;
      const e = parse(trip.endDate)!;
      // The end date is the day you get back — tight, not impossible.
      const severity: ConflictSeverity = d === e ? "returns" : "away";
      const dayOfTrip = Math.round((d - s) / DAY);
      const what = item.kind === "deadline" ? "is due" : "falls";
      out.push({
        item, trip, severity, dayOfTrip,
        reason: severity === "returns"
          ? `${what} on ${item.dateISO}, the day you return from ${trip.label}`
          : `${what} on ${item.dateISO}, while you are in ${trip.label} (${trip.startDate} → ${trip.endDate})`,
      });
      break; // one conflict per item; overlapping trips would just repeat it
    }
  }

  // Soonest first, and a deadline before an event on the same day: an event is
  // something you will miss, a deadline is something that will go undone.
  out.sort((a, b) => {
    const c = (a.item.dateISO ?? "").localeCompare(b.item.dateISO ?? "");
    if (c !== 0) return c;
    if (a.item.kind !== b.item.kind) return a.item.kind === "deadline" ? -1 : 1;
    return a.item.title.localeCompare(b.item.title);
  });
  return out.slice(0, opts.max ?? 8);
}

/** Header sentence, or null when there is nothing to say. */
export function conflictLine(conflicts: TripConflict[]): string | null {
  if (conflicts.length === 0) return null;
  const deadlines = conflicts.filter((c) => c.item.kind === "deadline").length;
  const events = conflicts.length - deadlines;
  const parts: string[] = [];
  if (deadlines > 0) parts.push(`${deadlines} deadline${deadlines === 1 ? "" : "s"}`);
  if (events > 0) parts.push(`${events} event${events === 1 ? "" : "s"}`);
  return `${parts.join(" and ")} land while you are away`;
}
