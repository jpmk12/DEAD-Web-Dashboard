// "You are being billed by someone you never told me about."
//
// PURE, client-safe, unit-tested. The one feature in the Family tab that looks
// OUTSIDE the declared roster — which makes its boundaries the most important
// thing about it.
//
// ── Why it has to exist ───────────────────────────────────────────────────
// "The roster is the query" is what keeps this tab cheap and keeps it from
// touching mail the user never named. But it has a blind spot with teeth: you
// cannot be reminded of a bill you forgot you had. A subscription that renews
// from an address you never declared is invisible to every other part of this
// pane, and it is exactly the kind of thing the household pane exists to catch.
//
// ── The boundaries, which are not negotiable ──────────────────────────────
// ON DEMAND ONLY. Nothing here runs on a page load, a poll or a digest. The
// user presses a button. A background scan of unnamed senders is a different
// product from the one they agreed to.
//
// SUBJECTS AND SENDERS ONLY, NEVER BODIES. This module is given a from-line and
// a subject and returns a proposal. It is not able to read a body because it is
// never handed one — the narrow input type IS the guarantee.
//
// NOTHING IS STORED BUT YOUR ANSWER. A proposal is not a biller. Declining one
// is permanent; accepting it writes the same roster entry you would have typed.
//
// ── Discipline ────────────────────────────────────────────────────────────
// A proposal must be EARNED by category-shaped subjects, not by volume — a chatty
// newsletter is not a biller. One message from a domain is never a pattern, so
// two sightings are the floor, which also means a one-off receipt from a shop
// you will never hear from again does not become a permanent suggestion.

import type { SenderCategory } from "./familyProfile";

/** One observed message header. Deliberately cannot carry a body. */
export interface ObservedSender {
  /** Raw From header, e.g. `"Xcel Energy" <no-reply@xcelenergy.com>`. */
  from: string;
  subject: string;
  /** yyyy-mm-dd. */
  date?: string;
}

export interface SenderCandidate {
  /** The domain, which is what a roster pattern should usually be. */
  domain: string;
  /** Friendliest display name seen on the From line. */
  name: string;
  /** How many messages matched. */
  count: number;
  /** Distinct phrases seen for the winning category — the evidence. */
  signals: string[];
  /** Up to two example subjects, for the row. */
  examples: string[];
  /** The category proposed. */
  category: ProposalCategory;
  /** `clear` when one category won outright; `close` when the runner-up was
   *  within CONFIDENCE_MARGIN and the user should look before accepting. */
  confidence: "clear" | "close";
  /** The runner-up, when it was close — so the row's dropdown can default
   *  sensibly and the user can see what else it might be. */
  alternate?: ProposalCategory;
  reason: string;
}

/** How far ahead the winner must be to count as a clear call. Below this the row
 *  says so rather than pretending: mis-filing a swim-club signup as a bill is
 *  cheap to fix with a dropdown and expensive to leave silently wrong. */
export const CONFIDENCE_MARGIN = 2;

/** Categories a proposal can land in. `biller` is separate from the sender
 *  categories because billers get their own roster list (the silence watch needs
 *  a cadence and an autopay flag that no other category has). */
export type ProposalCategory = "biller" | SenderCategory;

/** Phrase evidence per category. PHRASES, never single words — "account",
 *  "schedule" and "reminder" appear in everyone's mail. Same rule as
 *  accountJeopardy, and for the same reason: a single-word trigger would
 *  classify half the mailbox and the panel would be ignored within a week. */
const CATEGORY_PHRASES: Record<ProposalCategory, string[]> = {
  biller: [
    "your statement", "statement is ready", "statement available", "e-statement",
    "your bill", "bill is ready", "new invoice", "amount due", "payment due",
    "autopay", "automatic payment", "payment reminder", "your receipt",
    "subscription renews", "renewal notice", "will renew", "billing statement",
    "paperless billing", "your plan renews", "membership renewal",
  ],
  school: [
    "newsletter", "permission slip", "report card", "parent conference",
    "parent-teacher", "principal", "classroom", "school year", "immunization",
    "dismissal", "pta", "school calendar", "progress report", "enrollment",
    "back to school", "lunch account", "field trip",
  ],
  activity: [
    // The "something fun for the kids" bucket: these are the ones with signup
    // windows and fees that close quietly.
    "registration is open", "registration opens", "register now", "sign up",
    "signup", "season schedule", "practice schedule", "game schedule",
    "team schedule", "tryouts", "recital", "rehearsal", "camp", "clinic",
    "roster", "league", "swim", "scouts", "troop", "dues are due",
    "uniform order", "picture day", "tournament", "meet schedule",
    "lessons", "coach", "spirit wear",
  ],
  medical: [
    "your appointment", "appointment reminder", "appointment confirmed",
    "test results", "lab results", "prescription", "refill", "your visit",
    "patient portal", "referral", "immunization record", "well visit",
    "annual physical", "dental cleaning", "orthodontic", "copay",
  ],
  travel: [
    "your itinerary", "booking confirmation", "reservation confirmed",
    "check-in opens", "online check-in", "your flight", "boarding pass",
    "hotel confirmation", "rental confirmation", "trip summary", "e-ticket",
  ],
  admin: [
    "renewal notice for your", "your license", "registration renewal",
    "passport", "tax statement", "tax document", "your w-2", "your 1099",
    "jury duty", "voter registration", "vehicle registration", "property tax",
    "official notice", "your claim", "policy documents",
  ],
  other: [],
};

/** Domains that are never a useful roster entry: a free mail host is a person,
 *  and adding one as a pattern would pull in unrelated mail wholesale. */
const GENERIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com",
  "live.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
  "msn.com", "comcast.net", "att.net", "verizon.net",
]);

/** Minimum messages from a domain before it can be proposed. */
export const MIN_SIGHTINGS = 2;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function hasPhrase(text: string, phrase: string): boolean {
  try {
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(phrase)}(?![\\p{L}\\p{N}])`, "iu").test(text);
  } catch {
    return false;
  }
}

/** Address out of a From header. */
export function addressOf(from: string): string | null {
  const m = (from ?? "").match(/<([^>]+)>/);
  const raw = (m ? m[1] : from ?? "").trim().toLowerCase();
  return raw.includes("@") ? raw : null;
}

export function domainOf(from: string): string | null {
  const addr = addressOf(from);
  if (!addr) return null;
  const d = addr.split("@")[1]?.trim();
  return d && d.includes(".") ? d : null;
}

/** Display name from a From header, falling back to the domain. */
export function nameOf(from: string): string {
  const m = (from ?? "").match(/^\s*"?([^"<]+?)"?\s*</);
  const n = m?.[1]?.trim();
  if (n) return n.slice(0, 60);
  return domainOf(from) ?? (from ?? "").slice(0, 60);
}

/**
 * True when `domain` is already covered by a declared pattern. A bare pattern
 * matches at and below itself, mirroring how the roster's own matcher treats a
 * domain — otherwise we would propose `mail.oakwood.org` to someone who already
 * declared `oakwood.org`.
 */
export function alreadyDeclared(domain: string, patterns: string[]): boolean {
  const d = domain.toLowerCase();
  return patterns.some((p) => {
    const pat = (p ?? "").trim().toLowerCase();
    if (!pat) return false;
    const bare = pat.includes("@") ? pat.split("@")[1] ?? "" : pat;
    if (!bare) return false;
    return d === bare || d.endsWith(`.${bare}`);
  });
}

export function dismissKey(domain: string): string {
  return `sender:${domain.toLowerCase()}`;
}

export function discoverSenders(
  observed: ObservedSender[],
  declaredPatterns: string[],
  dismissed: string[] = [],
  opts: {
    minSightings?: number; max?: number;
    /** Seeding from a Gmail LABEL the user made: the label is the evidence, so
     *  a sender with no category-shaped subject is still proposed, in this
     *  category, with the label named as the reason. Never set for the
     *  ordinary scan — there, volume without a phrase earns nothing. */
    fallbackCategory?: ProposalCategory; fallbackReason?: string;
  } = {},
): SenderCandidate[] {
  const minSightings = opts.minSightings ?? MIN_SIGHTINGS;
  const dismissedSet = new Set(dismissed.map((d) => d.toLowerCase()));

  interface Acc {
    name: string;
    count: number;
    /** Distinct matched phrases per category — set size IS the score, so one
     *  sender repeating "your statement" nine times does not outweigh another
     *  showing three different activity signals. */
    hits: Map<ProposalCategory, Set<string>>;
    examples: string[];
  }
  const groups = new Map<string, Acc>();
  const CATEGORIES = Object.keys(CATEGORY_PHRASES) as ProposalCategory[];

  for (const o of observed) {
    const domain = domainOf(o.from);
    if (!domain) continue;
    if (GENERIC_DOMAINS.has(domain)) continue;      // a person, not an institution
    if (alreadyDeclared(domain, declaredPatterns)) continue;
    if (dismissedSet.has(dismissKey(domain))) continue;

    let g = groups.get(domain);
    if (!g) { g = { name: nameOf(o.from), count: 0, hits: new Map(), examples: [] }; groups.set(domain, g); }
    g.count++;
    const subject = o.subject ?? "";
    for (const cat of CATEGORIES) {
      for (const p of CATEGORY_PHRASES[cat]) {
        if (!hasPhrase(subject, p)) continue;
        let set = g.hits.get(cat);
        if (!set) { set = new Set(); g.hits.set(cat, set); }
        set.add(p);
      }
    }
    if (subject.trim() && g.examples.length < 2) g.examples.push(subject.trim().slice(0, 90));
  }

  const out: SenderCandidate[] = [];
  for (const [domain, g] of groups) {
    if (g.count < minSightings) continue;                 // one message is not a pattern

    // Rank categories by distinct evidence. Volume alone earns nothing — a
    // chatty newsletter is not a biller and not an activity.
    const ranked = [...g.hits.entries()]
      .map(([cat, set]) => ({ cat, n: set.size }))
      .sort((a, b) => b.n - a.n || CATEGORIES.indexOf(a.cat) - CATEGORIES.indexOf(b.cat));
    if (ranked.length === 0 || ranked[0].n === 0) {
      if (!opts.fallbackCategory) continue;
      out.push({
        domain, name: g.name, count: g.count, signals: [], examples: g.examples,
        category: opts.fallbackCategory, confidence: "close",
        reason: opts.fallbackReason ?? `${g.count} messages`,
      });
      continue;
    }

    const winner = ranked[0];
    const runnerUp = ranked[1];
    // A close call is REPORTED, not resolved silently. Mis-filing a swim-club
    // signup as a bill costs one click to fix and is expensive to leave wrong.
    const close = !!runnerUp && winner.n - runnerUp.n < CONFIDENCE_MARGIN;

    const signals = [...(g.hits.get(winner.cat) ?? [])].slice(0, 4);
    out.push({
      domain, name: g.name, count: g.count, signals, examples: g.examples,
      category: winner.cat,
      confidence: close ? "close" : "clear",
      ...(close && runnerUp ? { alternate: runnerUp.cat } : {}),
      reason: `${g.count} messages mentioning ${signals.map((s) => `\u201c${s}\u201d`).join(", ")}`,
    });
  }

  // Strongest evidence first, then volume.
  out.sort((a, b) => b.signals.length - a.signals.length || b.count - a.count || a.domain.localeCompare(b.domain));
  return out.slice(0, opts.max ?? 8);
}

/** The bounded Gmail query this scan is allowed to run. Subject-shaped and
 *  window-capped, so it is a search for BILLS rather than a sweep of the
 *  mailbox — and `-from:` excludes what is already declared so the results are
 *  only ever things the user has not seen proposed. */
export function discoveryQuery(declaredPatterns: string[], days = 120): string {
  // One subject term per category family. Widened from the billing-only list
  // because a swim-club registration mail says none of those words — a scan that
  // cannot see a category cannot propose it, and "I miss things" was the point.
  const subjects = [
    "statement", "invoice", "your bill", "amount due", "autopay", "renews",   // biller
    "newsletter", "permission", "report card", "conference",                  // school
    "registration", "sign up", "schedule", "tryouts", "recital", "camp",      // activity
    "appointment", "results", "refill",                                       // medical
    "itinerary", "reservation", "check-in",                                   // travel
    "renewal", "tax", "license",                                              // admin
  ].map((t) => `subject:(${t})`).join(" OR ");
  const window = `newer_than:${Math.max(7, Math.min(365, Math.round(days)))}d`;
  const exclude = declaredPatterns
    .map((p) => (p.includes("@") ? p : `@${p}`))
    .filter(Boolean)
    .map((p) => `-from:(${p})`)
    .join(" ");
  return `(${subjects}) ${window} ${exclude}`.trim();
}

/** The query for seeding from a Gmail LABEL the user already maintains
 *  ("School", "Bills"). Their own filing is the evidence, so there is no
 *  subject shape — just the label, a window, and the same exclusion of what
 *  is already declared. Still headers only at the route. */
export function labelQuery(label: string, declaredPatterns: string[], days = 365): string {
  const name = label.trim().replace(/"/g, "");
  const window = `newer_than:${Math.max(7, Math.min(730, Math.round(days)))}d`;
  const exclude = declaredPatterns
    .map((p) => (p.includes("@") ? p : `@${p}`))
    .filter(Boolean)
    .map((p) => `-from:(${p})`)
    .join(" ");
  return `label:"${name}" ${window} ${exclude}`.trim();
}
