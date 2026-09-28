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
// A proposal must be EARNED by billing-shaped subjects, not by volume — a chatty
// newsletter is not a biller. One message from a domain is never a pattern, so
// two sightings are the floor, which also means a one-off receipt from a shop
// you will never hear from again does not become a permanent suggestion.

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
  /** Distinct billing-shaped phrases seen — the evidence. */
  signals: string[];
  /** Up to two example subjects, for the row. */
  examples: string[];
  /** What the row proposes this is. */
  kind: "biller" | "school";
  reason: string;
}

/** Phrases that make a message look like a bill. Same phrase-not-word rule as
 *  accountJeopardy: "account" alone means nothing, "your statement" does. */
const BILLING_PHRASES = [
  "your statement", "statement is ready", "statement available", "e-statement",
  "your bill", "bill is ready", "new invoice", "invoice", "amount due",
  "payment due", "autopay", "automatic payment", "payment reminder",
  "your receipt", "subscription renews", "renewal notice", "will renew",
  "billing", "paperless",
];

/** Phrases that make a message look like it comes from a school or activity. */
const SCHOOL_PHRASES = [
  "newsletter", "permission slip", "field trip", "parent", "principal",
  "report card", "conference", "enrollment", "registration", "pta", "classroom",
  "school year", "immunization", "dismissal",
];

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
  opts: { minSightings?: number; max?: number } = {},
): SenderCandidate[] {
  const minSightings = opts.minSightings ?? MIN_SIGHTINGS;
  const dismissedSet = new Set(dismissed.map((d) => d.toLowerCase()));

  interface Acc { name: string; count: number; billing: Set<string>; school: Set<string>; examples: string[] }
  const groups = new Map<string, Acc>();

  for (const o of observed) {
    const domain = domainOf(o.from);
    if (!domain) continue;
    if (GENERIC_DOMAINS.has(domain)) continue;      // a person, not an institution
    if (alreadyDeclared(domain, declaredPatterns)) continue;
    if (dismissedSet.has(dismissKey(domain))) continue;

    let g = groups.get(domain);
    if (!g) { g = { name: nameOf(o.from), count: 0, billing: new Set(), school: new Set(), examples: [] }; groups.set(domain, g); }
    g.count++;
    const subject = o.subject ?? "";
    for (const p of BILLING_PHRASES) if (hasPhrase(subject, p)) g.billing.add(p);
    for (const p of SCHOOL_PHRASES) if (hasPhrase(subject, p)) g.school.add(p);
    if (subject.trim() && g.examples.length < 2) g.examples.push(subject.trim().slice(0, 90));
  }

  const out: SenderCandidate[] = [];
  for (const [domain, g] of groups) {
    if (g.count < minSightings) continue;                 // one message is not a pattern
    // Volume alone earns nothing — a chatty newsletter is not a biller.
    if (g.billing.size === 0 && g.school.size === 0) continue;

    const kind: SenderCandidate["kind"] = g.billing.size >= g.school.size ? "biller" : "school";
    const signals = [...(kind === "biller" ? g.billing : g.school)].slice(0, 4);
    out.push({
      domain, name: g.name, count: g.count, signals, examples: g.examples, kind,
      reason: `${g.count} messages mentioning ${signals.map((s) => `“${s}”`).join(", ")}`,
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
  const subjects = ["statement", "invoice", "your bill", "amount due", "autopay", "receipt", "renews", "newsletter"]
    .map((s) => `subject:(${s})`).join(" OR ");
  const window = `newer_than:${Math.max(7, Math.min(365, Math.round(days)))}d`;
  const exclude = declaredPatterns
    .map((p) => (p.includes("@") ? p : `@${p}`))
    .filter(Boolean)
    .map((p) => `-from:(${p})`)
    .join(" ");
  return `(${subjects}) ${window} ${exclude}`.trim();
}
