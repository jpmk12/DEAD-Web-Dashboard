import { describe, it, expect } from "vitest";
import { countryCentroid } from "@/lib/countryCentroids";

describe("countryCentroid name resolution", () => {
  it("resolves exact names", () => {
    expect(countryCentroid("Iran")).toEqual([32.4, 53.7]);
  });

  it("resolves World Bank / Data360 (INFORM) name forms", () => {
    expect(countryCentroid("Iran, Islamic Rep.")).toEqual([32.4, 53.7]);
    expect(countryCentroid("Egypt, Arab Rep.")).toEqual([26.8, 30.8]);
    expect(countryCentroid("Russian Federation")).toEqual([61.5, 105.3]);
  });

  it("does not collide substrings — Nigeria is not Niger", () => {
    expect(countryCentroid("Nigeria")).toEqual([9.1, 8.7]);
    expect(countryCentroid("Niger")).toEqual([17.6, 8.1]);
  });

  it("disambiguates the Koreas via Data360 names", () => {
    expect(countryCentroid("Korea, Dem. People's Rep.")).toEqual([40.3, 127.5]); // North
    expect(countryCentroid("Korea, Rep.")).toEqual([36.5, 127.8]);              // South
  });

  it("returns null for unknown", () => {
    expect(countryCentroid("Atlantis")).toBeNull();
  });
});
