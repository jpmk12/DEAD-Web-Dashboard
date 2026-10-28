import { describe, it, expect } from "vitest";
import { notamSubject, isTaxiwayNotam } from "../lib/notamSubject";
import { labelForCategory, categoryForLabel } from "../lib/familyLabels";

describe("notamSubject — a NOTAM is about the asset it names first", () => {
  it("a taxiway closure that places itself by a runway is a taxiway NOTAM", () => {
    expect(notamSubject("TWY A CLSD BTN TWY B AND ILS HOLD LINE RWY 24")).toBe("taxiway");
    expect(isTaxiwayNotam("TWY A CLSD BTN TWY B AND ILS HOLD LINE RWY 24")).toBe(true);
  });
  it("runway, navaid and airfield subjects", () => {
    expect(notamSubject("RWY 06/24 CLSD")).toBe("runway");
    expect(notamSubject("ILS RWY 24 U/S")).toBe("navaid");
    expect(notamSubject("AD CLSD")).toBe("airfield");
  });
  it("a taxiway lettered AD is not the aerodrome", () => {
    expect(notamSubject("TWY AD CLSD")).toBe("taxiway");
  });
  it("text naming no asset has no subject", () => {
    expect(notamSubject("BIRD ACTIVITY IN VICINITY")).toBeNull();
  });
});

describe("familyLabels — one name per bucket, both directions", () => {
  it("round-trips a category through its label, case-insensitively", () => {
    const name = labelForCategory("school");
    expect(name).toBe("Family/School");
    expect(categoryForLabel("family/school")).toBe("school");
    expect(categoryForLabel("Receipts")).toBeNull();
  });
});
