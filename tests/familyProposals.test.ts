import { describe, it, expect } from "vitest";
import {
  normalizeSenderMentions, normalizeDocumentProposals, defaultLeadDays, resolveLeadDays, mentionKey, docKey,
} from "../lib/familyProposals";
import { dismissKey } from "../lib/senderDiscovery";
import { EMPTY_FAMILY_PROFILE, type FamilyProfile } from "../lib/familyProfile";

const profile: FamilyProfile = {
  ...EMPTY_FAMILY_PROFILE,
  senders: [{ id: "s1", pattern: "oakwood.org" }],
  billers: [{ id: "b1", pattern: "xcelenergy.com", label: "Electric", cadence: "monthly", autopay: false }],
  documents: [{ id: "d1", label: "Passport — Emma", expiresISO: "2027-02-14" }],
};

describe("normalizeSenderMentions", () => {
  it("keeps a mention with a domain and evidence, collapsing an address to its domain", () => {
    const r = normalizeSenderMentions([
      { name: "MySchoolBucks", domain: "noreply@myschoolbucks.com", kind: "biller", why: "pay lunch balance at myschoolbucks.com", sourceId: "m1" },
    ], profile);
    expect(r).toHaveLength(1);
    expect(r[0].domain).toBe("myschoolbucks.com");
    expect(r[0].category).toBe("biller");
    expect(r[0].sightings).toBe(1);
  });

  it("drops what is already declared (including subdomains), free-mail hosts, and dismissed rows", () => {
    const r = normalizeSenderMentions([
      { name: "Oakwood PTA", domain: "pta.oakwood.org", kind: "school", why: "x", sourceId: "1" },
      { name: "Coach Dan", domain: "gmail.com", kind: "activity", why: "x", sourceId: "2" },
      { name: "Swim Club", domain: "swimclub.org", kind: "activity", why: "x", sourceId: "3" },
      { name: "Scouts", domain: null, kind: "activity", why: "x", sourceId: "4" },
    ], profile, [dismissKey("swimclub.org"), mentionKey("Scouts")]);
    // Coach Dan survives as a NAME-ONLY mention: the free-mail host is not a
    // usable pattern, but the mention itself is still information.
    expect(r.map((m) => m.name)).toEqual(["Coach Dan"]);
    expect(r[0].domain).toBeNull();
  });

  it("merges repeats by domain and counts distinct sightings; unknown kinds become other", () => {
    const r = normalizeSenderMentions([
      { name: "SignUpGenius", domain: "signupgenius.com", kind: "portal", why: "sign up here", sourceId: "a" },
      { name: "SignUpGenius", domain: "signupgenius.com", kind: "activity", why: "sign up here", sourceId: "b" },
      { name: "SignUpGenius", domain: "signupgenius.com", kind: "activity", why: "sign up here", sourceId: "b" },
    ], profile);
    expect(r).toHaveLength(1);
    expect(r[0].sightings).toBe(2);
    expect(r[0].category).toBe("other");
  });

  it("requires evidence and a name; ignores garbage", () => {
    expect(normalizeSenderMentions([{ name: "X", domain: "x.com", kind: "biller", why: "" }, null, 5, "s"], profile)).toEqual([]);
    expect(normalizeSenderMentions("nope", profile)).toEqual([]);
  });
});

describe("normalizeDocumentProposals", () => {
  it("keeps only rows with an explicit future date, dedupes against declared docs, and defaults the lead", () => {
    const r = normalizeDocumentProposals([
      { label: "Passport — Emma", kind: "expiry", dateISO: "2027-02-14", why: "printed", sourceId: "1" },   // already declared
      { label: "Vehicle registration — Honda", kind: "renewal", dateISO: "2026-11-30", why: "renew by Nov 30", sourceId: "2" },
      { label: "Passport — Liam", kind: "expiry", dateISO: null, why: "expires next spring", sourceId: "3" },  // no date → dropped
      { label: "Old policy", kind: "expiry", dateISO: "2025-01-01", why: "expired", sourceId: "4" },          // past → dropped
      { label: "Passport — Liam", kind: "expiry", dateISO: "2028-06-01", why: "expires 1 Jun 2028", sourceId: "5" },
    ], profile, [], "2026-09-29");
    expect(r.map((d) => d.label)).toEqual(["Vehicle registration — Honda", "Passport — Liam"]);
    expect(r[0].leadDays).toBe(30);
    expect(r[1].leadDays).toBe(183);
    expect(r[0].kind).toBe("renewal");
  });

  it("honours a dismissal", () => {
    const r = normalizeDocumentProposals([
      { label: "Gym membership", kind: "renewal", dateISO: "2027-01-01", why: "renews", sourceId: "1" },
    ], profile, [docKey("Gym membership")]);
    expect(r).toEqual([]);
  });
});

describe("lead-day defaults", () => {
  it("knows the common document types and leaves the rest at zero", () => {
    expect(defaultLeadDays("Passport — Emma")).toBe(183);
    expect(defaultLeadDays("Driver's license")).toBe(30);
    expect(defaultLeadDays("Car insurance policy")).toBe(30);
    expect(defaultLeadDays("Library card")).toBe(0);
  });
  it("a declared lead always wins", () => {
    expect(resolveLeadDays({ label: "Passport — Emma", leadDays: 90 })).toBe(90);
    expect(resolveLeadDays({ label: "Passport — Emma" })).toBe(183);
  });
});
