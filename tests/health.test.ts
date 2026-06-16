import { describe, it, expect } from "vitest";
import { parseHealthTitle, parseHealthFeed } from "@/lib/health";

const NOW = Date.UTC(2026, 5, 16);

describe("parseHealthTitle", () => {
  it("splits 'Disease – Country' on the dash", () => {
    expect(parseHealthTitle("Cholera – Islamic Republic of Afghanistan")).toEqual({ disease: "Cholera", country: "Islamic Republic of Afghanistan" });
  });
  it("handles hyphen and trailing place", () => {
    expect(parseHealthTitle("Marburg virus disease - Tanzania")).toEqual({ disease: "Marburg virus disease", country: "Tanzania" });
  });
});

describe("parseHealthFeed", () => {
  it("keeps recent country-tagged items, drops country-less and stale ones", () => {
    const items = [
      { title: "Mpox – Nigeria", link: "x", isoDate: "2026-06-01T00:00:00Z" },
      { title: "Mpox – Multi-country outbreak", link: "y", isoDate: "2026-06-01T00:00:00Z" }, // 'Multi-country outbreak' parses as a country string — kept (best-effort)
      { title: "Cholera – Somalia", link: "z", isoDate: "2024-01-01T00:00:00Z" }, // stale → dropped
      { title: "No country here", link: "w", isoDate: "2026-06-01T00:00:00Z" }, // no dash → no country → dropped
    ];
    const out = parseHealthFeed(items, NOW);
    expect(out.find((e) => e.country === "Nigeria")).toBeTruthy();
    expect(out.some((e) => e.country === "Somalia")).toBe(false); // stale
    expect(out.some((e) => e.title === "No country here")).toBe(false); // unparseable
  });
});
