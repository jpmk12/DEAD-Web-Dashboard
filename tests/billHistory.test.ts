import { describe, it, expect } from "vitest";
import {
  observedCadence, amountCreep, median, MIN_GAPS, MIN_CREEP_SAMPLES, CREEP_PCT,
} from "../lib/billHistory";
import type { BillSample } from "../lib/billHistory";
import type { FamilyBiller } from "../lib/familyProfile";

const biller = (over: Partial<FamilyBiller> = {}): FamilyBiller => ({
  id: "b1", pattern: "xcel.com", label: "Electric — Xcel", cadence: "monthly", autopay: false, ...over,
});

/** Samples every `gap` days, newest last, with optional amounts. */
const series = (gaps: number[], amounts: (number | null)[] = [], id = "b1"): BillSample[] => {
  const out: BillSample[] = [];
  let t = Date.parse("2026-01-05T12:00:00Z");
  for (let i = 0; i <= gaps.length; i++) {
    out.push({ billerId: id, seenISO: new Date(t).toISOString().slice(0, 10), amountCents: amounts[i] ?? null });
    t += (gaps[i] ?? 30) * 86_400_000;
  }
  return out;
};

describe("median", () => {
  it("is the middle value, averaged on an even count", () => {
    expect(median([30, 31, 29])).toBe(30);
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(median([])).toBeNull();
  });
});

describe("observedCadence — learning mode", () => {
  it("says nothing without enough cycles", () => {
    // With three sightings, "quarterly" and "monthly but you missed two" look
    // identical, and a wrong correction would break a silence watch that works.
    expect(observedCadence(biller(), series([30, 31]))).toBeNull();
    expect(MIN_GAPS).toBeGreaterThanOrEqual(3);
  });

  it("names a cadence once there are enough gaps", () => {
    const r = observedCadence(biller(), series([30, 31, 29, 30]))!;
    expect(r.observed).toBe("monthly");
    expect(r.gaps).toBe(4);
    expect(r.disagrees).toBe(false);
  });
});

describe("observedCadence — disagreement", () => {
  it("flags a declared monthly biller that actually writes quarterly", () => {
    // This is the load-bearing case: the declared cadence is what lets the
    // silence watch tell "quarterly" from "stopped".
    const r = observedCadence(biller({ cadence: "monthly" }), series([91, 89, 92, 90]))!;
    expect(r.observed).toBe("quarterly");
    expect(r.disagrees).toBe(true);
    expect(r.reason).toMatch(/you declared monthly/);
  });

  it("never contradicts a declaration of irregular", () => {
    // "Irregular" is a statement that there is no cycle; observing one does not
    // make the user wrong, and the silence watch deliberately skips these.
    const r = observedCadence(biller({ cadence: "irregular" }), series([30, 31, 29, 30]))!;
    expect(r.observed).toBe("monthly");
    expect(r.disagrees).toBe(false);
  });

  it("refuses to name a cadence when the gaps are scattered, even if the median lands in a band", () => {
    // Gaps of 8/12/60/140 days have a median of 36 — inside the monthly band.
    // A median hides dispersion, and naming this "monthly" would produce a
    // confident correction against the declaration and break the silence watch.
    const r = observedCadence(biller(), series([12, 60, 8, 140]))!;
    expect(r.medianGap).toBe(36);
    expect(r.observed).toBeNull();
    expect(r.disagrees).toBe(false);
    expect(r.reason).toMatch(/too scattered/);
  });

  it("still names a cadence when most gaps sit in the band despite one outlier", () => {
    const r = observedCadence(biller(), series([30, 31, 120, 29, 30]))!;
    expect(r.observed).toBe("monthly");
  });

  it("uses the median so one late statement cannot reclassify a biller", () => {
    // A mean over these gaps is ~47 days and would land outside monthly.
    const r = observedCadence(biller(), series([30, 31, 120, 29, 30]))!;
    expect(r.observed).toBe("monthly");
  });

  it("ignores same-day duplicates, which are re-reads not cycles", () => {
    const s = series([30, 31, 29, 30]);
    const r = observedCadence(biller(), [...s, { ...s[2] }])!;
    expect(r.gaps).toBe(4);
  });

  it("only looks at its own biller's samples", () => {
    const mixed = [...series([30, 31, 29, 30]), ...series([91, 89, 92, 90], [], "other")];
    expect(observedCadence(biller(), mixed)!.observed).toBe("monthly");
  });
});

describe("amountCreep", () => {
  const gaps = [30, 30, 30, 30, 30];

  it("says nothing below the sample floor", () => {
    expect(amountCreep(biller(), series([30, 30], [10000, 11000, 12000]))).toBeNull();
    expect(MIN_CREEP_SAMPLES).toBeGreaterThanOrEqual(4);
  });

  it("catches a compounding rise no single step would flag", () => {
    // Four ~6% steps: each is under amountDelta's 15% threshold, so this is
    // invisible today.
    const r = amountCreep(biller(), series(gaps, [10000, 10600, 11240, 11900, 12600, 13400]))!;
    expect(r.risePct).toBeGreaterThan(CREEP_PCT);
    expect(r.increases).toBe(5);
    expect(r.reason).toMatch(/no single step large enough/);
  });

  it("stays quiet on a flat bill", () => {
    expect(amountCreep(biller(), series(gaps, [10000, 10050, 9980, 10020, 10010, 9990]))).toBeNull();
  });

  it("stays quiet on a single jump that then sits flat", () => {
    // That is a jump amountDelta already reports; calling it creep too would
    // double-report the loud case while still missing the quiet one.
    const r = amountCreep(biller(), series(gaps, [10000, 10000, 20000, 20000, 20000, 20000]));
    expect(r).toBeNull();
  });

  it("stays quiet when the total rise is small", () => {
    expect(amountCreep(biller(), series(gaps, [10000, 10200, 10400, 10500, 10600, 10700]))).toBeNull();
  });

  it("ignores an implausible parse rather than letting it poison the trend", () => {
    const r = amountCreep(biller(), series(gaps, [10000, 10600, 999_999_999, 11900, 12600, 13400]))!;
    expect(r.lastCents).toBe(13400);
    expect(r.samples).toBe(5);
  });

  it("ignores null and zero amounts", () => {
    expect(amountCreep(biller(), series(gaps, [null, null, 10000, null, 13000]))).toBeNull();
  });
});
