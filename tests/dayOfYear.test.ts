import { describe, it, expect } from "vitest";
import { dayOfYear, julianDayLabel } from "../lib/date";

describe("dayOfYear / julianDayLabel — the schedule's three-digit Julian date", () => {
  it("counts the ordinal day in the given zone, leap years included", () => {
    expect(dayOfYear(new Date("2026-01-01T12:00:00Z"), "UTC")).toBe(1);
    expect(dayOfYear(new Date("2026-10-27T12:00:00Z"), "UTC")).toBe(300);
    expect(dayOfYear(new Date("2026-12-31T12:00:00Z"), "UTC")).toBe(365);
    expect(dayOfYear(new Date("2024-12-31T12:00:00Z"), "UTC")).toBe(366);
    expect(dayOfYear(new Date("2024-03-01T12:00:00Z"), "UTC")).toBe(61);
    expect(julianDayLabel(new Date("2026-01-07T12:00:00Z"), "UTC")).toBe("007");
    expect(julianDayLabel(new Date("2026-10-27T12:00:00Z"), "UTC")).toBe("300");
  });
  it("is the LOCAL calendar day of the zone — one instant can be two Julian dates", () => {
    const t = new Date("2026-10-27T02:30:00Z");                 // 22:30 the night before in New York
    expect(dayOfYear(t, "UTC")).toBe(300);
    expect(dayOfYear(t, "America/New_York")).toBe(299);
    expect(dayOfYear(t, "Asia/Tokyo")).toBe(300);
  });
  it("without a zone it reads the Date's own local calendar day", () => {
    const d = new Date(2026, 9, 27, 12, 0, 0);                  // local noon, 27 Oct
    expect(dayOfYear(d)).toBe(300);
  });
});
