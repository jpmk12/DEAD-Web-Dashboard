import { describe, it, expect } from "vitest";
import { lineCall, verifyLines, callLine, readDayFrom, MIN_SCORED_FOR_RATE, type LineReadDay } from "../lib/lineVerify";
import { validateOutcome, validateLineDraft, isLineOutcome } from "../lib/missionLines";

const rd = (lineId: string, leadDays: number, worst: LineReadDay["worst"], kinds: LineReadDay["kinds"] = [], lead: string | null = null): LineReadDay =>
  ({ lineId, observedDay: `2026-11-${String(20 - leadDays).padStart(2, "0")}`, leadDays, worst, kinds, lead });

describe("the outcome door", () => {
  const now = Date.parse("2026-11-26T12:00:00Z");
  it("takes an outcome on or after the day, inside the lookback, and clears with null", () => {
    expect(validateOutcome("2026-11-26", "flew", now)).toBeNull();
    expect(validateOutcome("2026-11-20", "slipped", now)).toBeNull();
    expect(validateOutcome("2026-11-20", null, now)).toBeNull();
    expect(validateOutcome("2026-11-27", "flew", now)).toMatch(/has not come yet/);
    expect(validateOutcome("2026-11-01", "flew", now)).toMatch(/older/);
    expect(validateOutcome("2026-11-25", "diverted", now)).toMatch(/flew, slipped, cancelled/);
    expect(isLineOutcome("cancelled")).toBe(true);
  });
  it("an outcome is never part of a line draft — the validator still refuses it by name", () => {
    expect(validateLineDraft({ day: "2026-11-26", airframe: "C-17", fields: ["OJAQ"], status: "planned", outcome: "flew" })).toMatch(/holds no “outcome”/);
  });
});

describe("a line's call", () => {
  it("flagged when any read before the day was amber or red — the earliest lead and the worst driver", () => {
    const c = lineCall([rd("a", 3, "g"), rd("a", 2, "a", ["taf"], "OJAQ: TAF IFR"), rd("a", 1, "r", ["closure"], "OJAQ: field CLOSED"), rd("a", 0, "a", ["taf"])]);
    expect(c).toMatchObject({ call: "flagged", worst: "r", firstFlaggedLead: 2, lead: "OJAQ: field CLOSED" });
    expect(c.kinds.sort()).toEqual(["closure", "taf"]);
    expect(callLine(c)).toBe("read RED from 2 days ahead — OJAQ: field CLOSED");
  });
  it("quiet, unknown throughout, no read on record, and reads outside the lead window ignored", () => {
    expect(lineCall([rd("b", 2, "g"), rd("b", 1, "u")]).call).toBe("quiet");
    expect(lineCall([rd("b", 2, "u"), rd("b", 0, "u")]).call).toBe("unknown");
    expect(lineCall([]).call).toBe("unread");
    expect(lineCall([rd("b", 6, "r", ["closure"])]).call).toBe("unread");
    expect(callLine(lineCall([]))).toBe("no read on record");
  });
});

describe("verifyLines", () => {
  it("a tally, never a rate, below the floor", () => {
    const v = verifyLines([{ id: "a", day: "2026-11-20", outcome: "slipped" }, { id: "b", day: "2026-11-20", outcome: "flew" }],
      [rd("a", 1, "a", ["closure"]), rd("b", 1, "g")]);
    expect(v.forming).toBe(true);
    expect(v.baseRate).toBeNull();
    expect(v.caught).toBeNull();
    expect(v.flagged).toEqual({ n: 1, bad: 1 });
    expect(v.quiet).toEqual({ n: 1, bad: 0 });
    expect(v.lines.join(" ")).toMatch(/Forming — 2 of 10/);
    expect(v.byKind[0]).toMatchObject({ kind: "closure", n: 1, bad: 1, rate: null });
  });

  it("past the floor: caught, false alarm, base rate, per-kind lift and the median lead", () => {
    const scored = [], reads: LineReadDay[] = [];
    // 6 flagged by a closure: 4 slipped/cancelled, 2 flew. 6 quiet: 1 slipped, 5 flew.
    for (let k = 0; k < 6; k++) { scored.push({ id: `f${k}`, day: "2026-11-20", outcome: (k < 3 ? "slipped" : k < 4 ? "cancelled" : "flew") as "slipped" }); reads.push(rd(`f${k}`, k < 2 ? 2 : 1, "a", ["closure"])); }
    for (let k = 0; k < 6; k++) { scored.push({ id: `q${k}`, day: "2026-11-20", outcome: (k === 0 ? "slipped" : "flew") as "flew" }); reads.push(rd(`q${k}`, 1, "g")); }
    const v = verifyLines(scored, reads);
    expect(12).toBeGreaterThanOrEqual(MIN_SCORED_FOR_RATE);
    expect(v.forming).toBe(false);
    expect(v.baseRate).toBeCloseTo(5 / 12);
    expect(v.caught).toBeCloseTo(4 / 5);
    expect(v.falseAlarm).toBeCloseTo(2 / 6);
    expect(v.medianLeadDays).toBe(1.5);
    const closure = v.byKind.find((k) => k.kind === "closure")!;
    expect(closure).toMatchObject({ n: 6, bad: 4 });
    expect(closure.rate).toBeCloseTo(4 / 6);
    expect(closure.lift).toBeCloseTo((4 / 6) / (5 / 12));
    expect(v.lines.join(" ")).toMatch(/flagged 80 %/);
  });

  it("unread and UNKNOWN lines are counted, never judged", () => {
    const v = verifyLines([{ id: "x", day: "2026-11-20", outcome: "cancelled" }, { id: "y", day: "2026-11-20", outcome: "flew" }], [rd("y", 1, "u")]);
    expect(v).toMatchObject({ scored: 2, unread: 1, unknown: 1, flagged: { n: 0, bad: 0 }, quiet: { n: 0, bad: 0 } });
  });

  it("no outcome yet says how to start", () => {
    expect(verifyLines([], []).lines[0]).toMatch(/No line has an outcome yet/);
  });
});

describe("readDayFrom — what the assembler stores", () => {
  it("the worst, the amber / red kinds (never unknown) and the lead driver; a past line stores nothing", () => {
    const read = { id: "a", day: "2026-11-28", worst: "a" as const, drivers: [
      { icao: "OJAQ", kind: "closure" as const, level: "a" as const, text: "runway closure scheduled" },
      { icao: "OTBH", kind: "unknown" as const, level: "u" as const, text: "no SITREP slot" },
      { icao: "OJAQ", kind: "taf" as const, level: "g" as const, text: "VFR" },
    ] };
    expect(readDayFrom(read, "2026-11-26")).toEqual({ lineId: "a", observedDay: "2026-11-26", leadDays: 2, worst: "a", kinds: ["closure"], lead: "OJAQ: runway closure scheduled" });
    expect(readDayFrom({ ...read, worst: "g", drivers: [] }, "2026-11-26")!.lead).toBeNull();
    expect(readDayFrom(read, "2026-11-29")).toBeNull();
  });
});
