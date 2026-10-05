import { describe, it, expect } from "vitest";
import { dedupeFamilyDates, agendaFamilyDates, dontMissRows, todayCounts, tripChipFor } from "../lib/calendarDontMiss";
import { normalizeMailDates, mailDatesFrom, eventPlanFor } from "../lib/mailDates";
import type { FamilyDate } from "../lib/familyCalendar";
import type { GoogleTask, EmailMessage } from "../lib/types";
import type { Contact, ContactStatus } from "../lib/contacts";

const fd = (id: string, title: string, dateISO: string, tone: FamilyDate["tone"] = "late", kind: FamilyDate["kind"] = "deadline"): FamilyDate => ({ id, title, dateISO, tone, kind });
const task = (id: string, title: string, due?: string): GoogleTask => ({ id, title, status: "needsAction", due: due ? `${due}T00:00:00.000Z` : undefined, updated: "" });
const contact = (id: string, name: string, state: ContactStatus["state"], daysUntil: number | null = null): Contact & { status: ContactStatus } =>
  ({ id, name, email: null, cadenceDays: 90, tier: null, lastContacted: null, notes: null, createdAt: "", status: { state, daysUntil, nextDue: null } });

describe("dedupeFamilyDates", () => {
  it("merges the same obligation extracted from three newsletters", () => {
    const rows = dedupeFamilyDates([
      fd("a", "Scholastic Book Fair – Set Up E-Wallet", "2026-10-01"),
      fd("b", "Scholastic Book Fair — set up e-wallet for Abigail", "2026-10-01"),
      fd("c", "Scholastic Book Fair e-wallet setup", "2026-10-01"),
      fd("d", "Class T-Shirt Order Due", "2026-10-02"),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].mergedCount).toBe(3);
    expect(rows[0].mergedIds).toEqual(["a", "b", "c"]);
  });
  it("never merges across dates or kinds", () => {
    const rows = dedupeFamilyDates([fd("a", "Picture Day", "2026-10-15"), fd("b", "Picture Day", "2026-10-16"), fd("c", "Picture Day", "2026-10-15", "normal", "bill")]);
    expect(rows).toHaveLength(3);
  });
});

describe("dontMissRows / agendaFamilyDates / todayCounts", () => {
  const today = "2026-10-05";
  it("collects late and due items across the three sources, late first and most-late first", () => {
    const rows = dontMissRows({
      famDates: dedupeFamilyDates([fd("a", "Book fair e-wallet", "2026-10-01"), fd("b", "Field trip form", "2026-10-05", "soon"), fd("h", "Done thing", "2026-10-01", "handled")]),
      tasks: [task("t1", "Change of address", "2026-08-05"), task("t2", "Reply to AFCYP", "2026-10-09"), task("t3", "Someday", undefined), task("t4", "Far", "2026-11-30")],
      contacts: [contact("c1", "John", "never"), contact("c2", "Sean", "soon", 4), contact("c3", "Dee", "overdue", -18)],
      today,
    });
    expect(rows.map((r) => r.id)).toEqual(["task:t1", "ppl:c3", "fam:a", "ppl:c1", "fam:b", "task:t2"]);
    expect(rows.find((r) => r.id === "fam:a")?.when).toBe("late 4 d");
    expect(rows.find((r) => r.id === "task:t2")?.severity).toBe("week");
    expect(todayCounts(rows)).toEqual({ overdueTasks: 1, familyDue: 2, checkinsDue: 2 });
  });
  it("the agenda keeps only today and the future", () => {
    expect(agendaFamilyDates([fd("a", "x", "2026-10-01"), fd("b", "y", "2026-10-05", "soon"), fd("c", "z", "2026-10-09", "normal")], today).map((f) => f.id)).toEqual(["b", "c"]);
  });
});

describe("tripChipFor", () => {
  it("names the trip and the day of it; nothing outside", () => {
    const trips = [{ label: "Amman, Jordan", startDate: "2026-10-05", endDate: "2026-10-13" }];
    expect(tripChipFor("2026-10-09", trips)).toBe("TDY · Amman — day 5 of 9");
    expect(tripChipFor("2026-10-20", trips)).toBeNull();
  });
});

describe("mail dates", () => {
  const today = "2026-10-05";
  const email: EmailMessage = { id: "m1", account: "primary", accountEmail: "me@x.com", subject: "Re: Pass Day Closure 9 Oct 2026", from: "AFCYP <a@b.mil>", date: "2026-10-03T12:00:00Z", snippet: "", bodyPreview: "", priority: "High", summary: "" };
  it("keeps an anchored date, keeps an unanchored phrase with when null (also when the model put the phrase in `when`), drops the past and the absurd", () => {
    const out = normalizeMailDates([
      { when: "2026-10-09", whenText: "9 Oct", what: "Pass Day closure — childcare" },
      { when: null, whenText: "next Friday", what: "Picture day retakes" },
      { when: "2026-09-01", whenText: "1 Sep", what: "old" },
      { when: "2028-01-01", whenText: "someday", what: "too far" },
      { when: "next friday", whenText: "next friday", what: "not iso" },
    ], email, today);
    expect(out.map((d) => [d.when, d.what])).toEqual([["2026-10-09", "Pass Day closure — childcare"], [null, "Picture day retakes"], [null, "not iso"]]);
    expect(out[0].id).toBe("m1:0");
  });
  it("caps at three per email and drops exact duplicates", () => {
    const raw = Array.from({ length: 6 }, (_, i) => ({ when: `2026-10-1${i}`, whenText: "x", what: i < 2 ? "same" : `thing ${i}` }));
    expect(normalizeMailDates([raw[0], raw[0], ...raw.slice(1)], email, today)).toHaveLength(3);
  });
  it("orders anchored by date then unanchored by mail recency, honouring dismissals", () => {
    const e2: EmailMessage = { ...email, id: "m2", date: "2026-10-05T12:00:00Z", dates: [{ when: null, whenText: "soon", what: "later thing" }] };
    const e1: EmailMessage = { ...email, dates: [{ when: "2026-10-31", whenText: "Oct 31", what: "report" }, { when: "2026-10-09", whenText: "9 Oct", what: "closure" }] };
    const out = mailDatesFrom([e2, e1], today, new Set(["m1:0"]));
    expect(out.map((d) => d.what)).toEqual(["closure", "later thing"]);
  });
  it("plans an all-day event for a bare date and 30 minutes for a timed one", () => {
    expect(eventPlanFor({ when: "2026-10-09", what: "x" } as never)).toEqual({ summary: "x", start: "2026-10-09", end: "2026-10-10" });
    expect(eventPlanFor({ when: "2026-10-15T15:00", what: "y" } as never)).toEqual({ summary: "y", start: "2026-10-15T15:00:00", end: "2026-10-15T15:30:00" });
    expect(eventPlanFor({ when: null, what: "z" } as never)).toBeNull();
  });
});
