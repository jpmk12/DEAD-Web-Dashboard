import { describe, it, expect } from "vitest";
import {
  sanitizeFamilyProfile, senderFor, gmailQueryFor, addressOf, familyContextLine,
  type FamilyProfile,
} from "../lib/familyProfile";
import { normalizeProposed, endForEvent, sortProposed, isAnchoredDate } from "../lib/familyDates";

const profile: FamilyProfile = sanitizeFamilyProfile({
  people: [
    { id: "p-emma", name: "Emma", role: "child", grade: "4th", school: "Oakwood Elementary" },
    { id: "p-sarah", name: "Sarah", role: "adult" },
  ],
  senders: [
    { id: "s1", pattern: "oakwood.org", label: "Oakwood Elementary", personId: "p-emma" },
    { id: "s2", pattern: "coach@lincoln.k12.us" },
    { id: "s3", pattern: "ghost", personId: "p-nobody" },
  ],
  includeHousehold: true,
});

describe("sanitizeFamilyProfile", () => {
  it("keeps valid rows and drops malformed ones rather than defaulting", () => {
    const p = sanitizeFamilyProfile({
      people: [{ name: "Emma", role: "child" }, { name: "" }, "nope", { role: "child" }],
      senders: [{ pattern: "a@b.com" }, { pattern: "has space" }, { pattern: "" }],
    });
    expect(p.people.map((x) => x.name)).toEqual(["Emma"]);
    expect(p.senders.map((x) => x.pattern)).toEqual(["a@b.com"]);
  });

  it("derives ids, defaults role to child, and drops a dangling personId", () => {
    expect(profile.people[0].id).toBe("p-emma");
    expect(sanitizeFamilyProfile({ people: [{ name: "Jack Jones" }] }).people[0]).toMatchObject({
      id: "p-jack-jones", role: "child",
    });
    // s3 points at a person who does not exist — the link is dropped, the sender kept.
    expect(profile.senders.find((s) => s.pattern === "ghost")?.personId).toBeUndefined();
  });

  it("defaults includeHousehold on and honours an explicit false", () => {
    expect(sanitizeFamilyProfile({}).includeHousehold).toBe(true);
    expect(sanitizeFamilyProfile({ includeHousehold: false }).includeHousehold).toBe(false);
  });
});

describe("senderFor", () => {
  it("matches a bare domain at and below itself, and an address exactly", () => {
    expect(senderFor(profile, "Office <office@oakwood.org>")?.personId).toBe("p-emma");
    expect(senderFor(profile, "noreply@mail.oakwood.org")?.pattern).toBe("oakwood.org");
    expect(senderFor(profile, "coach@lincoln.k12.us")?.pattern).toBe("coach@lincoln.k12.us");
  });

  it("does not match a lookalike domain or a different mailbox at a listed address", () => {
    expect(senderFor(profile, "spam@notoakwood.org")).toBeNull();
    expect(senderFor(profile, "principal@lincoln.k12.us")).toBeNull();  // address pattern, not domain
    expect(senderFor(profile, "")).toBeNull();
  });

  it("addressOf unwraps a display-name header", () => {
    expect(addressOf('"Reyes, Ms." <reyes@oakwood.org>')).toBe("reyes@oakwood.org");
    expect(addressOf("plain@x.io")).toBe("plain@x.io");
  });
});

describe("gmailQueryFor", () => {
  it("scopes the query to declared senders, prefixing bare domains with @", () => {
    expect(gmailQueryFor(profile, 14))
      .toBe("from:(@oakwood.org OR coach@lincoln.k12.us OR @ghost) newer_than:14d");
  });

  it("returns empty when no senders are declared — no roster, no fetch", () => {
    expect(gmailQueryFor(sanitizeFamilyProfile({}), 14)).toBe("");
  });
});

describe("familyContextLine", () => {
  it("describes children with their school and adults plainly", () => {
    expect(familyContextLine(profile))
      .toBe("Household roster: Emma (4th at Oakwood Elementary), Sarah (adult).");
    expect(familyContextLine(sanitizeFamilyProfile({}))).toBe("");
  });
});

// ── date validation ─────────────────────────────────────────────────────────

const NOW = Date.UTC(2026, 8, 27, 12, 0);
const ids = new Set(["p-emma", "p-sarah"]);

describe("normalizeProposed", () => {
  it("accepts an anchored date and does not ask for confirmation", () => {
    const e = normalizeProposed(
      { title: "Field trip", startISO: "2026-10-08T07:15:00Z", personId: "p-emma", sourceId: "m1" },
      { validPersonIds: ids, nowMs: NOW })!;
    expect(e.needsConfirm).toBe(false);
    expect(e.startISO).toBe("2026-10-08T07:15:00Z");
    expect(e.allDay).toBe(false);
  });

  it("flags a relative phrase even when the model also supplied a date", () => {
    // This is the important one: the date IS the model's guess.
    const e = normalizeProposed(
      { title: "Spirit Week", startISO: "2026-10-09", relativePhrase: "next Friday", sourceId: "m2" },
      { validPersonIds: ids, nowMs: NOW })!;
    expect(e.needsConfirm).toBe(true);
    expect(e.relativePhrase).toBe("next Friday");
    expect(e.allDay).toBe(true);
  });

  it("keeps the row but unanchors an absurd or missing date", () => {
    const far = normalizeProposed(
      { title: "Graduation", startISO: "2031-06-01", sourceId: "m3" },
      { validPersonIds: ids, nowMs: NOW })!;
    expect(far.startISO).toBeNull();
    expect(far.needsConfirm).toBe(true);

    const none = normalizeProposed({ title: "Bake sale", sourceId: "m4" }, { validPersonIds: ids, nowMs: NOW })!;
    expect(none.startISO).toBeNull();
    expect(none.needsConfirm).toBe(true);
  });

  it("drops an unusable row and an unknown personId", () => {
    expect(normalizeProposed({ title: "", sourceId: "m5" }, { validPersonIds: ids, nowMs: NOW })).toBeNull();
    expect(normalizeProposed({ title: "x" }, { validPersonIds: ids, nowMs: NOW })).toBeNull();
    const e = normalizeProposed(
      { title: "Thing", sourceId: "m6", personId: "p-ghost", startISO: "2026-10-01" },
      { validPersonIds: ids, nowMs: NOW })!;
    expect(e.personId).toBeNull();
  });

  it("isAnchoredDate rejects prose and accepts both ISO shapes", () => {
    expect(isAnchoredDate("2026-10-08")).toBe(true);
    expect(isAnchoredDate("2026-10-08T07:15:00Z")).toBe(true);
    expect(isAnchoredDate("next Friday")).toBe(false);
    expect(isAnchoredDate("2026-13-45")).toBe(false);
  });
});

describe("endForEvent / sortProposed", () => {
  const mk = (title: string, startISO: string | null, allDay = false) =>
    ({ id: title, title, personId: null, startISO, endISO: null, allDay,
       sourceId: "m", sourceLabel: "", needsConfirm: startISO === null });

  it("gives an all-day event one day and a timed event one hour", () => {
    expect(endForEvent(mk("a", "2026-10-08", true))).toBe("2026-10-09");
    expect(endForEvent(mk("b", "2026-10-08T07:15:00Z"))).toBe("2026-10-08T08:15:00.000Z");
    expect(endForEvent(mk("c", null))).toBeNull();
  });

  it("sorts soonest first and floats unanchored events to the bottom", () => {
    const out = sortProposed([mk("late", "2026-10-20"), mk("unknown", null), mk("soon", "2026-10-01")]);
    expect(out.map((e) => e.title)).toEqual(["soon", "late", "unknown"]);
  });
});
