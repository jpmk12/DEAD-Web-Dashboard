import { describe, it, expect } from "vitest";
import { findTripConflicts, withinTrip, conflictLine } from "../lib/familyTripConflict";
import type { DatedItem, TripWindow } from "../lib/familyTripConflict";

const trip: TripWindow = { id: "t1", label: "Stuttgart, DE", startDate: "2026-10-12", endDate: "2026-10-19" };

const item = (over: Partial<DatedItem> = {}): DatedItem => ({
  id: "d1", kind: "deadline", title: "Return the immunization form",
  dateISO: "2026-10-14", ...over,
});

describe("withinTrip", () => {
  it("is inclusive at both ends", () => {
    expect(withinTrip("2026-10-12", trip)).toBe(true);
    expect(withinTrip("2026-10-19", trip)).toBe(true);
    expect(withinTrip("2026-10-11", trip)).toBe(false);
    expect(withinTrip("2026-10-20", trip)).toBe(false);
  });

  it("matches nothing on a malformed or inverted window", () => {
    // An unbounded trip would flag every deadline you have.
    expect(withinTrip("2026-10-14", { ...trip, endDate: "oops" })).toBe(false);
    expect(withinTrip("2026-10-14", { ...trip, startDate: "2026-10-20" })).toBe(false);
    expect(withinTrip("bad-date", trip)).toBe(false);
  });
});

describe("findTripConflicts", () => {
  it("reports a deadline that falls mid-trip", () => {
    const r = findTripConflicts([item()], [trip]);
    expect(r).toHaveLength(1);
    expect(r[0].severity).toBe("away");
    expect(r[0].dayOfTrip).toBe(2);
    expect(r[0].reason).toBe("is due on 2026-10-14, while you are in Stuttgart, DE (2026-10-12 → 2026-10-19)");
  });

  it("treats the return day as tight, not impossible", () => {
    // Telling someone they cannot do a thing they can is how a warning surface
    // loses its credibility.
    const r = findTripConflicts([item({ dateISO: "2026-10-19" })], [trip]);
    expect(r[0].severity).toBe("returns");
    expect(r[0].reason).toMatch(/the day you return/);
  });

  it("never guesses: an undated item cannot conflict", () => {
    expect(findTripConflicts([item({ dateISO: null })], [trip])).toEqual([]);
    expect(findTripConflicts([item({ dateISO: "next Friday" })], [trip])).toEqual([]);
  });

  it("ignores something already handled", () => {
    // It needs nothing from you while away, and would dilute the real rows.
    expect(findTripConflicts([item({ handled: true })], [trip])).toEqual([]);
  });

  it("ignores dates outside every trip", () => {
    expect(findTripConflicts([item({ dateISO: "2026-11-02" })], [trip])).toEqual([]);
  });

  it("reports an item once even when trips overlap", () => {
    const second: TripWindow = { id: "t2", label: "Ramstein", startDate: "2026-10-13", endDate: "2026-10-16" };
    expect(findTripConflicts([item()], [trip, second])).toHaveLength(1);
  });

  it("orders by date, deadlines before events on the same day", () => {
    const r = findTripConflicts([
      item({ id: "e", kind: "event", title: "Parent conference", dateISO: "2026-10-14" }),
      item({ id: "d", kind: "deadline", title: "Trip fee", dateISO: "2026-10-14" }),
      item({ id: "early", kind: "deadline", title: "Form", dateISO: "2026-10-13" }),
    ], [trip]);
    expect(r.map((c) => c.item.id)).toEqual(["early", "d", "e"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => item({ id: `x${i}`, dateISO: "2026-10-14" }));
    expect(findTripConflicts(many, [trip])).toHaveLength(8);
    expect(findTripConflicts(many, [trip], { max: 3 })).toHaveLength(3);
  });

  it("says nothing with no trips", () => {
    expect(findTripConflicts([item()], [])).toEqual([]);
  });
});

describe("conflictLine", () => {
  it("counts deadlines and events separately", () => {
    const r = findTripConflicts([
      item({ id: "d" }),
      item({ id: "e", kind: "event", title: "Conference", dateISO: "2026-10-15" }),
    ], [trip]);
    expect(conflictLine(r)).toBe("1 deadline and 1 event land while you are away");
  });

  it("is null when there is nothing to say", () => {
    expect(conflictLine([])).toBeNull();
  });
});
