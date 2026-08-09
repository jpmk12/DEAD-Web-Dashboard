import { describe, it, expect } from "vitest";
import { problemFromSeed, CENTCOM_GEO, type WarningProblemSeed } from "@/lib/warningTaxonomy";

const IRAN_SEED: WarningProblemSeed = {
  id: "mp-iran-hormuz", name: "Iran & Hormuz", aor: "CENTCOM",
  countries: ["Iran", "Iraq", "Qatar", "Bahrain"], chokepointId: "hormuz",
};

describe("problemFromSeed", () => {
  it("instantiates a six-indicator problem with the AOI id and label", () => {
    const { def } = problemFromSeed(IRAN_SEED);
    expect(def.id).toBe("mp-iran-hormuz");
    expect(def.label).toBe("CENTCOM · Iran & Hormuz");
    expect(def.indicators).toHaveLength(6);
    expect(def.indicators.map((i) => i.id)).toContain("chokepoint_interdiction");
    expect(def.indicators.every((i) => i.warningProblem === "mp-iran-hormuz")).toBe(true);
    expect(def.thresholds).toEqual({ watch: 0.15, warning: 0.35, alert: 0.6 });
  });

  it("omits the chokepoint indicator when the AOI has none", () => {
    const { def, geo } = problemFromSeed({ ...IRAN_SEED, id: "mp-x", chokepointId: null });
    expect(def.indicators).toHaveLength(5);
    expect(def.indicators.some((i) => i.id === "chokepoint_interdiction")).toBe(false);
    expect(geo.chokepoint).toBeNull();
  });

  it("derives a geo that covers the AOI countries", () => {
    const { geo } = problemFromSeed(IRAN_SEED);
    // Tehran ~35.7N 51.4E must be inside the padded bbox.
    expect(geo.bbox.latMin).toBeLessThan(35.7);
    expect(geo.bbox.latMax).toBeGreaterThan(35.7);
    expect(geo.bbox.lonMin).toBeLessThan(51.4);
    expect(geo.bbox.lonMax).toBeGreaterThan(51.4);
    expect(geo.countries).toEqual(IRAN_SEED.countries);
    expect(geo.hubs.length).toBeGreaterThan(0);      // Gulf hubs exist in the bbox
    expect(geo.firs.length).toBeGreaterThan(0);      // Iran/Iraq FIRs are mapped
    expect(geo.conflictIndicatorId).toBe("conflict_intensity");
  });

  it("mention-gate matches AOI countries and chokepoint terms, not others", () => {
    const { geo } = problemFromSeed(IRAN_SEED);
    expect(geo.terms.test("Strikes reported near Tehran, Iran")).toBe(true);
    expect(geo.terms.test("Tanker seized in the Strait of Hormuz")).toBe(true);
    expect(geo.terms.test("Flooding in Bolivia")).toBe(false);
  });

  it("chokepoint geo carries the interdiction scan terms", () => {
    const { geo } = problemFromSeed(IRAN_SEED);
    expect(geo.chokepoint).toMatchObject({ indicatorId: "chokepoint_interdiction", name: "Strait of Hormuz" });
    expect(geo.chokepoint!.terms).toContain("hormuz");
  });

  it("CENTCOM_GEO keeps the legacy indicator ids so history is continuous", () => {
    expect(CENTCOM_GEO.conflictIndicatorId).toBe("conflict_intensity_gulf");
    expect(CENTCOM_GEO.chokepoint?.indicatorId).toBe("hormuz_interdiction_signal");
  });
});
