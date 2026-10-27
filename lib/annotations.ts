// I&W analyst annotations: a dated note on a board or on ONE indicator.
//
// PURE, client-safe, unit-tested. The decision log records what you
// EXPECT and scores it later; an annotation records what you KNOW or
// SUSPECT right now that the sensors cannot — "the ADS-B gap this week is a
// known receiver outage", "this indicator reads a scheduled exercise, not a
// surge", "watch the Tuesday NOTAM". It never changes a level, a weight or a
// state: the board proposes, the analyst disposes, and a note is the
// analyst's voice beside the evidence, not evidence.
//
// Disciplines:
// - A note is OPEN until someone resolves it; resolving is one-way (the
//   decision-log rule — a record you can quietly rewrite is not a record).
//   Resolved notes stay readable for a while (`ANNOTATION_RECENT_DAYS`).
// - Shared per board, attributed by email — the crew keeps one board.
// - The Ask pack carries the open notes, labelled as the crew's own
//   judgement so the model never cites one as a sensor observation.

export interface Annotation {
  id: string;
  problemId: string;
  /** The indicator the note is about, or null for the whole board. */
  indicatorId: string | null;
  note: string;
  /** Author — the crew shares one board. */
  by: string;
  createdAt: string;   // ISO
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export const ANNOTATION_MIN_LEN = 4;
export const ANNOTATION_MAX_LEN = 500;
/** Resolved notes younger than this still show (folded) and ride the Ask pack as "resolved". */
export const ANNOTATION_RECENT_DAYS = 14;
/** Map key for a whole-board note. */
export const BOARD_KEY = "";

export function isOpenAnnotation(a: Annotation): boolean {
  return a.resolvedAt === null;
}

/** Validate a proposed note. Returns an error string, or null when acceptable.
 *  The write route re-runs this — a guard that only exists in the UI is not a
 *  guard. */
export function validateAnnotationDraft(d: { problemId?: unknown; indicatorId?: unknown; note?: unknown }): string | null {
  if (typeof d.problemId !== "string" || !d.problemId.trim()) return "A board is required.";
  if (d.indicatorId != null && d.indicatorId !== "" && typeof d.indicatorId !== "string") return "Indicator must be a string.";
  const note = typeof d.note === "string" ? d.note.trim() : "";
  if (note.length < ANNOTATION_MIN_LEN) return "Write the note — a few words at least.";
  if (note.length > ANNOTATION_MAX_LEN) return `Keep the note under ${ANNOTATION_MAX_LEN} characters.`;
  return null;
}

export function ageDays(iso: string, nowMs = Date.now()): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}

/** Open first (newest leading), then resolved (newest resolution leading). */
export function sortAnnotations(entries: Annotation[]): Annotation[] {
  const t = (s: string | null) => (s ? Date.parse(s) : 0);
  return entries.slice().sort((a, b) => {
    const oa = isOpenAnnotation(a) ? 0 : 1, ob = isOpenAnnotation(b) ? 0 : 1;
    if (oa !== ob) return oa - ob;
    return oa === 0 ? t(b.createdAt) - t(a.createdAt) : t(b.resolvedAt) - t(a.resolvedAt);
  });
}

/** The newest OPEN note per target — `BOARD_KEY` for the board itself. One
 *  note per indicator is what the row can show; the rest fold under it. */
export function latestOpenByTarget(entries: Annotation[]): Map<string, Annotation> {
  const out = new Map<string, Annotation>();
  for (const a of sortAnnotations(entries)) {
    if (!isOpenAnnotation(a)) continue;
    const key = a.indicatorId ?? BOARD_KEY;
    if (!out.has(key)) out.set(key, a);
  }
  return out;
}

/** Resolved inside the recent window — still worth a folded line. */
export function recentlyResolved(entries: Annotation[], nowMs = Date.now()): Annotation[] {
  return sortAnnotations(entries).filter((a) => !isOpenAnnotation(a) && (ageDays(a.resolvedAt!, nowMs) ?? Infinity) <= ANNOTATION_RECENT_DAYS);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Lines for the Ask pack: open notes (all targets, newest first), then
 *  recently resolved ones marked as such. Empty when there is nothing —
 *  the caller decides whether to print a header. */
export function annotationLines(entries: Annotation[], label: (indicatorId: string) => string, nowMs = Date.now(), limit = 8): string[] {
  const open = sortAnnotations(entries).filter(isOpenAnnotation);
  const resolved = recentlyResolved(entries, nowMs);
  const who = (a: Annotation) => a.by.split("@")[0] || "crew";
  const age = (iso: string) => { const d = ageDays(iso, nowMs); return d === null ? "" : d === 0 ? "today" : `${d} d ago`; };
  const lines: string[] = [];
  for (const a of open.slice(0, limit)) {
    lines.push(`- [${a.indicatorId ? label(a.indicatorId) : "whole board"}] "${clip(a.note.replace(/\s+/g, " "), 240)}" — ${who(a)}, ${age(a.createdAt)}`);
  }
  for (const a of resolved.slice(0, Math.max(0, limit - lines.length))) {
    lines.push(`- (resolved ${age(a.resolvedAt!)}) [${a.indicatorId ? label(a.indicatorId) : "whole board"}] "${clip(a.note.replace(/\s+/g, " "), 160)}"`);
  }
  return lines;
}
