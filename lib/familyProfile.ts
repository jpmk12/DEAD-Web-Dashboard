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

export interface FamilySender {
  id: string;
  pattern: string;       // "principal@oakwood.org" or a bare domain "oakwood.org"
  label?: string;        // "Oakwood Elementary"
  personId?: string;     // when this sender only ever concerns one person
}

export interface FamilyProfile {
  people: FamilyPerson[];
  senders: FamilySender[];
  // Household items (insurance, appointments, visiting relatives) ride the
  // same surface — they are the other half of "don't let me miss something".
  includeHousehold: boolean;
}

export const EMPTY_FAMILY_PROFILE: FamilyProfile = { people: [], senders: [], includeHousehold: true };

const CAPS = { people: 12, senders: 40 };

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
      return [{
        id, pattern,
        ...(label ? { label } : {}),
        // A personId pointing at a deleted person is dropped, not kept dangling.
        ...(personId && seenIds.has(personId) ? { personId } : {}),
      }];
    })
    .slice(0, CAPS.senders);

  return { people, senders, includeHousehold: r.includeHousehold !== false };
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
export function gmailQueryFor(profile: FamilyProfile, days = 14): string {
  const pats = profile.senders.map((s) => s.pattern).filter(Boolean);
  if (pats.length === 0) return "";
  const from = pats.map((p) => (p.includes("@") ? p : `@${p}`)).join(" OR ");
  return `from:(${from}) newer_than:${Math.max(1, Math.min(90, Math.round(days)))}d`;
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
