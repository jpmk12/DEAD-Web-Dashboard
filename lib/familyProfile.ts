// The Family declaration — who is in the household and which senders talk
// about them. PURE and client-safe (no node:*, no fetch), unit-tested.
//
// Same philosophy as the Mission Profile: the user DECLARES the roster, and
// the app derives everything else from it. A category this personal cannot be
// inferred cold — "is this email about my kid" has no general answer — but
// given a roster it becomes tractable, and the roster doubles as the Gmail
// query so the digest only ever pulls mail that is already family mail.

export type FamilyRole = "child" | "adult";

export interface FamilyPerson {
  id: string;
  name: string;
  role: FamilyRole;
  grade?: string;   // "4th" — free text, schools disagree about notation
  school?: string;  // "Oakwood Elementary"
}

// What KIND of thing a sender is, which decides what gets tracked from it.
// One list with a category rather than a list per category: the digest already
// reads every sender the same way, and a sixth parallel array would multiply the
// places a "Preferences save must not clobber this" bug can appear.
//
// `biller` is deliberately NOT here — billers live in their own list because the
// silence watch needs a declared cadence and an autopay flag, which no other
// category has.
export type SenderCategory =
  | "school"       // the school itself — newsletters, notices, report cards
  | "activity"     // sports, music, scouts, camps — signups, fees, schedules
  | "medical"      // appointments, results, refills
  | "travel"       // flights, hotels, reservations
  | "admin"        // government, base, DMV, taxes, legal
  | "other";

export const SENDER_CATEGORIES: SenderCategory[] = ["school", "activity", "medical", "travel", "admin", "other"];

export const SENDER_CATEGORY_LABEL: Record<SenderCategory, string> = {
  school: "School", activity: "Activity", medical: "Medical",
  travel: "Travel", admin: "Admin", other: "Other",
};

/** What declaring a sender in this category actually buys you. Shown on the
 *  proposal row, because a recommendation the user cannot evaluate is a nag. */
export const SENDER_CATEGORY_TRACKS: Record<SenderCategory, string> = {
  school: "deadlines, forms and buried notices from this school",
  activity: "signup windows, fees and schedule changes",
  medical: "appointment and follow-up dates",
  travel: "booking dates and check-in windows",
  admin: "filing and renewal deadlines",
  other: "dates and deadlines in this sender's mail",
};

export interface FamilySender {
  id: string;
  pattern: string;       // "principal@oakwood.org" or a bare domain "oakwood.org"
  label?: string;        // "Oakwood Elementary"
  personId?: string;     // when this sender only ever concerns one person
  category?: SenderCategory;  // absent on pre-category rows — treated as "school"
}

// How often a biller is expected to write. `auto` (the default) means "learn
// it from the sighting history": once four sightings agree on a band,
// lib/billHistory's observedCadence names it and the silence watch runs on
// that; until then the biller is treated like `irregular` (never accused).
// A declared cadence still wins outright — three months of history cannot
// distinguish "quarterly" from "stopped", and a user who knows can say so.
export type BillCadence = "auto" | "monthly" | "quarterly" | "annual" | "irregular";
export const BILL_CADENCES: BillCadence[] = ["auto", "monthly", "quarterly", "annual", "irregular"];

export interface FamilyBiller {
  id: string;
  pattern: string;           // address or bare domain, same matching as senders
  label: string;             // "Electric — Xcel Energy"
  cadence: BillCadence;
  // Whether it pays itself. The question this pane answers is not "what is
  // due" but "what will NOT pay itself", so this drives the ordering.
  autopay: boolean;
}

// Things with an expiry and no reminder attached. Declared rather than
// extracted: a passport expiry never arrives by email, so there is nothing to
// read. Trying to infer these would invent dates.
export interface FamilyDocument {
  id: string;
  label: string;             // "Passport — Emma"
  expiresISO: string;        // YYYY-MM-DD
  note?: string;             // "6-month validity rule applies"
  // Lead time before expiry at which this becomes actionable (renewal windows
  // open early; passports are unusable for travel months before they expire).
  leadDays?: number;
}

// A document expected ONCE by a date, with a declared phrase to recognise it.
// Distinct from FamilyDocument (which has an EXPIRY and never arrives by email)
// and from FamilyBiller (which has a cadence): a W-2 or a report card is a
// one-off arrival, which nothing in the app was watching for.
export interface DocExpectationEntry {
  id: string;
  label: string;
  match: string;            // "W-2" — declared, never inferred from a subject
  byISO: string;            // yyyy-mm-dd it should have arrived by
  fromPattern?: string;     // optional sender constraint
  note?: string;
}

export interface FamilyProfile {
  people: FamilyPerson[];
  senders: FamilySender[];
  // Household items (insurance, appointments, visiting relatives) ride the
  // same surface — they are the other half of "don't let me miss something".
  includeHousehold: boolean;
  billers: FamilyBiller[];
  documents: FamilyDocument[];
  expectations: DocExpectationEntry[];
  // Run the headers-only sender discovery scan by itself, about weekly, when
  // the Family tab is opened. Still a POST, still subjects and addresses only;
  // the only thing that changes is that the user no longer has to remember to
  // press Scan. Off = the button is the only trigger.
  autoDiscover: boolean;
}

export const EMPTY_FAMILY_PROFILE: FamilyProfile = {
  people: [], senders: [], includeHousehold: true, billers: [], documents: [], expectations: [], autoDiscover: true,
};

const CAPS = { people: 12, senders: 40, billers: 40, documents: 30, expectations: 30 };

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

// Malformed entries are DROPPED, never defaulted — a roster with a silently
// invented person would mis-route real mail.
export function sanitizeFamilyProfile(raw: unknown): FamilyProfile {
  if (!raw || typeof raw !== "object") return { ...EMPTY_FAMILY_PROFILE };
  const r = raw as Record<string, unknown>;

  const people: FamilyPerson[] = (Array.isArray(r.people) ? r.people : [])
    .flatMap((p): FamilyPerson[] => {
      if (!p || typeof p !== "object") return [];
      const o = p as Record<string, unknown>;
      const name = str(o.name, 60);
      if (!name) return [];
      const id = str(o.id, 40) || `p-${slug(name)}`;
      const role: FamilyRole = o.role === "adult" ? "adult" : "child";
      const grade = str(o.grade, 20);
      const school = str(o.school, 80);
      return [{ id, name, role, ...(grade ? { grade } : {}), ...(school ? { school } : {}) }];
    })
    .slice(0, CAPS.people);

  const seenIds = new Set(people.map((p) => p.id));

  const senders: FamilySender[] = (Array.isArray(r.senders) ? r.senders : [])
    .flatMap((s): FamilySender[] => {
      if (!s || typeof s !== "object") return [];
      const o = s as Record<string, unknown>;
      const pattern = str(o.pattern, 120).toLowerCase();
      if (!pattern || !/^[a-z0-9@._+-]+$/.test(pattern)) return [];
      const id = str(o.id, 40) || `s-${slug(pattern)}`;
      const label = str(o.label, 60);
      const personId = str(o.personId, 40);
      const cat = str(o.category, 16) as SenderCategory;
      const category = SENDER_CATEGORIES.includes(cat) ? cat : undefined;
      return [{
        id, pattern,
        ...(label ? { label } : {}),
        // Absent stays absent rather than defaulting: every sender predating
        // categories was a school sender, and `senderCategory()` resolves that
        // at read time. Writing a default here would make the two cases
        // indistinguishable later.
        ...(category ? { category } : {}),
        // A personId pointing at a deleted person is dropped, not kept dangling.
        ...(personId && seenIds.has(personId) ? { personId } : {}),
      }];
    })
    .slice(0, CAPS.senders);

  const CADENCES = new Set<BillCadence>(BILL_CADENCES);
  const billers: FamilyBiller[] = (Array.isArray(r.billers) ? r.billers : [])
    .flatMap((b): FamilyBiller[] => {
      if (!b || typeof b !== "object") return [];
      const o = b as Record<string, unknown>;
      const pattern = str(o.pattern, 120).toLowerCase();
      if (!pattern || !/^[a-z0-9@._+-]+$/.test(pattern)) return [];
      // Absent or malformed → auto (learn from history), never a guessed
      // "monthly" that would arm the silence watch on a biller we know
      // nothing about.
      const cadence = CADENCES.has(o.cadence as BillCadence) ? (o.cadence as BillCadence) : "auto";
      return [{
        id: str(o.id, 40) || `b-${slug(pattern)}`,
        pattern,
        label: str(o.label, 60) || pattern,
        cadence,
        autopay: o.autopay === true,
      }];
    })
    .slice(0, CAPS.billers);

  const documents: FamilyDocument[] = (Array.isArray(r.documents) ? r.documents : [])
    .flatMap((d): FamilyDocument[] => {
      if (!d || typeof d !== "object") return [];
      const o = d as Record<string, unknown>;
      const label = str(o.label, 80);
      const expiresISO = str(o.expiresISO, 10);
      // A document row with no usable expiry has nothing to say — drop it
      // rather than render a card with a blank runway.
      if (!label || !/^\d{4}-\d{2}-\d{2}$/.test(expiresISO)) return [];
      if (!Number.isFinite(Date.parse(`${expiresISO}T12:00:00Z`))) return [];
      const lead = Number(o.leadDays);
      const note = str(o.note, 160);
      return [{
        id: str(o.id, 40) || `d-${slug(label)}`,
        label, expiresISO,
        ...(note ? { note } : {}),
        ...(Number.isFinite(lead) && lead > 0 ? { leadDays: Math.min(730, Math.round(lead)) } : {}),
      }];
    })
    .slice(0, CAPS.documents);

  const expectations: DocExpectationEntry[] = (Array.isArray(r.expectations) ? r.expectations : [])
    .flatMap((x): DocExpectationEntry[] => {
      if (!x || typeof x !== "object") return [];
      const o = x as Record<string, unknown>;
      const label = str(o.label, 80);
      const match = str(o.match, 60);
      const byISO = str(o.byISO, 10);
      // All three are required. Without a match phrase we would have to guess
      // which mail satisfies the expectation, and a confident wrong answer here
      // means an unnoticed missing document.
      if (!label || match.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(byISO)) return [];
      if (!Number.isFinite(Date.parse(`${byISO}T12:00:00Z`))) return [];
      const fromPattern = str(o.fromPattern, 120);
      const note = str(o.note, 160);
      return [{
        id: str(o.id, 40) || `x-${slug(label)}`,
        label, match, byISO,
        ...(fromPattern ? { fromPattern } : {}),
        ...(note ? { note } : {}),
      }];
    })
    .slice(0, CAPS.expectations);

  return {
    people, senders, includeHousehold: r.includeHousehold !== false, billers, documents, expectations,
    autoDiscover: r.autoDiscover !== false,
  };
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
}

// Extract the bare address from a "Name <a@b.c>" From header, lowercased.
export function addressOf(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

// Which declared sender (if any) a From header matches. A pattern containing
// "@" must match the address exactly; a bare domain matches any address at or
// under it, so "oakwood.org" also catches "noreply@mail.oakwood.org".
export function senderFor(profile: FamilyProfile, from: string): FamilySender | null {
  const addr = addressOf(from);
  if (!addr) return null;
  for (const s of profile.senders) {
    if (s.pattern.includes("@")) {
      if (addr === s.pattern) return s;
    } else {
      const domain = addr.split("@")[1] ?? "";
      if (domain === s.pattern || domain.endsWith(`.${s.pattern}`)) return s;
    }
  }
  return null;
}

// The Gmail search that pulls exactly the declared family mail. Scoping the
// QUERY (rather than fetching everything and classifying) is what keeps this
// feature cheap and stops it reading mail that was never family mail.
/** A sender's effective category. Rows created before categories existed were
 *  all school senders, which is why the fallback is `school` and not `other`. */
export function senderCategory(s: FamilySender): SenderCategory {
  return s.category ?? "school";
}

export function gmailQueryFor(profile: FamilyProfile, days = 14): string {
  const pats = profile.senders.map((s) => s.pattern).filter(Boolean);
  if (pats.length === 0) return "";
  const from = pats.map((p) => (p.includes("@") ? p : `@${p}`)).join(" OR ");
  return `from:(${from}) newer_than:${Math.max(1, Math.min(90, Math.round(days)))}d`;
}

// Billers are queried separately from school senders, over a longer window:
// the silence watch needs enough history to know a cadence. Keeping the two
// searches apart also means the school digest never reads financial mail.
export function billerQueryFor(profile: FamilyProfile, days = 90): string {
  const pats = profile.billers.map((b) => b.pattern).filter(Boolean);
  if (pats.length === 0) return "";
  const from = pats.map((p) => (p.includes("@") ? p : `@${p}`)).join(" OR ");
  return `from:(${from}) newer_than:${Math.max(1, Math.min(365, Math.round(days)))}d`;
}

export function billerFor(profile: FamilyProfile, from: string): FamilyBiller | null {
  const addr = addressOf(from);
  if (!addr) return null;
  for (const b of profile.billers) {
    if (b.pattern.includes("@")) {
      if (addr === b.pattern) return b;
    } else {
      const domain = addr.split("@")[1] ?? "";
      if (domain === b.pattern || domain.endsWith(`.${b.pattern}`)) return b;
    }
  }
  return null;
}

// One line of roster context for the model prompt.
export function familyContextLine(profile: FamilyProfile): string {
  if (profile.people.length === 0) return "";
  const who = profile.people
    .map((p) => {
      const bits = [p.name];
      if (p.role === "child") {
        const sch = [p.grade, p.school].filter(Boolean).join(" at ");
        if (sch) bits.push(`(${sch})`);
        else bits.push("(child)");
      } else bits.push("(adult)");
      return bits.join(" ");
    })
    .join(", ");
  return `Household roster: ${who}.`;
}
