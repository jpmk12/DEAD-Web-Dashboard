import { describe, it, expect } from "vitest";
import { parseIndicatorRows, matchCountryToCode } from "@/lib/whoHealth";

describe("parseIndicatorRows", () => {
  it("keeps the latest year per country and only COUNTRY rows", () => {
    const json = { value: [
      { SpatialDim: "YEM", SpatialDimType: "COUNTRY", TimeDim: 2018, NumericValue: 60 },
      { SpatialDim: "YEM", SpatialDimType: "COUNTRY", TimeDim: 2022, NumericValue: 68 },
      { SpatialDim: "EMR", SpatialDimType: "REGION", TimeDim: 2022, NumericValue: 99 },
      { SpatialDim: "QAT", SpatialDimType: "COUNTRY", TimeDim: 2022, NumericValue: 100 },
    ] };
    const m = parseIndicatorRows(json);
    expect(m.get("YEM")).toEqual({ value: 68, year: "2022" });
    expect(m.get("QAT")!.value).toBe(100);
    expect(m.has("EMR")).toBe(false); // region aggregate dropped
  });

  it("prefers the aggregate disaggregation (TOTL) over rural/urban same year", () => {
    const json = { value: [
      { SpatialDim: "KEN", SpatialDimType: "COUNTRY", TimeDim: 2022, NumericValue: 40, Dim1: "RESIDENCEAREATYPE_RUR" },
      { SpatialDim: "KEN", SpatialDimType: "COUNTRY", TimeDim: 2022, NumericValue: 70, Dim1: "RESIDENCEAREATYPE_TOTL" },
      { SpatialDim: "KEN", SpatialDimType: "COUNTRY", TimeDim: 2022, NumericValue: 90, Dim1: "RESIDENCEAREATYPE_URB" },
    ] };
    expect(parseIndicatorRows(json).get("KEN")!.value).toBe(70);
  });

  it("skips non-finite values and malformed ISO codes", () => {
    const json = { value: [
      { SpatialDim: "XX", SpatialDimType: "COUNTRY", TimeDim: 2022, NumericValue: 50 },
      { SpatialDim: "USA", SpatialDimType: "COUNTRY", TimeDim: 2022, NumericValue: "N/A" },
    ] };
    const m = parseIndicatorRows(json);
    expect(m.size).toBe(0);
  });

  it("returns empty for junk input", () => {
    expect(parseIndicatorRows({}).size).toBe(0);
    expect(parseIndicatorRows(null).size).toBe(0);
  });
});

describe("matchCountryToCode", () => {
  const dim = { value: [
    { Code: "YEM", Title: "Yemen" },
    { Code: "QAT", Title: "Qatar" },
    { Code: "IRN", Title: "Iran (Islamic Republic of)" },
    { Code: "COD", Title: "Democratic Republic of the Congo" },
    { Code: "GLOBAL", Title: "Global" },
  ] };

  it("matches exact names", () => {
    expect(matchCountryToCode(dim, "Yemen")).toBe("YEM");
    expect(matchCountryToCode(dim, "Qatar")).toBe("QAT");
  });

  it("loose-matches formatted WHO titles", () => {
    expect(matchCountryToCode(dim, "Iran")).toBe("IRN");
    expect(matchCountryToCode(dim, "DR Congo")).toBe("COD");
  });

  it("ignores non-3-letter codes and returns null when nothing matches", () => {
    expect(matchCountryToCode(dim, "Atlantis")).toBeNull();
  });
});
