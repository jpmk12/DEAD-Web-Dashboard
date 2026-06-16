import { describe, it, expect } from "vitest";
import { civilCalendarEvents } from "@/lib/civilCalendar";

describe("civilCalendarEvents", () => {
  it("flags an active Ramadan window for a Muslim-majority country", () => {
    const ev = civilCalendarEvents("Qatar", Date.UTC(2026, 2, 1)); // 2026-03-01
    const ram = ev.find((e) => e.label.startsWith("Ramadan"));
    expect(ram?.active).toBe(true);
  });

  it("does NOT apply Islamic observances to a non-Muslim-majority country", () => {
    const ev = civilCalendarEvents("Germany", Date.UTC(2026, 2, 1));
    expect(ev.some((e) => e.kind === "observance")).toBe(false);
  });

  it("surfaces an upcoming national day within the lookahead", () => {
    const ev = civilCalendarEvents("Qatar", Date.UTC(2026, 11, 8)); // ~10d before 12-18
    const nd = ev.find((e) => e.kind === "national_day");
    expect(nd).toBeTruthy();
    expect(nd!.daysUntil).toBeGreaterThan(0);
    expect(nd!.daysUntil).toBeLessThanOrEqual(21);
  });

  it("quiet period for a country with nothing near → []", () => {
    // Germany in mid-June: Unity Day (Oct) is well outside the 21-day window.
    expect(civilCalendarEvents("Germany", Date.UTC(2026, 5, 16))).toEqual([]);
  });

  it("loose country matching (full official name)", () => {
    const ev = civilCalendarEvents("Islamic Republic of Iran", Date.UTC(2026, 2, 1));
    expect(ev.some((e) => e.kind === "observance")).toBe(true);
  });
});
