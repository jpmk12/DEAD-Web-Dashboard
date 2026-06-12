import { describe, it, expect } from "vitest";
import { nearestFeedKey, pickActiveTrip, tripProgress, type Trip } from "@/lib/trips";

const trip = (over: Partial<Trip>): Trip => ({
  id: Math.random().toString(36).slice(2),
  label: "Test", location: "Test", lat: 0, lon: 0,
  startDate: "2026-06-10", endDate: "2026-06-14",
  tz: null, feedKey: null, notes: null, createdAt: "",
  ...over,
});

describe("nearestFeedKey", () => {
  it("snaps a nearby location to its base set", () => {
    expect(nearestFeedKey(38.83, -104.82)).toBe("colorado");   // Colorado Springs
    expect(nearestFeedKey(49.44, 7.60)).toBe("germany");       // Ramstein
    expect(nearestFeedKey(35.71, 139.81)).toBe("japan");       // Tokyo ~ Yokota
  });
  it("returns null when nowhere near a curated set", () => {
    expect(nearestFeedKey(25.76, -80.19)).toBeNull();          // Miami
    expect(nearestFeedKey(31.95, 35.93)).toBeNull();           // Amman
  });
});

describe("pickActiveTrip", () => {
  it("returns the trip covering today", () => {
    const t = trip({ id: "a", startDate: "2026-06-10", endDate: "2026-06-14" });
    expect(pickActiveTrip([t], "2026-06-12")?.id).toBe("a");
  });
  it("returns null outside any range (auto-revert to home)", () => {
    const t = trip({ startDate: "2026-06-10", endDate: "2026-06-14" });
    expect(pickActiveTrip([t], "2026-06-20")).toBeNull();
    expect(pickActiveTrip([t], "2026-06-09")).toBeNull();
  });
  it("is inclusive of both endpoints", () => {
    const t = trip({ id: "a", startDate: "2026-06-10", endDate: "2026-06-14" });
    expect(pickActiveTrip([t], "2026-06-10")?.id).toBe("a");
    expect(pickActiveTrip([t], "2026-06-14")?.id).toBe("a");
  });
  it("when trips overlap, the most-recently-started wins", () => {
    const older = trip({ id: "old", startDate: "2026-06-01", endDate: "2026-06-20" });
    const newer = trip({ id: "new", startDate: "2026-06-10", endDate: "2026-06-14" });
    expect(pickActiveTrip([older, newer], "2026-06-12")?.id).toBe("new");
  });
});

describe("tripProgress", () => {
  it("computes 1-based day and inclusive length", () => {
    const t = trip({ startDate: "2026-06-10", endDate: "2026-06-14" });
    expect(tripProgress(t, "2026-06-10")).toEqual({ day: 1, days: 5 });
    expect(tripProgress(t, "2026-06-12")).toEqual({ day: 3, days: 5 });
    expect(tripProgress(t, "2026-06-14")).toEqual({ day: 5, days: 5 });
  });
  it("clamps a same-day trip to day 1 of 1", () => {
    const t = trip({ startDate: "2026-06-12", endDate: "2026-06-12" });
    expect(tripProgress(t, "2026-06-12")).toEqual({ day: 1, days: 1 });
  });
});
