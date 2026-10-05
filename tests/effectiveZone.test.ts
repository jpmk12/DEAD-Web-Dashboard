import { describe, it, expect } from "vitest";
import { resolveZone, zoneLabel, ymdInZone, zoneDayStartMs, zoneDayEndMs, addDays, timeInZone, DEFAULT_ZONE } from "../lib/effectiveZone";

describe("resolveZone", () => {
  it("auto: an active trip's zone beats the device zone", () => {
    expect(resolveZone({ mode: "auto", device: "America/New_York", trip: "Asia/Amman" })).toEqual({ zone: "Asia/Amman", source: "trip" });
  });
  it("auto: device beats the saved pref when there is no trip", () => {
    expect(resolveZone({ mode: "auto", device: "America/New_York", pref: "America/Chicago" })).toEqual({ zone: "America/New_York", source: "device" });
    expect(resolveZone({ mode: "auto", pref: "America/Chicago" })).toEqual({ zone: "America/Chicago", source: "pref" });
    expect(resolveZone({})).toEqual({ zone: DEFAULT_ZONE, source: "default" });
  });
  it("pinned: the pin wins over trip and device; an invalid pin falls to the device", () => {
    expect(resolveZone({ mode: "pinned", pref: "Europe/Berlin", device: "America/New_York", trip: "Asia/Amman" })).toEqual({ zone: "Europe/Berlin", source: "pinned" });
    expect(resolveZone({ mode: "pinned", pref: "Mars/Olympus", device: "America/New_York", trip: "Asia/Amman" })).toEqual({ zone: "America/New_York", source: "device" });
  });
  it("an invalid trip zone is skipped, never thrown", () => {
    expect(resolveZone({ device: "America/New_York", trip: "Nowhere/Land" })).toEqual({ zone: "America/New_York", source: "device" });
  });
});

describe("zone helpers", () => {
  // 2026-10-06T07:00:00Z = 10:00 in Jordan (UTC+3) = 03:00 in New York (EDT).
  const T = Date.UTC(2026, 9, 6, 7, 0, 0);
  it("the same instant reads 10:00 in Amman and 3:00 AM in New York, each with its label", () => {
    expect(timeInZone(T, "Asia/Amman")).toBe("10:00 AM");
    expect(timeInZone(T, "America/New_York")).toBe("3:00 AM");
    expect(zoneLabel("America/New_York", T)).toBe("EDT");
    expect(zoneLabel("UTC", T)).toBe("UTC");
    expect(zoneLabel("Asia/Amman", T)).toMatch(/GMT\+3|EEST/);
  });
  it("calendar date follows the zone", () => {
    const lateNy = Date.UTC(2026, 9, 6, 2, 30); // 22:30 Oct 5 in New York, 05:30 Oct 6 in Amman
    expect(ymdInZone(lateNy, "America/New_York")).toBe("2026-10-05");
    expect(ymdInZone(lateNy, "Asia/Amman")).toBe("2026-10-06");
  });
  it("day bounds are the zone's midnight, and the day end is one ms before the next start", () => {
    const start = zoneDayStartMs("2026-10-06", "America/New_York");
    expect(new Date(start).toISOString()).toBe("2026-10-06T04:00:00.000Z");
    expect(zoneDayEndMs("2026-10-06", "America/New_York")).toBe(zoneDayStartMs("2026-10-07", "America/New_York") - 1);
    expect(new Date(zoneDayStartMs("2026-10-06", "UTC")).toISOString()).toBe("2026-10-06T00:00:00.000Z");
  });
  it("addDays is calendar arithmetic across a month end", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("an invalid zone never throws", () => {
    expect(() => zoneLabel("Mars/Olympus")).not.toThrow();
    expect(timeInZone(T, "Mars/Olympus")).toBe("");
  });
});
