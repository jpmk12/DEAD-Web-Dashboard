import { describe, it, expect } from "vitest";
import { suggestTrip } from "@/lib/tripSuggest";
import type { CalendarEvent } from "@/lib/types";

const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: Math.random().toString(36).slice(2),
  title: "Event", start: "2026-06-12T09:00:00Z", end: "2026-06-12T10:00:00Z",
  isAllDay: false, ...over,
});

describe("suggestTrip", () => {
  it("suggests a multi-day located event covering today", () => {
    const s = suggestTrip([ev({
      id: "a", title: "Working group", location: "Stuttgart, Germany",
      start: "2026-06-10", end: "2026-06-15", isAllDay: true,
    })], "2026-06-12");
    // all-day end is exclusive → last day is the 14th
    expect(s).toMatchObject({ location: "Stuttgart, Germany", label: "Stuttgart", startDate: "2026-06-10", endDate: "2026-06-14", eventId: "a" });
  });

  it("suggests a single-day event when the title has a travel keyword", () => {
    const s = suggestTrip([ev({ id: "b", title: "TDY in-brief", location: "Tampa, FL", start: "2026-06-12T13:00:00Z", end: "2026-06-12T14:00:00Z" })], "2026-06-12");
    expect(s?.label).toBe("Tampa");
  });

  it("ignores single-day non-keyword events (a normal meeting)", () => {
    expect(suggestTrip([ev({ title: "Staff sync", location: "Pentagon, Arlington VA" })], "2026-06-12")).toBeNull();
  });

  it("ignores virtual locations even on multi-day events", () => {
    expect(suggestTrip([ev({ title: "Conference", location: "Microsoft Teams Meeting", start: "2026-06-10", end: "2026-06-15", isAllDay: true })], "2026-06-12")).toBeNull();
  });

  it("only suggests trips that cover today", () => {
    const future = ev({ title: "Travel", location: "Amman, Jordan", start: "2026-06-20", end: "2026-06-25", isAllDay: true });
    expect(suggestTrip([future], "2026-06-12")).toBeNull();
    expect(suggestTrip([future], "2026-06-22")?.label).toBe("Amman");
  });

  it("picks the earliest-starting qualifying event", () => {
    const s = suggestTrip([
      ev({ id: "late", title: "TDY", location: "Tampa, FL", start: "2026-06-12T15:00:00Z", end: "2026-06-12T16:00:00Z" }),
      ev({ id: "early", title: "TDY", location: "Stuttgart, DE", start: "2026-06-10", end: "2026-06-14", isAllDay: true }),
    ], "2026-06-12");
    expect(s?.eventId).toBe("early");
  });

  it("returns null with no events", () => {
    expect(suggestTrip([], "2026-06-12")).toBeNull();
  });
});
