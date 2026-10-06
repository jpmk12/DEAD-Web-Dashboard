// Proposals mined from the mail the Family tab ALREADY reads.
//
// PURE, client-safe, unit-tested. The school digest and the bill reader put
// full message bodies in front of the model, and those bodies name other
// organisations the household deals with — "pay through MySchoolBucks", "sign
// up on SignUpGenius", a coach's address, an insurer's renewal notice with a
// date in it. Until now that was thrown away. The two model calls now ask for
// it in the SAME call (no second call — the one-call rule), and this module
// turns the raw answer into proposals the user can accept with one tap.
//
// ── Boundaries, unchanged ─────────────────────────────────────────────────
// Nothing here widens what is read: every proposal comes from a message that
// a DECLARED sender wrote. The model proposes; this module validates; the
// user disposes. A proposal is never written into the roster by anything but
// the user's own tap, and a dismissal is permanent.
//
// ── Discipline ────────────────────────────────────────────────────────────
// The model's category is re-validated against the roster's vocabulary, a
// proposed domain must look like a domain and must not be a free-mail host or
// something already declared, and a document proposal without an EXPLICIT
// date is dropped — the "never a guessed date" rule that runs through the
// whole tab (lib/familyDates) applies here with more force, because a
// document row IS a date.

import { alreadyDeclared, dismissKey, type ProposalCategory } from "./senderDiscovery";
import { SENDER_CATEGORIES, slug, type FamilyDocument, type FamilyProfile } from "./familyProfile";

export interface SenderMention {
  /** Display name as the mail called it. */
  name: string;
  /** Domain when one was visible in the mail, else null (the row then says
   *  "no address seen" and cannot be accepted by tap — it can only be noted). */
  domain: string | null;
  category: ProposalCategory;
  /** One clause quoting or paraphrasing the mail — the evidence. */
  evidence: string;
  /** Distinct messages that mentioned it. */
  sightings: number;
  sourceIds: string[];
  /** The email the first mention came from (subject · date), filled by the
   *  assembler from the mail it read — so the row names its source, not a
   *  raw link (REVIEW-2026-10 F8). */
  sourceSubject?: string;
  sourceDate?: string;
  sourceFrom?: string;
}

export interface DocumentProposal {
  label: string;
  /** Explicit date from the mail: an expiry, or a renewal-by date. */
  expiresISO: string;
  kind: "expiry" | "renewal";
  evidence: string;
  sourceId: string;
  /** Default lead from the label — passports need six months' validity. */
  leadDays: number;
}

export interface FamilyProposals {
  senders: SenderMention[];
  documents: DocumentProposal[];
}

export const EMPTY_PROPOSALS: FamilyProposals = { senders: [], documents: [] };

const CAPS = { senders: 8, documents: 6 };

const GENERIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com",
  "live.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
  "msn.com", "comcast.net", "att.net", "verizon.net",
]);

const ALL_CATEGORIES: ProposalCategory[] = ["biller", ...SENDER_CATEGORIES];

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Dismiss key for a name-only mention (no domain to key on). */
export const mentionKey = (name: string): string => `mention:${slug(name)}`;
/** Dismiss key for a document proposal. */
export const docKey = (label: string): string => `doc:${slug(label)}`;

/** Lead time a document type needs before its printed expiry. Passports are
 *  unusable for most travel six months out; registrations, licences and
 *  policies open a renewal window about a month out. Anything else: none.
 *  A declared `leadDays` always wins — this is only the default. */
export function defaultLeadDays(label: string): number {
  const l = label.toLowerCase();
  if (/\bpassport\b/.test(l)) return 183;
  if (/\bvisa\b/.test(l)) return 90;
  if (/\b(licen[cs]e|registration|insurance|policy|permit|id card|identification|cac|dependent id|global entry|tsa|precheck)\b/.test(l)) return 30;
  return 0;
}

/** The lead the runway should use: declared wins, else the type default. */
export function resolveLeadDays(doc: Pick<FamilyDocument, "label" | "leadDays">): number {
  if (typeof doc.leadDays === "number" && doc.leadDays > 0) return doc.leadDays;
  return defaultLeadDays(doc.label);
}

/** Normalise the model's `mentions` array into proposals. */
export function normalizeSenderMentions(
  raw: unknown,
  profile: FamilyProfile,
  dismissed: string[] = [],
): SenderMention[] {
  if (!Array.isArray(raw)) return [];
  const declared = [...profile.senders.map((s) => s.pattern), ...profile.billers.map((b) => b.pattern)];
  const dismissedSet = new Set(dismissed.map((d) => d.toLowerCase()));
  const byKey = new Map<string, SenderMention>();

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = str(o.name, 60);
    if (name.length < 2) continue;
    const evidence = str(o.why ?? o.evidence, 160);
    if (!evidence) continue;                       // a proposal without evidence is a nag
    const cat = str(o.kind ?? o.category, 16) as ProposalCategory;
    const category: ProposalCategory = ALL_CATEGORIES.includes(cat) ? cat : "other";
    const sourceId = str(o.sourceId, 80);

    let domain: string | null = str(o.domain, 120).toLowerCase().replace(/^@/, "") || null;
    if (domain) {
      // A bare domain only: an address collapses to its domain so the roster
      // pattern catches everyone there, the same shape discovery proposes.
      if (domain.includes("@")) domain = domain.split("@")[1] ?? null;
      if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || GENERIC_DOMAINS.has(domain)) domain = null;
    }
    if (domain && alreadyDeclared(domain, declared)) continue;
    if (domain && dismissedSet.has(dismissKey(domain))) continue;
    if (!domain && dismissedSet.has(mentionKey(name))) continue;

    const key = domain ?? mentionKey(name);
    const cur = byKey.get(key);
    if (cur) {
      if (sourceId && !cur.sourceIds.includes(sourceId)) { cur.sourceIds.push(sourceId); cur.sightings++; }
      continue;
    }
    byKey.set(key, { name, domain, category, evidence, sightings: 1, sourceIds: sourceId ? [sourceId] : [] });
  }

  // Domains first (they can be accepted by tap), then by how often mentioned.
  return [...byKey.values()]
    .sort((a, b) => Number(!!b.domain) - Number(!!a.domain) || b.sightings - a.sightings || a.name.localeCompare(b.name))
    .slice(0, CAPS.senders);
}

/** Normalise the model's `documents` array into proposals. A row without an
 *  explicit ISO date is DROPPED — a document row is a date, and inventing one
 *  is the failure the whole tab refuses to commit. */
export function normalizeDocumentProposals(
  raw: unknown,
  profile: FamilyProfile,
  dismissed: string[] = [],
  todayISO?: string,
): DocumentProposal[] {
  if (!Array.isArray(raw)) return [];
  const dismissedSet = new Set(dismissed.map((d) => d.toLowerCase()));
  const existing = new Set(profile.documents.map((d) => slug(d.label)));
  const seen = new Set<string>();
  const out: DocumentProposal[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const label = str(o.label, 80);
    const expiresISO = str(o.dateISO ?? o.expiresISO, 10);
    const evidence = str(o.why ?? o.evidence, 160);
    if (label.length < 3 || !ISO.test(expiresISO) || !evidence) continue;
    if (!Number.isFinite(Date.parse(`${expiresISO}T12:00:00Z`))) continue;
    // A date already behind us is not a document to track; it is history.
    if (todayISO && expiresISO < todayISO) continue;
    const key = slug(label);
    if (existing.has(key) || seen.has(key) || dismissedSet.has(docKey(label))) continue;
    seen.add(key);
    out.push({
      label, expiresISO, evidence,
      kind: o.kind === "renewal" ? "renewal" : "expiry",
      sourceId: str(o.sourceId, 80),
      leadDays: defaultLeadDays(label),
    });
  }
  return out.sort((a, b) => a.expiresISO.localeCompare(b.expiresISO)).slice(0, CAPS.documents);
}

/** The prompt fragment both model calls append, so the two stay in step. */
export const PROPOSALS_PROMPT = `
Also return, in the same object:
  "mentions":  [ { "name": "SignUpGenius", "domain": "signupgenius.com" | null, "kind": "biller"|"school"|"activity"|"medical"|"travel"|"admin"|"other", "why": "the SENTENCE around the mention, quoted — what it is for and any date it gives; never a bare link", "sourceId": "..." } ]
  "documents": [ { "label": "Passport — Emma", "kind": "expiry"|"renewal", "dateISO": "YYYY-MM-DD" | null, "why": "one clause quoting the email", "sourceId": "..." } ]
- "mentions" are OTHER organisations the household clearly deals with that are named in these emails — a payment portal, a club, a clinic, an insurer, a coach's organisation. Not the sender itself. Include "domain" only if an address or web domain is actually visible in the text; never guess one.
- "documents" are things with an expiry or renewal date that the email STATES explicitly — a passport, licence, registration, policy, membership, ID. "dateISO" only when the email prints a calendar date; otherwise null and it will be ignored. Never calculate a date.
Both lists may be empty. Do not invent entries to fill them.`;
