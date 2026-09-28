import { describe, it, expect } from "vitest";
import { familyDates, familyDatesByDay, SOON_DAYS, LOOKBACK_DAYS } from "../lib/familyCalendar";
import type { StoredDeadline } from "../lib/familyDeadlines";
import type { FamilyBiller, FamilyDocument, DocExpectationEntry } from "../lib/familyProfile";

const TODAY = "2026-09-28";
const NOW = Date.parse(`${TODAY}T12:00:00Z`);
const d = (days: number) => new Date(NOW + days * 86_400_000).toISOString().slice(0, 10);

const deadline = (over: Partial<StoredDeadline> = {}): StoredDeadline => ({
  id: "m1|form", title: "Return the form", detail: "", dueISO: d(3), personId: "p1", sourceId: "m1",
  buried: false, firstSeen: new Date(NOW).toISOString(), lastSeen: new Date(NOW).toISOString(),
  state: "open", stateAt: null, ...over,
});
const biller = (over: Partial<FamilyBiller> = {}): FamilyBiller =>
  ({ id: "b1", pattern: "xcel.com", label: "Electric — Xcel", cadence: "monthly", autopay: false, ...over });
const doc = (over: Partial<FamilyDocument> = {}): FamilyDocument =>
  ({ id: "d1", label: "Passport — Emma", expiresISO: d(200), leadDays: 183, ...over });
const exp = (over: Partial<DocExpectationEntry> = {}): DocExpectationEntry =>
  ({ id: "x1", label: "W-2", match: "W-2", byISO: d(10), ...over });

const empty = { deadlines: [], billers: [], sightings: [], documents: [], expectations: [] };

describe("familyDates — anchored dates only", () => {
  it("omits an undated deadline rather than guessing a day for it", () => {
    expect(familyDates({ ...empty, deadlines: [deadline({ dueISO: null })] }, TODAY)).toEqual([]);
  });

  it("places a deadline on its due date with tone by proximity", () => {
    const r = familyDates({ ...empty, deadlines: [deadline()] }, TODAY);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("deadline");
    expect(r[0].tone).toBe("soon");
    expect(SOON_DAYS).toBeGreaterThanOrEqual(3);
  });

  it("marks a passed, still-open deadline late and a handled one dimmed", () => {
    const late = familyDates({ ...empty, deadlines: [deadline({ dueISO: d(-2) })] }, TODAY)[0];
    expect(late.tone).toBe("late");
    const done = familyDates({ ...empty, deadlines: [deadline({ dueISO: d(-2), state: "done" })] }, TODAY)[0];
    expect(done.tone).toBe("handled");
  });

  it("drops dates outside the window — the calendar is about what is ahead", () => {
    expect(familyDates({ ...empty, deadlines: [deadline({ dueISO: d(-(LOOKBACK_DAYS + 3)) })] }, TODAY)).toEqual([]);
    expect(familyDates({ ...empty, deadlines: [deadline({ dueISO: d(400) })] }, TODAY)).toEqual([]);
  });
});

describe("familyDates — bills", () => {
  it("uses the newest sighting's due date per biller, not every sighting", () => {
    const r = familyDates({
      ...empty, billers: [biller()],
      sightings: [
        { billerId: "b1", seenISO: d(-40), dueISO: d(-20) },
        { billerId: "b1", seenISO: d(-5), dueISO: d(9) },
      ],
    }, TODAY);
    expect(r).toHaveLength(1);
    expect(r[0].dateISO).toBe(d(9));
    expect(r[0].note).toMatch(/will not pay itself/);
  });

  it("keeps an autopay bill calm even when it is due tomorrow", () => {
    const r = familyDates({
      ...empty, billers: [biller({ autopay: true })],
      sightings: [{ billerId: "b1", seenISO: d(-1), dueISO: d(1) }],
    }, TODAY);
    expect(r[0].tone).toBe("normal");
    expect(r[0].note).toBe("autopay");
  });

  it("ignores sightings with no due date", () => {
    expect(familyDates({ ...empty, billers: [biller()], sightings: [{ billerId: "b1", seenISO: d(-1), dueISO: null }] }, TODAY)).toEqual([]);
  });
});

describe("familyDates — documents", () => {
  it("shows the actionable date and the expiry as two labelled rows", () => {
    // 183-day lead on a 200-day expiry → actionable in 17 days, expiry beyond
    // the default horizon.
    const r = familyDates({ ...empty, documents: [doc()] }, TODAY, { horizonDays: 30 });
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("document");
    expect(r[0].title).toMatch(/renew by/);
    expect(r[0].dateISO).toBe(d(17));

    const both = familyDates({ ...empty, documents: [doc()] }, TODAY, { horizonDays: 365 });
    expect(both.map((x) => x.kind)).toEqual(["document", "document-expiry"]);
  });

  it("shows only the expiry when there is no lead", () => {
    const r = familyDates({ ...empty, documents: [doc({ leadDays: undefined, expiresISO: d(20) })] }, TODAY);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("document-expiry");
  });
});

describe("familyDates — expected documents and ordering", () => {
  it("places an expectation on its by-date", () => {
    const r = familyDates({ ...empty, expectations: [exp()] }, TODAY);
    expect(r[0].kind).toBe("expected");
    expect(r[0].note).toMatch(/watching for/);
  });

  it("sorts by date, then kind, then title, and groups by day", () => {
    const r = familyDates({
      ...empty,
      deadlines: [deadline({ id: "z", title: "Zeta", dueISO: d(5) }), deadline({ id: "a", title: "Alpha", dueISO: d(5) })],
      expectations: [exp({ byISO: d(2) })],
    }, TODAY);
    expect(r.map((x) => x.title)).toEqual(["W-2 — expected by", "Alpha", "Zeta"]);
    const byDay = familyDatesByDay(r);
    expect(byDay.get(d(5))).toHaveLength(2);
    expect(byDay.get(d(2))).toHaveLength(1);
  });
});
