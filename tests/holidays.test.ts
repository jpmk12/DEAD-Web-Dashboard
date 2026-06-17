import { describe, it, expect } from "vitest";
import { upcomingHolidays, countryIso2, type Holiday } from "@/lib/holidays";

const NOW = Date.parse("2026-06-17T12:00:00Z");
const H = (date: string, name: string, localName = name): Holiday => ({ date, name, localName, global: true });

describe("upcomingHolidays", () => {
  const list: Holiday[] = [
    H("2026-06-10", "Past Holiday"),               // before now → dropped
    H("2026-06-17", "Today Holiday"),              // active
    H("2026-06-25", "Soon Holiday"),               // within window
    H("2026-07-14", "Edge Holiday"),               // 27 days out → within 30
    H("2026-09-01", "Far Holiday"),                // beyond 30 days → dropped
  ];

  it("keeps only holidays within the lookahead window, soonest first", () => {
    const up = upcomingHolidays(list, NOW, 30);
    expect(up.map((h) => h.label)).toEqual(["Today Holiday", "Soon Holiday", "Edge Holiday"]);
  });

  it("flags today's holiday active with daysUntil 0", () => {
    const today = upcomingHolidays(list, NOW, 30).find((h) => h.label === "Today Holiday")!;
    expect(today.active).toBe(true);
    expect(today.daysUntil).toBe(0);
  });

  it("computes daysUntil correctly", () => {
    const soon = upcomingHolidays(list, NOW, 30).find((h) => h.label === "Soon Holiday")!;
    expect(soon.daysUntil).toBe(8);
    expect(soon.active).toBe(false);
  });

  it("respects a shorter window", () => {
    const up = upcomingHolidays(list, NOW, 10);
    expect(up.map((h) => h.label)).toEqual(["Today Holiday", "Soon Holiday"]);
  });

  it("labels with localName when it differs from the English name", () => {
    const up = upcomingHolidays([H("2026-06-20", "National Day", "Fête Nationale")], NOW, 30);
    expect(up[0].label).toBe("National Day (Fête Nationale)");
  });

  it("ignores invalid dates and caps at 6", () => {
    const many = Array.from({ length: 10 }, (_, i) => H(`2026-06-${18 + i}`, `H${i}`));
    many.push(H("not-a-date", "Bad"));
    const up = upcomingHolidays(many, NOW, 30);
    expect(up.length).toBe(6);
    expect(up.some((h) => h.label === "Bad")).toBe(false);
  });
});

describe("countryIso2", () => {
  it("maps known countries (case-insensitive)", () => {
    expect(countryIso2("Syria")).toBe("SY");
    expect(countryIso2("iraq")).toBe("IQ");
    expect(countryIso2("UNITED ARAB EMIRATES")).toBe("AE");
    expect(countryIso2("uae")).toBe("AE");
  });

  it("handles loose names (the/republic of …)", () => {
    expect(countryIso2("Republic of Iraq")).toBe("IQ");
  });

  it("returns null for unmapped countries", () => {
    expect(countryIso2("Narnia")).toBeNull();
    expect(countryIso2("")).toBeNull();
  });
});
