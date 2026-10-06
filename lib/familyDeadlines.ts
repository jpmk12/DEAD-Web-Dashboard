// Persisted family deadlines, with a lifecycle.
//
// PURE, client-safe, unit-tested. The store (lib/familyDeadlineStore.ts) only
// reads and writes rows; every judgement is here.
//
// ── The hole this closes ──────────────────────────────────────────────────
// `gmailQueryFor()` scopes the school digest to `newer_than:14d` and
// `lib/family.ts` keeps its result in a 15-minute in-process cache. Nothing was
// persisted. So a form due in six weeks, mentioned once in today's newsletter,
// showed on the board today and then SILENTLY DISAPPEARED about fifteen days
// later when that email aged out of the query — while still being due.
//
// That is exactly the buried-obligation failure the Family tab exists to
// prevent, reintroduced at the cache boundary. A deadline the app forgets also
// cannot be learned from, which is why this comes before anything else.
//
// ── Discipline ────────────────────────────────────────────────────────────
// A DEADLINE WITH NO DATE CAN NEVER LAPSE. `familyDates` already refuses to
// resolve "next Friday", so plenty of real deadlines arrive undated. Calling
// one of those overdue would be inventing the very date the extractor
// deliberately refused to guess. Undated entries stay `open` forever and say
// they need a date — they are surfaced, never scored.
//
// LAPSED IS DERIVED, NOT STORED. It is a function of the due date and today,
// so there is no sweeper job to run and no row that silently rots into the
// wrong state on a day the app was not opened — the same reason
// `force_posture_daily` is read lazily rather than written by cron.
//
// LAPSED STAYS VISIBLE until the user clears it. A deadline that vanishes when
// missed teaches nothing, and noticing the pattern in what you miss is the
// point. This is deliberately a little uncomfortable.

import type { FamilyDeadline } from "./family";

export type DeadlineState = "open" | "done" | "dismissed";

/** A deadline as stored: the extraction plus its lifecycle. */
export interface StoredDeadline {
  id: string;
  title: string;
  detail: string;
  dueISO: string | null;
  personId: string | null;
  sourceId: string;
  buried: boolean;
  /** When we first extracted it — how long you have been sitting on it. */
  firstSeen: string;   // ISO
  /** Last time the extractor still saw it in the mail window. */
  lastSeen: string;    // ISO
  state: DeadlineState;
  stateAt: string | null;
  /** yyyy-mm-dd until which the row stays out of the way. "Not now" is a real
   *  answer, distinct from done and not-mine: the record stays OPEN. */
  snoozedUntil?: string | null;
  /** "user" when the operator set (or cleared) the date — an extraction then
   *  never overwrites it. Absent/"model" for an extracted date. */
  dueSource?: "user" | "model" | null;
}

/** What the UI renders — stored, plus derived position in its lifecycle. */
export type DeadlinePhase = "lapsed" | "due-soon" | "open" | "undated" | "snoozed" | "done" | "dismissed";

export interface DeadlineView extends StoredDeadline {
  phase: DeadlinePhase;
  /** Whole days until due; negative when overdue, null when undated. */
  daysUntil: number | null;
  /** Days since first extraction — "you have had this 22 days". */
  ageDays: number;
  /** True once the source mail has aged out of the query window: the app is now
   *  the ONLY thing that remembers this. Worth saying out loud. */
  onlyRemembered: boolean;
}

/** Inside this many days a deadline is "due soon" and sorts to the top. */
export const DUE_SOON_DAYS = 7;

/** The school query's window. Past this, the source mail is gone from Gmail's
 *  result set and only the stored row remains. Mirrors gmailQueryFor's 14d. */
export const MAIL_WINDOW_DAYS = 14;

const DAY = 86_400_000;
const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Stable identity across re-extractions.
 *
 *  Keyed on the SOURCE MESSAGE plus a normalised title, because the model
 *  re-reads the same mail every cache miss and may rephrase slightly — keying
 *  on the raw title alone would create a duplicate row on every wording change,
 *  and keying on the message alone would collapse two genuine obligations
 *  stated in one newsletter into one. Normalisation strips punctuation, case
 *  and runs of whitespace, which is enough to absorb rewording without merging
 *  distinct items. */
export function deadlineKey(sourceId: string, title: string): string {
  const t = (title ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${(sourceId ?? "").slice(0, 60)}|${t}`;
}

/** Whole days from `today` to a yyyy-mm-dd, or null if unparseable. Never 0 on
 *  a bad date — that would read as "due today". */
export function daysUntil(dueISO: string | null, today: string): number | null {
  if (!dueISO || !/^\d{4}-\d{2}-\d{2}$/.test(dueISO)) return null;
  const due = Date.parse(`${dueISO}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(due) || !Number.isFinite(now)) return null;
  return Math.round((due - now) / DAY);
}

export function toView(d: StoredDeadline, today: string, nowMs = Date.now()): DeadlineView {
  const n = daysUntil(d.dueISO, today);
  const first = Date.parse(d.firstSeen);
  const ageDays = Number.isFinite(first) ? Math.max(0, Math.floor((nowMs - first) / DAY)) : 0;
  const lastSeen = Date.parse(d.lastSeen);
  const onlyRemembered = Number.isFinite(lastSeen) && nowMs - lastSeen > MAIL_WINDOW_DAYS * DAY;

  // A snooze is live while today is before its date. It never outranks LAPSED:
  // "not now" is a deferral of attention, not of the due date, and a snoozed
  // deadline that passes its date has still been missed.
  const snoozeLive = !!d.snoozedUntil && /^\d{4}-\d{2}-\d{2}$/.test(d.snoozedUntil) && today < d.snoozedUntil;

  let phase: DeadlinePhase;
  if (d.state === "done") phase = "done";
  else if (d.state === "dismissed") phase = "dismissed";
  else if (n !== null && n < 0) phase = "lapsed";       // wins over a snooze
  else if (snoozeLive) phase = "snoozed";
  else if (n === null) phase = "undated";     // cannot lapse — we never had a date
  else if (n <= DUE_SOON_DAYS) phase = "due-soon";
  else phase = "open";

  return { ...d, phase, daysUntil: n, ageDays, onlyRemembered };
}

const PHASE_RANK: Record<DeadlinePhase, number> = {
  lapsed: 0, "due-soon": 1, open: 2, undated: 3, snoozed: 4, done: 5, dismissed: 6,
};

/** Lapsed first — it is the thing you most need to see and the thing a cleaner
 *  design would have hidden. Then soonest-due, then undated, then handled. */
export function sortDeadlines(views: DeadlineView[]): DeadlineView[] {
  return views.slice().sort((a, b) => {
    const r = PHASE_RANK[a.phase] - PHASE_RANK[b.phase];
    if (r !== 0) return r;
    if (a.daysUntil !== null && b.daysUntil !== null) return a.daysUntil - b.daysUntil;
    if (a.daysUntil !== null) return -1;
    if (b.daysUntil !== null) return 1;
    return b.ageDays - a.ageDays;   // oldest undated first — it has waited longest
  });
}

export interface MergeResult {
  /** Rows to upsert: new extractions, and refreshed lastSeen/detail for known ones. */
  upserts: StoredDeadline[];
  /** Ids seen again in this pass — the store refreshes their lastSeen. */
  refreshed: string[];
}

/**
 * Fold a fresh extraction into what is already stored.
 *
 * A re-extraction NEVER resets lifecycle state: something you marked done must
 * not spring back to open just because the mail is still inside the window.
 * It also never overwrites a stored due date with null — losing a date we once
 * had would silently convert a lapsing deadline into an unscoreable undated
 * one, which is the failure mode this module exists to prevent.
 */
export function mergeDeadlines(
  stored: StoredDeadline[],
  fresh: FamilyDeadline[],
  nowIso = new Date().toISOString(),
): MergeResult {
  const byId = new Map(stored.map((s) => [s.id, s]));
  const upserts: StoredDeadline[] = [];
  const refreshed: string[] = [];

  for (const f of fresh) {
    if (!f || typeof f.title !== "string" || !f.title.trim()) continue;
    const id = deadlineKey(f.sourceId, f.title);
    const prev = byId.get(id);
    if (prev) {
      refreshed.push(id);
      upserts.push({
        ...prev,
        // Detail and buried-ness can legitimately sharpen on a re-read.
        detail: f.detail || prev.detail,
        buried: f.buried ?? prev.buried,
        // Keep a date we already had; accept one we did not. A date the USER
        // set (or deliberately cleared) is theirs — never touched.
        dueISO: prev.dueSource === "user" ? prev.dueISO : (prev.dueISO ?? f.dueISO ?? null),
        personId: prev.personId ?? f.personId ?? null,
        lastSeen: nowIso,
        // state and stateAt are deliberately untouched.
      });
    } else {
      upserts.push({
        id,
        title: f.title.trim().slice(0, 240),
        detail: (f.detail ?? "").slice(0, 600),
        dueISO: f.dueISO ?? null,
        personId: f.personId ?? null,
        sourceId: f.sourceId ?? "",
        buried: !!f.buried,
        firstSeen: nowIso,
        lastSeen: nowIso,
        state: "open",
        stateAt: null,
      });
    }
  }
  return { upserts, refreshed };
}

export interface DeadlineRollup {
  lapsed: number;
  dueSoon: number;
  open: number;
  undated: number;
  snoozed: number;
  /** One sentence, or null when there is genuinely nothing outstanding. */
  line: string | null;
}

/** Headline counts for the pane header and the Morning Brief. */
export function rollup(views: DeadlineView[]): DeadlineRollup {
  const lapsed = views.filter((v) => v.phase === "lapsed").length;
  const dueSoon = views.filter((v) => v.phase === "due-soon").length;
  const open = views.filter((v) => v.phase === "open").length;
  const undated = views.filter((v) => v.phase === "undated").length;
  const snoozed = views.filter((v) => v.phase === "snoozed").length;

  const parts: string[] = [];
  if (lapsed > 0) parts.push(`${lapsed} past due`);
  if (dueSoon > 0) parts.push(`${dueSoon} due within ${DUE_SOON_DAYS} days`);
  if (open > 0) parts.push(`${open} upcoming`);
  if (undated > 0) parts.push(`${undated} with no date yet`);
  if (snoozed > 0) parts.push(`${snoozed} snoozed`);

  return { lapsed, dueSoon, open, undated, snoozed, line: parts.length > 0 ? parts.join(" · ") : null };
}

/** Today in the user's terms. Exposed so the caller can pass the effective
 *  timezone's date rather than UTC — the brief already resolves one. */
export function todayYmd(nowMs = Date.now()): string {
  return ymd(nowMs);
}

// ── Render-time grouping (REVIEW-2026-10 F1/F2/F9) ──────────────────────────

export interface GroupedDeadline extends DeadlineView {
  /** Every stored id this row stands for (itself first). */
  mergedIds: string[];
  mergedCount: number;
}

const tokens = (s: string): Set<string> => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3));
function overlap(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let n = 0;
  for (const w of ta) if (tb.has(w)) n++;
  return n / Math.min(ta.size, tb.size);
}

/** Title overlap at or above this merges two rows (same person, same date). */
export const DEADLINE_MERGE_OVERLAP = 0.6;

/**
 * One row per obligation. The STORE keeps every extraction (its key is
 * message + title by design — one deadline in three newsletters is three
 * rows), so the join happens here: same person, same due date (or both
 * undated), same handled-ness, title overlap ≥ DEADLINE_MERGE_OVERLAP. The
 * kept row is the earliest-first-seen one (the oldest record of the
 * obligation); the shortest title tends to be the cleanest and is used.
 */
export function dedupeDeadlines(views: DeadlineView[]): GroupedDeadline[] {
  const out: GroupedDeadline[] = [];
  const handled = (v: DeadlineView) => v.phase === "done" || v.phase === "dismissed";
  for (const v of views) {
    const hit = out.find((o) =>
      (o.personId ?? null) === (v.personId ?? null) &&
      (o.dueISO ?? null) === (v.dueISO ?? null) &&
      handled(o) === handled(v) &&
      overlap(o.title, v.title) >= DEADLINE_MERGE_OVERLAP);
    if (hit) {
      hit.mergedIds.push(v.id);
      hit.mergedCount++;
      if (v.title.length < hit.title.length) hit.title = v.title;
      if (!hit.detail && v.detail) hit.detail = v.detail;
      if (v.buried) hit.buried = true;
      if (Date.parse(v.firstSeen) < Date.parse(hit.firstSeen)) { hit.firstSeen = v.firstSeen; hit.ageDays = Math.max(hit.ageDays, v.ageDays); }
    } else {
      out.push({ ...v, mergedIds: [v.id], mergedCount: 1 });
    }
  }
  return out;
}

export function splitHandled<T extends DeadlineView>(views: T[]): { open: T[]; handled: T[] } {
  return {
    open: views.filter((v) => v.phase !== "done" && v.phase !== "dismissed"),
    handled: views.filter((v) => v.phase === "done" || v.phase === "dismissed"),
  };
}

/** True when the row first appeared after the user's last visit. */
export function isNewSince(v: Pick<DeadlineView, "firstSeen">, lastVisitMs: number): boolean {
  if (!lastVisitMs) return false;
  const t = Date.parse(v.firstSeen);
  return Number.isFinite(t) && t > lastVisitMs;
}
