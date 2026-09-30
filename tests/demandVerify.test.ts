import { describe, it, expect } from "vitest";
import {
  observedDirection, scoreOutlook, demandSkill,
  MIN_MOBILITY_AFTER_DAYS, MIN_POSTURE_DAYS, MIN_SCORED_FOR_SKILL, type ObservedWindow, type ScoredOutlook,
} from "../lib/demandVerify";
import { tafVerification, catOrdinal, TAF_MIN_PAIRED } from "../lib/tafVerify";

const win = (o: Partial<ObservedWindow>): ObservedWindow => ({
  mobilityBefore: 10, mobilityBeforeDays: 10, mobilityAfter: 10, mobilityAfterDays: 7,
  postureUps: 0, postureDowns: 0, postureObservedDays: 7, ...o,
});
const fc = (day: string, direction: "rise" | "hold" | "fall", drivers: { source: "iw" | "disaster" | "neo" | "posture" | "chokepoint"; delta: number }[] = []) =>
  ({ day, aor: "CENTCOM", direction, drivers: drivers.map((d) => ({ ...d, text: "" })) });

describe("demandVerify — observed direction from lift and posture", () => {
  it("lift rising by the ratio reads RISE; falling reads FALL; else HOLD", () => {
    expect(observedDirection(win({ mobilityAfter: 13 })).direction).toBe("rise");
    expect(observedDirection(win({ mobilityAfter: 7 })).direction).toBe("fall");
    expect(observedDirection(win({ mobilityAfter: 11 })).direction).toBe("hold");
  });
  it("is UNKNOWN when both proxies are thin — never a wrong call from a dead feed", () => {
    const r = observedDirection(win({ mobilityAfterDays: MIN_MOBILITY_AFTER_DAYS - 1, postureObservedDays: MIN_POSTURE_DAYS - 1 }));
    expect(r.direction).toBe("unknown");
    expect(r.why).toMatch(/unobserved/);
  });
  it("posture alone decides when lift is unobserved; lift wins when they disagree", () => {
    expect(observedDirection(win({ mobilityAfterDays: 0, mobilityAfter: null, postureUps: 2 })).direction).toBe("rise");
    expect(observedDirection(win({ mobilityAfter: 7, postureUps: 2 })).direction).toBe("fall");
    expect(observedDirection(win({ mobilityAfter: 10, postureUps: 1 })).direction).toBe("rise"); // lift held, posture moved
  });
});

describe("demandVerify — scoring and skill", () => {
  it("scores right / wrong / ambiguous", () => {
    expect(scoreOutlook(fc("2026-09-01", "rise"), win({ mobilityAfter: 14 })).outcome).toBe("right");
    expect(scoreOutlook(fc("2026-09-01", "fall"), win({ mobilityAfter: 14 })).outcome).toBe("wrong");
    expect(scoreOutlook(fc("2026-09-01", "hold"), win({ mobilityAfterDays: 0, mobilityAfter: null, postureObservedDays: 0 })).outcome).toBe("ambiguous");
  });
  it("is a tally below the floor, a rate above it, and ambiguous is reported not counted", () => {
    const rows: ScoredOutlook[] = [
      scoreOutlook(fc("2026-09-01", "rise", [{ source: "iw", delta: 30 }]), win({ mobilityAfter: 14 })),
      scoreOutlook(fc("2026-09-02", "rise", [{ source: "disaster", delta: 20 }]), win({ mobilityAfter: 9 })),
      scoreOutlook(fc("2026-09-03", "hold"), win({ mobilityAfterDays: 0, mobilityAfter: null, postureObservedDays: 0 })),
    ];
    const s = demandSkill(rows);
    expect(s.scored).toBe(3);
    expect(s.ambiguous).toBe(1);
    expect(s.overall.rate).toBeNull();
    expect(s.line).toMatch(/1 of 2 so far/);
    expect(MIN_SCORED_FOR_SKILL).toBe(5);
  });
  it("credits drivers only on RISE/FALL calls and reports per-source rates", () => {
    const rows: ScoredOutlook[] = [];
    for (let i = 1; i <= 5; i++) rows.push(scoreOutlook(fc(`2026-09-0${i}`, "rise", [{ source: "iw", delta: 30 }, { source: "neo", delta: 3 }]), win({ mobilityAfter: i <= 4 ? 14 : 9 })));
    for (let i = 6; i <= 9; i++) rows.push(scoreOutlook(fc(`2026-09-0${i}`, "hold", [{ source: "posture", delta: 10 }]), win({})));
    const s = demandSkill(rows);
    expect(s.overall.rate).toBeCloseTo(8 / 9);
    expect(s.byDirection.rise.label).toBe("80% (4 of 5)");
    expect(s.byDirection.hold.rate).toBeNull();          // 4 < floor
    const iw = s.bySource.find((x) => x.source === "iw")!;
    expect(iw.scored).toBe(5);
    expect(iw.verdict.rate).toBeCloseTo(0.8);
    expect(s.bySource.find((x) => x.source === "neo")).toBeUndefined();      // below MATERIAL
    expect(s.bySource.find((x) => x.source === "posture")).toBeUndefined();  // only on HOLD calls
    expect(s.line).toMatch(/RISE\/FALL calls 4 of 5/);
  });
});

describe("tafVerify — day-worst forecast vs day-worst observed", () => {
  const d = (i: number) => `2026-09-${String(i).padStart(2, "0")}`;
  it("maps categories to ordinals and refuses UNKNOWN", () => {
    expect(catOrdinal("VFR")).toBe(0);
    expect(catOrdinal("LIFR")).toBe(3);
    expect(catOrdinal("UNKNOWN")).toBeNull();
    expect(catOrdinal(null)).toBeNull();
  });
  it("is a tally below TAF_MIN_PAIRED paired days", () => {
    const fcS = [1, 2, 3].map((i) => ({ day: d(i), value: 0 }));
    const tafS = [1, 2, 3, 4].map((i) => ({ day: d(i), value: 1 }));
    const r = tafVerification(fcS, tafS);
    expect(r.paired).toBe(3);
    expect(r.underRate).toBeNull();
    expect(r.warn).toBe(false);
    expect(r.label).toBe(`TAF vs observed: 3 of ${TAF_MIN_PAIRED} days paired so far`);
  });
  it("buckets hit / over / under and warns on the under-forecast rate", () => {
    const fcS: { day: string; value: number }[] = [], tafS: { day: string; value: number }[] = [];
    for (let i = 1; i <= 10; i++) {
      tafS.push({ day: d(i), value: 1 });
      fcS.push({ day: d(i), value: i <= 6 ? 1 : i <= 7 ? 0 : 2 });   // 6 hits, 1 over, 3 under
    }
    const r = tafVerification(fcS, tafS);
    expect(r).toMatchObject({ paired: 10, hit: 6, over: 1, under: 3, warn: true });
    expect(r.underRate).toBeCloseTo(0.3);
    expect(r.label).toMatch(/under-forecasts here/);
  });
});
