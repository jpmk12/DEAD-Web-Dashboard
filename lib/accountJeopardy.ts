// Account jeopardy: a declined payment, a lapsing policy, a final notice.
//
// PURE, client-safe, unit-tested. NO model call — this is a word-bounded phrase
// scan over mail the household pane has ALREADY fetched. The scan does not
// widen what the app reads: it runs inside `billerQueryFor`'s existing 90-day,
// declared-senders-only result set. If a signal cannot be seen from there, the
// answer is for the user to declare another sender, not for the app to read the
// whole mailbox.
//
// Why deterministic rather than model-extracted: these are the highest-
// consequence items in the pane and today they surface only if the model
// happens to mention one in a paragraph. A lapsed policy that went unmentioned
// is indistinguishable from no lapsed policy, which is the "UNKNOWN is not
// clear" failure applied to money. A fixed phrase list either matches or does
// not, and it can be audited.
//
// ── The anti-false-positive discipline ────────────────────────────────────
// PHRASES ONLY, NEVER SINGLE WORDS. Every bill contains "payment" and most
// contain "due"; only a phrase like "payment was declined" carries information.
// A single-word trigger would fire on every receipt in the mailbox and the panel
// would be ignored within a week.
//
// SUPPRESSORS RUN FIRST. Billers advertise the thing they are not doing
// ("avoid a late fee", "no past due balance", "if your payment fails we will
// retry") and marketing copy describes the failure mode it prevents. A
// suppressor match wins outright — a missed real alert is bad, but a panel that
// cries wolf on a receipt gets switched off, and then every alert is missed.

import { byWorstFirst } from "./severity";

export type JeopardyKind =
  | "payment-failed"
  | "past-due"
  | "final-notice"
  | "lapse"
  | "suspension"
  | "insufficient-funds"
  | "fraud";

export interface JeopardyHit {
  kind: JeopardyKind;
  /** The phrase that matched, so the row can show its own evidence. */
  phrase: string;
  severity: "red" | "amber";
  /** What it means, in one clause. */
  meaning: string;
}

export interface JeopardySource {
  /** Stable id (message id) for dedupe. */
  id: string;
  /** Biller/sender label for display. */
  label: string;
  /** Subject + any snippet already held. Bounded by the caller. */
  text: string;
  /** yyyy-mm-dd the mail was seen, for ordering. */
  seenDate?: string;
}

export interface JeopardyFinding extends JeopardyHit {
  sourceId: string;
  label: string;
  seenDate?: string;
}

interface Rule {
  kind: JeopardyKind;
  severity: "red" | "amber";
  meaning: string;
  phrases: string[];
}

// Phrases are matched word-bounded and case-insensitively. Kept specific enough
// that a routine statement or receipt does not trip them.
const RULES: Rule[] = [
  {
    kind: "payment-failed", severity: "red",
    meaning: "a payment did not go through — the bill is still owed",
    phrases: [
      "payment failed", "payment was declined", "payment declined", "card was declined",
      "unable to process your payment", "could not process your payment",
      "we were unable to process", "autopay failed", "automatic payment failed",
      "payment returned", "returned payment", "payment did not go through",
      "your payment was unsuccessful",
    ],
  },
  {
    kind: "insufficient-funds", severity: "red",
    meaning: "the account did not have the funds — expect a fee as well",
    phrases: ["insufficient funds", "nsf fee", "non-sufficient funds", "overdraft", "overdrawn"],
  },
  {
    kind: "final-notice", severity: "red",
    meaning: "the biller says this is the last warning before action",
    phrases: ["final notice", "final reminder", "final demand", "last notice before", "notice of default"],
  },
  {
    kind: "lapse", severity: "red",
    meaning: "coverage or a policy is about to end or has ended",
    phrases: [
      "policy will lapse", "policy has lapsed", "coverage will lapse", "coverage has lapsed",
      "will be cancelled for non-payment", "cancelled due to non-payment",
      "coverage will end", "policy cancellation",
    ],
  },
  {
    kind: "suspension", severity: "red",
    meaning: "service is about to stop",
    phrases: [
      "service will be suspended", "service has been suspended", "service interruption notice",
      "scheduled for disconnection", "disconnection notice", "shut-off notice", "shutoff notice",
      "account will be suspended", "account has been suspended",
    ],
  },
  {
    kind: "past-due", severity: "amber",
    meaning: "a balance is late but no action has been threatened yet",
    phrases: ["past due", "overdue balance", "amount overdue", "late payment", "delinquent"],
  },
  {
    kind: "fraud", severity: "red",
    meaning: "the biller flagged unusual activity — verify it yourself, not via a link in the mail",
    phrases: [
      "suspicious activity", "unusual activity on your account", "unauthorized transaction",
      "fraud alert", "we have locked your account",
    ],
  },
];

// Checked BEFORE the rules; any match suppresses the whole message. Billers
// advertise the thing they are not doing, and marketing copy describes the
// failure mode it prevents.
const SUPPRESSORS: string[] = [
  "no past due", "not past due", "no amount past due", "avoid a late", "avoid late",
  "to avoid past due", "if your payment fails", "should your payment fail",
  "in case of insufficient funds", "thank you for your payment",
  "payment received", "payment was successful", "payment successful",
  "successfully processed", "no action is required", "no action needed",
  "this is not a bill", "avoid service interruption", "to avoid disconnection",
  "help you avoid", "prevent a lapse", "avoid a lapse",
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Word-bounded, case-insensitive phrase containment. Boundaries are asserted
 *  with lookarounds against letters/digits so a phrase can end in punctuation
 *  ("past due.") without failing, and cannot match inside a longer word. */
export function hasPhrase(text: string, phrase: string): boolean {
  if (!text || !phrase) return false;
  try {
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(phrase)}(?![\\p{L}\\p{N}])`, "iu").test(text);
  } catch {
    return false;
  }
}

/** True when this message is advertising a risk rather than reporting one. */
export function isSuppressed(text: string): boolean {
  return SUPPRESSORS.some((p) => hasPhrase(text, p));
}

// Severity ordering comes from lib/severity; red/amber is a subset of it.
const KIND_RANK = new Map(RULES.map((r, i) => [r.kind, i]));

/**
 * Scan already-fetched mail for account jeopardy.
 *
 * At most one finding per message — the worst one. A declined payment that also
 * says "past due" is one problem, and listing it twice would make the panel
 * look busier than the situation is.
 */
export function scanJeopardy(
  sources: JeopardySource[],
  opts: { max?: number } = {},
): JeopardyFinding[] {
  const out: JeopardyFinding[] = [];

  for (const s of sources) {
    const text = s.text ?? "";
    if (!text.trim()) continue;
    if (isSuppressed(text)) continue;

    let best: JeopardyHit | null = null;
    for (const rule of RULES) {
      const phrase = rule.phrases.find((p) => hasPhrase(text, p));
      if (!phrase) continue;
      const hit: JeopardyHit = { kind: rule.kind, phrase, severity: rule.severity, meaning: rule.meaning };
      if (!best) { best = hit; continue; }
      const better = byWorstFirst(hit.severity, best.severity)
        || (KIND_RANK.get(hit.kind)! - KIND_RANK.get(best.kind)!);
      if (better < 0) best = hit;
    }
    if (best) out.push({ ...best, sourceId: s.id, label: s.label, seenDate: s.seenDate });
  }

  out.sort((a, b) =>
    byWorstFirst(a.severity, b.severity)
    || (b.seenDate ?? "").localeCompare(a.seenDate ?? "")
    || a.label.localeCompare(b.label));
  return out.slice(0, opts.max ?? 8);
}

/** Header sentence, or null when clear. Never says "all clear" — the scan can
 *  only see mail from senders the user declared. */
export function jeopardyLine(findings: JeopardyFinding[]): string | null {
  if (findings.length === 0) return null;
  const red = findings.filter((f) => f.severity === "red").length;
  return red > 0
    ? `${red} needing action now${findings.length > red ? ` · ${findings.length - red} late` : ""}`
    : `${findings.length} late`;
}
