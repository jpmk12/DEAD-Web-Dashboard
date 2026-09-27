// Validation for dates the model extracts from family mail. PURE, client-safe,
// unit-tested.
//
// The load-bearing rule, inherited from the SITREP closure timeline: NEVER a
// guessed date. School mail is full of "next Friday", "the 15th", "first day
// back" — a model asked for ISO output will happily resolve those, and a wrong
// date on a real calendar is worse than no date, because it is silently
// trusted. Anything the model could not anchor to an explicit calendar date
// comes back needing confirmation, and confirmation is a human tap.

export interface ProposedEvent {
  id: string;
  title: string;
  personId: string | null;
  startISO: string | null;   // null = could not be anchored
  endISO: string | null;
  allDay: boolean;
  sourceId: string;          // gmail message id
  sourceLabel: string;       // "Oakwood Weekly Update · 24 Sep"
  // Set when the mail expressed the date relatively; carries the phrase so the
  // UI can show WHY it wants confirmation rather than just demanding it.
  relativePhrase?: string;
  needsConfirm: boolean;
  // A date that supersedes something already on the calendar (a rescheduled
  // meet). Catching the move matters more than catching the new event — the
  // stale entry is what actually sends you out on the wrong day.
  supersedes?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?$/;

export function isAnchoredDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (!ISO_DATE.test(v) && !ISO_DATETIME.test(v)) return false;
  return Number.isFinite(Date.parse(v.length === 10 ? `${v}T12:00:00Z` : v));
}

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

// Normalise one raw model object into a ProposedEvent, or null if it is too
// malformed to show. A missing/garbage date is NOT a reason to drop the row —
// the user still wants to know the event exists — it is a reason to mark it
// needsConfirm so it can never be written unattended.
export function normalizeProposed(
  raw: unknown,
  opts: { validPersonIds: Set<string>; nowMs: number; horizonDays?: number },
): ProposedEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const title = str(o.title, 140);
  const sourceId = str(o.sourceId, 80);
  if (!title || !sourceId) return null;

  const startRaw = o.startISO;
  const anchored = isAnchoredDate(startRaw);
  const relativePhrase = str(o.relativePhrase, 80);

  // Reject an "anchored" date that is absurd — a model that hallucinates a
  // year is worse than one that admits it does not know.
  let startISO: string | null = anchored ? (startRaw as string) : null;
  if (startISO) {
    const ms = Date.parse(startISO.length === 10 ? `${startISO}T12:00:00Z` : startISO);
    const horizon = (opts.horizonDays ?? 400) * 86_400_000;
    if (ms < opts.nowMs - 30 * 86_400_000 || ms > opts.nowMs + horizon) startISO = null;
  }

  const allDay = startISO !== null ? startISO.length === 10 : o.allDay === true;
  const endISO = isAnchoredDate(o.endISO) ? (o.endISO as string) : null;

  const personIdRaw = str(o.personId, 40);
  const personId = personIdRaw && opts.validPersonIds.has(personIdRaw) ? personIdRaw : null;

  return {
    id: `${sourceId}:${slugTitle(title)}`,
    title,
    personId,
    startISO,
    endISO,
    allDay,
    sourceId,
    sourceLabel: str(o.sourceLabel, 120),
    ...(relativePhrase ? { relativePhrase } : {}),
    // Confirmation is required whenever the date is not anchored, OR the mail
    // said something relative even if the model also produced a date — in that
    // case the date IS the model's guess, which is exactly what we don't trust.
    needsConfirm: startISO === null || relativePhrase.length > 0,
    ...(str(o.supersedes, 140) ? { supersedes: str(o.supersedes, 140) } : {}),
  };
}

function slugTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

// Google Calendar wants an end; an all-day event with no end is one day, and a
// timed event with no end is one hour. Never invent a duration beyond that.
export function endForEvent(e: ProposedEvent): string | null {
  if (!e.startISO) return null;
  if (e.endISO) return e.endISO;
  if (e.allDay) {
    const d = new Date(`${e.startISO}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  return new Date(Date.parse(e.startISO) + 3600_000).toISOString();
}

// Soonest first; unanchored events sort last (they have no position in time,
// and floating them to the top would crowd out things with real deadlines).
export function sortProposed(events: ProposedEvent[]): ProposedEvent[] {
  return [...events].sort((a, b) => {
    if (!a.startISO && !b.startISO) return a.title.localeCompare(b.title);
    if (!a.startISO) return 1;
    if (!b.startISO) return -1;
    return Date.parse(a.startISO) - Date.parse(b.startISO);
  });
}
