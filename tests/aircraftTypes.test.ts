import { describe, it, expect } from "vitest";
import { isMobilityType } from "@/lib/aircraftTypes";

describe("isMobilityType", () => {
  it("flags strategic + tactical airlift", () => {
    for (const t of ["C17", "C5", "C5M", "C130", "C30J", "A400", "C27J", "IL76", "AN124"]) {
      expect(isMobilityType(t)).toBe(true);
    }
  });
  it("flags tankers", () => {
    for (const t of ["KC135", "K35R", "KC46", "K46", "KC10", "KC130", "KC30"]) {
      expect(isMobilityType(t)).toBe(true);
    }
  });
  it("flags OSA/VIP transports", () => {
    for (const t of ["C40", "C32", "C37", "C21", "VC25"]) {
      expect(isMobilityType(t)).toBe(true);
    }
  });
  it("excludes fighters, ISR/AWACS, bombers, recon, helos, trainers", () => {
    for (const t of ["F16", "F22", "F35", "A10", "E3", "E8", "P8", "RC135", "B52", "B1", "U2", "RQ4", "H60", "T38", "F18"]) {
      expect(isMobilityType(t)).toBe(false);
    }
  });
  it("empty / unknown type → false (no false positive)", () => {
    expect(isMobilityType("")).toBe(false);
    expect(isMobilityType("   ")).toBe(false);
  });
  it("case-insensitive", () => {
    expect(isMobilityType("c17")).toBe(true);
  });
});
