// "The W-2 you were waiting for never came."
//
// PURE, client-safe, unit-tested. The silence watch generalised beyond billers.
//
// `silenceWatch` only ever asks the question of a DECLARED BILLER with a
// DECLARED CADENCE: did the statement arrive on schedule? But most of the
// documents that hurt you by not arriving have no cadence at all — a W-2, a
// 1099, an insurance card, a report card, a closing statement. They are expected
// ONCE, by a date, and nothing in the app was watching for them.
//
// ── Discipline ────────────────────────────────────────────────────────────
// "MISSING" REQUIRES THE DATE TO HAVE PASSED. Before the by-date an expectation
// is `pending`, never missing — a W-2 that has not arrived on 3 January is not a
// problem, it is January. Reporting it as missing would make the panel wrong for
// four weeks of every year, which is how a user learns to ignore it.
//
// A DEAD SEARCH MUST NOT ACCUSE. If we observed no mail at all — the scan
// failed, the token expired, the query returned nothing — every expectation
// comes back `unknown`, not `missing`. This is the inverse of the app's
// "UNKNOWN is not clear" rule and matters more here, because a false missing
// accuses a sender of not writing and sends the user chasing a document they
// already have. `silenceWatch` earns its accusations with three prior sightings;
// this one earns them by confirming we actually looked.
//
// MATCHING IS DECLARED, NOT GUESSED. The user supplies the phrase to look for
// ("W-2", "1099", "report card"). Inferring which mail satisfies "insurance
// card" from a subject line is exactly the kind of guess that produces a
// confident wrong answer, and the cost of being wrong here is an unnoticed
// missing document.

/** A document the user expects to receive by a date. Declared, like billers. */
export interface DocExpectation {
  id: string;
  label: string;
  /** Phrase to look for in a subject line. Declared, never inferred. */
  match: string;
  /** yyyy-mm-dd it should have arrived by. */
  byISO: string;
  /** Optional sender domain/address it should come from. */
  fromPattern?: string;
  note?: string;
}

/** A subject line we actually saw, from mail already fetched. */
export interface ObservedDoc {
  subject: string;
  from?: string;
  /** yyyy-mm-dd. */
  date?: string;
}

export type ExpectationStatus = "arrived" | "overdue" | "pending" | "unknown";

export interface ExpectationResult {
  expectation: DocExpectation;
  status: ExpectationStatus;
  /** Whole days until the by-date; negative once past. Null if unparseable. */
  daysUntil: number | null;
  /** The subject that satisfied it, when one did. */
  matchedSubject?: string;
  matchedDate?: string;
  reason: string;
}

/** Inside this many days of the by-date, a pending expectation is worth showing. */
export const WATCH_WINDOW_DAYS = 21;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Word-bounded, case-insensitive. Hyphenated forms are common here ("W-2"), so
 *  boundaries are asserted against letters/digits rather than \b. */
export function subjectMatches(subject: string, phrase: string): boolean {
  const p = (phrase ?? "").trim();
  if (!subject || p.length < 2) return false;
  try {
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p)}(?![\\p{L}\\p{N}])`, "iu").test(subject);
  } catch {
    return false;
  }
}

function fromMatches(from: string | undefined, pattern: string | undefined): boolean {
  if (!pattern) return true;             // no sender constraint declared
  const f = (from ?? "").toLowerCase();
  const pat = pattern.trim().toLowerCase();
  if (!pat) return true;
  if (pat.includes("@")) return f.includes(pat);
  // A bare domain matches at and below itself, same as the roster's matcher.
  return f.includes(`@${pat}`) || f.includes(`.${pat}`) || f.includes(pat);
}

export function daysUntil(byISO: string, today: string): number | null {
  if (!ISO.test(byISO) || !ISO.test(today)) return null;
  const a = Date.parse(`${byISO}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

export function checkExpectations(
  expectations: DocExpectation[],
  observed: ObservedDoc[],
  today: string,
  opts: { watchWindowDays?: number } = {},
): ExpectationResult[] {
  const watch = opts.watchWindowDays ?? WATCH_WINDOW_DAYS;
  // Did we actually look? With nothing observed we cannot distinguish "did not
  // arrive" from "we did not see the mail", and accusing on the second is worse
  // than staying quiet on the first.
  const looked = observed.length > 0;

  const out: ExpectationResult[] = [];
  for (const e of expectations) {
    if (!e?.label?.trim() || !e?.match?.trim()) continue;
    const n = daysUntil(e.byISO, today);

    const hit = observed.find((o) => subjectMatches(o.subject ?? "", e.match) && fromMatches(o.from, e.fromPattern));
    if (hit) {
      out.push({
        expectation: e, status: "arrived", daysUntil: n,
        matchedSubject: hit.subject, matchedDate: hit.date,
        reason: `arrived${hit.date ? ` ${hit.date}` : ""} — “${(hit.subject ?? "").slice(0, 70)}”`,
      });
      continue;
    }

    if (!looked) {
      out.push({
        expectation: e, status: "unknown", daysUntil: n,
        reason: "no mail was scanned this run — cannot say whether it arrived",
      });
      continue;
    }

    if (n === null) {
      out.push({ expectation: e, status: "unknown", daysUntil: null, reason: "no usable expected-by date" });
      continue;
    }

    if (n < 0) {
      out.push({
        expectation: e, status: "overdue", daysUntil: n,
        reason: `expected by ${e.byISO} — ${-n} day${-n === 1 ? "" : "s"} ago, nothing matching “${e.match}” seen`,
      });
      continue;
    }

    // Not yet due. A W-2 that has not arrived on 3 January is not a problem.
    out.push({
      expectation: e, status: "pending", daysUntil: n,
      reason: n <= watch ? `due by ${e.byISO} — ${n} day${n === 1 ? "" : "s"} away` : `due by ${e.byISO}`,
    });
  }

  const rank: Record<ExpectationStatus, number> = { overdue: 0, pending: 1, unknown: 2, arrived: 3 };
  out.sort((a, b) =>
    rank[a.status] - rank[b.status]
    || (a.daysUntil ?? 9999) - (b.daysUntil ?? 9999)
    || a.expectation.label.localeCompare(b.expectation.label));
  return out;
}

/** Rows worth putting on screen: anything wrong, plus what is nearly due.
 *  An expectation that arrived, or is months away, is not news. */
export function worthShowing(
  results: ExpectationResult[],
  opts: { watchWindowDays?: number } = {},
): ExpectationResult[] {
  const watch = opts.watchWindowDays ?? WATCH_WINDOW_DAYS;
  return results.filter((r) =>
    r.status === "overdue"
    || r.status === "unknown"
    || (r.status === "pending" && (r.daysUntil ?? 9999) <= watch));
}

/** Header sentence, or null when there is nothing to say. */
export function expectationLine(results: ExpectationResult[]): string | null {
  const overdue = results.filter((r) => r.status === "overdue").length;
  const soon = results.filter((r) => r.status === "pending" && (r.daysUntil ?? 9999) <= WATCH_WINDOW_DAYS).length;
  const unknown = results.filter((r) => r.status === "unknown").length;
  const parts: string[] = [];
  if (overdue > 0) parts.push(`${overdue} overdue`);
  if (soon > 0) parts.push(`${soon} due soon`);
  if (unknown > 0) parts.push(`${unknown} unverifiable`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
