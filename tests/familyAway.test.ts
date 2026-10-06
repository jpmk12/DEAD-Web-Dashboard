import { describe, it, expect } from "vitest";
import { datesInText } from "../lib/datesInText";
import { awayList, pickTrip, awayText } from "../lib/familyAway";
import { dedupeDeadlines, splitHandled, isNewSince, mergeDeadlines, deadlineKey, toView } from "../lib/familyDeadlines";
import type { DeadlineView, StoredDeadline } from "../lib/familyDeadlines";
import type { TripWindow, DatedItem } from "../lib/familyTripConflict";

const TODAY = "2026-10-06";

describe("datesInText", () => {
  it("finds explicit month-day dates and resolves the year forward", () => {
    const out = datesInText("Picture Day is October 15. Online ordering is open. The e-wallet closes Oct 1-8.", TODAY);
    expect(out.map((d) => d.iso)).toEqual(["2026-10-15", "2026-10-01"]);
    expect(out[0].phrase).toContain("Picture Day is October 15");
  });
  it("reads numeric, day-first and ISO forms and keeps a printed year", () => {
    expect(datesInText("due 10/15 and again 15 October 2027, see 2026-12-01", TODAY).map((d) => d.iso)).toEqual(["2026-10-15", "2027-10-15", "2026-12-01"]);
  });
  it("never resolves a relative phrase and drops impossible dates", () => {
    expect(datesInText("Forms are due next Friday, or by the 15th at the latest.", TODAY)).toEqual([]);
    expect(datesInText("February 30 and 13/45", TODAY)).toEqual([]);
  });
  it("leans a recent past date to this year, a far one to next year", () => {
    expect(datesInText("sent September 20", TODAY)[0].iso).toBe("2026-09-20");
    expect(datesInText("renew by March 3", TODAY)[0].iso).toBe("2027-03-03");
  });
  it("dedupes and caps at six", () => {
    const text = Array.from({ length: 9 }, (_, i) => `Nov ${i + 1}`).join(", ") + ", and Nov 1 again";
    expect(datesInText(text, TODAY)).toHaveLength(6);
  });
});

describe("awayList", () => {
  const trips: TripWindow[] = [
    { id: "old", label: "Stuttgart, DE", startDate: "2026-06-01", endDate: "2026-06-10" },
    { id: "now", label: "Amman, Jordan", startDate: "2026-08-25", endDate: "2027-03-01" },
    { id: "later", label: "Ramstein", startDate: "2027-04-01", endDate: "2027-04-09" },
  ];
  const item = (id: string, dateISO: string | null, over: Partial<DatedItem> = {}): DatedItem => ({ id, kind: "deadline", title: id, dateISO, ...over });
  it("picks the trip you are on, never a past one, and splits happened from ahead", () => {
    const list = awayList([
      item("june", "2026-06-05"),                  // past trip — ignored
      item("dental", "2026-09-22", { handled: true }),
      item("tshirt", "2026-10-02"),
      item("old-happened", "2026-09-01"),          // outside the 14-day lookback
      item("closure", "2026-10-09", { kind: "event" }),
      item("done-ahead", "2026-10-12", { handled: true }),
      item("undated", null),
    ], trips, TODAY)!;
    expect(list.trip.id).toBe("now");
    expect(list.status).toBe("on");
    expect(list.day).toBe(43);
    expect(list.days).toBe(189);
    expect(list.happened.map((r) => r.id)).toEqual(["dental", "tshirt"]);
    expect(list.ahead.map((r) => r.id)).toEqual(["closure"]);
  });
  it("falls through to the next trip when none is current, and to null when none is ahead", () => {
    expect(pickTrip(trips, "2027-03-15")!.trip.id).toBe("later");
    expect(pickTrip(trips, "2027-03-15")!.status).toBe("ahead");
    expect(pickTrip([trips[0]], TODAY)).toBeNull();
    expect(awayList([], [trips[0]], TODAY)).toBeNull();
  });
  it("renders a copyable list", () => {
    const list = awayList([item("tshirt", "2026-10-02", { personId: "a" }), item("closure", "2026-10-09", { kind: "event", personId: null })], trips, TODAY)!;
    const text = awayText(list, (id) => (id === "a" ? "Abigail" : "both"));
    expect(text).toContain("Happened since I left:\n- 10/02 · Abigail — tshirt");
    expect(text).toContain("Before I am back:\n- 10/09 · both — closure");
  });
});

describe("dedupeDeadlines / splitHandled / isNewSince / user dates", () => {
  const NOW = Date.parse(`${TODAY}T12:00:00Z`);
  const stored = (id: string, title: string, over: Partial<StoredDeadline> = {}): StoredDeadline => ({
    id, title, detail: "", dueISO: "2026-10-01", personId: "a", sourceId: id, buried: false,
    firstSeen: new Date(NOW - 7 * 86_400_000).toISOString(), lastSeen: new Date(NOW).toISOString(), state: "open", stateAt: null, ...over,
  });
  const view = (id: string, title: string, over: Partial<StoredDeadline> = {}): DeadlineView => toView(stored(id, title, over), TODAY, NOW);

  it("merges the same obligation from three newsletters, not across people, dates or handled-ness", () => {
    const rows = dedupeDeadlines([
      view("m1", "Scholastic Book Fair – Set Up E-Wallet"),
      view("m2", "Scholastic Book Fair — set up e-wallet for Abigail"),
      view("m3", "Scholastic Book Fair e-wallet setup"),
      view("m4", "Scholastic Book Fair e-wallet setup", { personId: "b" }),
      view("m5", "Scholastic Book Fair e-wallet setup", { dueISO: null }),
      view("m6", "Scholastic Book Fair e-wallet setup", { state: "done", stateAt: new Date(NOW).toISOString() }),
    ]);
    expect(rows).toHaveLength(4);
    expect(rows[0].mergedIds).toEqual(["m1", "m2", "m3"]);
    expect(rows[0].mergedCount).toBe(3);
    expect(rows[0].title).toBe("Scholastic Book Fair e-wallet setup");
  });
  it("splits handled rows out and marks rows first seen after the last visit", () => {
    const rows = [view("a", "x"), view("b", "y", { state: "dismissed", stateAt: new Date(NOW).toISOString() }), view("c", "z", { firstSeen: new Date(NOW - 3600_000).toISOString() })];
    const { open, handled } = splitHandled(rows);
    expect(open.map((r) => r.id)).toEqual(["a", "c"]);
    expect(handled.map((r) => r.id)).toEqual(["b"]);
    expect(isNewSince(rows[2], NOW - 86_400_000)).toBe(true);
    expect(isNewSince(rows[0], NOW - 86_400_000)).toBe(false);
    expect(isNewSince(rows[2], 0)).toBe(false);
  });
  it("a re-extraction never overwrites a date the user set or cleared", () => {
    const prev = stored(deadlineKey("m9", "Picture Day order"), "Picture Day order", { dueISO: "2026-10-15", dueSource: "user" });
    const r1 = mergeDeadlines([prev], [{ title: "Picture Day order", detail: "", dueISO: "2026-10-20", personId: "a", sourceId: "m9", buried: false }]);
    expect(r1.upserts[0].dueISO).toBe("2026-10-15");
    const cleared = { ...prev, dueISO: null };
    const r2 = mergeDeadlines([cleared], [{ title: "Picture Day order", detail: "", dueISO: "2026-10-20", personId: "a", sourceId: "m9", buried: false }]);
    expect(r2.upserts[0].dueISO).toBeNull();
  });
});
