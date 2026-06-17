import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseAdvisoryDetail, advisorySlug } from "@/lib/stateAdvisoryDetail";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "fixtures/state/saudi-advisory.html"), "utf8");

describe("advisorySlug", () => {
  it("slugifies plain names to State's hyphenated scheme", () => {
    expect(advisorySlug("Saudi Arabia")).toBe("saudi-arabia");
    expect(advisorySlug("United Kingdom")).toBe("united-kingdom");
  });
  it("applies overrides for irregular destination slugs", () => {
    expect(advisorySlug("Myanmar")).toBe("burma");
    expect(advisorySlug("South Korea")).toBe("south-korea");
    expect(advisorySlug("DR Congo")).toBe("democratic-republic-of-the-congo");
  });
  it("strips diacritics and punctuation", () => {
    expect(advisorySlug("Côte d'Ivoire")).toBe("cote-d-ivoire");
  });
});

describe("parseAdvisoryDetail (Saudi Arabia fixture)", () => {
  const d = parseAdvisoryDetail(html, "Saudi Arabia", "https://example/saudi-arabia.html")!;

  it("returns a detail object", () => {
    expect(d).not.toBeNull();
    expect(d.country).toBe("Saudi Arabia");
  });

  it("reads the overall advisory level", () => {
    expect(d.level).toBe(3);
  });

  it("reads the worst sub-area level (risk bubble)", () => {
    expect(d.worstAreaLevel).toBe(4);
  });

  it("extracts the risk-indicator pills verbatim", () => {
    expect(d.indicators).toEqual(["Terrorism (T)", "Other (O)"]);
  });

  it("composes the guidance line (action + inline reason)", () => {
    expect(d.guidance).toMatch(/Reconsider travel/i);
    expect(d.guidance).toMatch(/Saudi Arabia/);
    expect(d.guidance).toMatch(/terrorism/i);
  });

  it("captures the advisory summary prose", () => {
    expect(d.summary).toMatch(/non-emergency U\.S\. government employees/i);
  });

  it("captures per-region risk areas with their level", () => {
    expect(d.riskAreas.length).toBeGreaterThanOrEqual(1);
    const yemen = d.riskAreas.find((a) => /Yemen border/i.test(a.name));
    expect(yemen).toBeTruthy();
    expect(yemen!.level).toBe(4);
    expect(yemen!.summary).toMatch(/Terrorism|drones|missiles/i);
  });

  it("reads the issued and last-updated dates", () => {
    expect(d.dateIssued).toBe("March 13, 2026");
    expect(d.lastUpdated).toBe("May 21, 2026");
  });
});

describe("parseAdvisoryDetail fail-safe", () => {
  it("returns null when the advisory component is absent", () => {
    expect(parseAdvisoryDetail("<html><body>redesigned</body></html>", "Nowhere", "x")).toBeNull();
  });
  it("returns null on a component shell with no level/indicators/areas", () => {
    expect(parseAdvisoryDetail('<div class="cmp-traveladvisory"></div>', "Nowhere", "x")).toBeNull();
  });
});
