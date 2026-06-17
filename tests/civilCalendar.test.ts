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

  it("surfaces a country-specific historical anniversary within the lookahead", () => {
    // Soleimani strike anniversary is 01-03; from Jan 1 it's ~2 days out.
    const ev = civilCalendarEvents("Iran", Date.UTC(2026, 0, 1));
    const ann = ev.find((e) => e.kind === "anniversary");
    expect(ann?.label).toMatch(/Soleimani/);
  });

  it("applies a globally-symbolic anniversary (9/11) to any watched country", () => {
    // Germany has no observance and Unity Day is >21d out; only the global 9/11
    // anniversary should fall in the window (~10d before 09-11).
    const ev = civilCalendarEvents("Germany", Date.UTC(2026, 8, 1));
    expect(ev.some((e) => e.kind === "anniversary" && /9\/11/.test(e.label))).toBe(true);
  });
});
