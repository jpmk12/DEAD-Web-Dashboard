import { describe, it, expect } from "vitest";
import { effectiveCadence, type BillSample } from "../lib/billHistory";
import { silenceWatch } from "../lib/householdSignals";
import { sanitizeFamilyProfile, type FamilyBiller } from "../lib/familyProfile";

const biller = (over: Partial<FamilyBiller> = {}): FamilyBiller => ({
  id: "b1", pattern: "xcel.com", label: "Electric", cadence: "auto", autopay: false, ...over,
});
const series = (gaps: number[]): BillSample[] => {
  const out: BillSample[] = [];
  let t = Date.UTC(2026, 0, 5);
  out.push({ billerId: "b1", seenISO: new Date(t).toISOString().slice(0, 10), amountCents: 100 });
  for (const g of gaps) { t += g * 86_400_000; out.push({ billerId: "b1", seenISO: new Date(t).toISOString().slice(0, 10), amountCents: 100 }); }
  return out;
};

describe("effectiveCadence", () => {
  it("a declared cadence is used as-is", () => {
    const r = effectiveCadence(biller({ cadence: "quarterly" }), series([30, 30, 30]));
    expect(r).toMatchObject({ cadence: "quarterly", source: "declared" });
  });

  it("auto learns the cadence once four sightings agree", () => {
    const r = effectiveCadence(biller(), series([30, 31, 29]));
    expect(r.cadence).toBe("monthly");
    expect(r.source).toBe("observed");
    expect(r.label).toMatch(/observed across 3 cycles/);
  });

  it("auto stays forming below the floor, and the silence watch makes no claim", () => {
    const r = effectiveCadence(biller(), series([30, 31]));
    expect(r).toMatchObject({ cadence: null, source: "forming" });
    expect(r.label).toMatch(/learning/);
    // Resolved as the household assembler does: null → irregular → never accused.
    const resolved = { ...biller(), cadence: r.cadence ?? ("irregular" as const) };
    const farFuture = Date.UTC(2027, 6, 1);
    expect(silenceWatch([resolved], series([30, 31]), farFuture)).toEqual([]);
  });

  it("auto with scattered gaps is forming-irregular, not a guessed monthly", () => {
    const r = effectiveCadence(biller(), series([8, 12, 60, 140]));
    expect(r.cadence).toBeNull();
    expect(r.label).toMatch(/too scattered/);
  });

  it("the sanitizer defaults a missing cadence to auto, never monthly", () => {
    const p = sanitizeFamilyProfile({ billers: [{ pattern: "x.com", label: "X" }, { pattern: "y.com", cadence: "weekly" }] });
    expect(p.billers.map((b) => b.cadence)).toEqual(["auto", "auto"]);
    expect(p.autoDiscover).toBe(true);
    expect(sanitizeFamilyProfile({ autoDiscover: false }).autoDiscover).toBe(false);
  });
});
