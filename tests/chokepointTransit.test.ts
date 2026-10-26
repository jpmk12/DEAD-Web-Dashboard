import { describe, it, expect } from "vitest";
import { transitSignal, transitBaseline, MIN_OBSERVED_MINUTES, MIN_BASELINE_DAYS } from "../lib/chokepointTransit";

const base = { configured: true, distinctToday: 40, observedMinutesToday: 240, lastHour: 9, baselinePerHour: 10, baselineDays: 8 };

describe("transitSignal — unknown before normal, learning before judged", () => {
  it("is unconfigured without the key", () => {
    expect(transitSignal({ ...base, configured: false }).state).toBe("unconfigured");
  });

  it("refuses to judge from a short listen — low count is not low traffic", () => {
    const r = transitSignal({ ...base, distinctToday: 1, observedMinutesToday: MIN_OBSERVED_MINUTES - 1 });
    expect(r.state).toBe("unknown");
    expect(r.ratio).toBeNull();
  });

  it("is learning until the baseline has enough observed days", () => {
    const r = transitSignal({ ...base, baselineDays: MIN_BASELINE_DAYS - 1 });
    expect(r.state).toBe("learning");
    expect(r.perHourToday).toBe(10);
    expect(r.line).toMatch(/baseline forming/);
  });

  it("compares per-observed-hour rates, so a partial day is not read as a drop", () => {
    // 40 vessels in 4 h = 10/h, baseline 10/h → normal, not "40 vs 240 a day".
    expect(transitSignal(base).state).toBe("normal");
    expect(transitSignal(base).ratio).toBe(1);
  });

  it("flags suppression and elevation against the chokepoint's own normal", () => {
    expect(transitSignal({ ...base, distinctToday: 20 }).state).toBe("suppressed");   // 5/h vs 10
    expect(transitSignal({ ...base, distinctToday: 80 }).state).toBe("elevated");     // 20/h vs 10
    expect(transitSignal({ ...base, distinctToday: 20 }).line).toMatch(/SUPPRESSED/);
  });
});

describe("transitSignal — zero is a dead feed, not an empty strait (2026-10-26 China tile)", () => {
  it("0 vessels where the normal says several were expected reads UNKNOWN, never suppressed", () => {
    // 10/h normal × 4 h listened = 40 expected; none seen → the feed, not the strait.
    const r = transitSignal({ ...base, distinctToday: 0, lastHour: 0 });
    expect(r.state).toBe("unknown");
    expect(r.ratio).toBeNull();
    expect(r.line).toMatch(/dead feed|silent/i);
    expect(r.line).not.toMatch(/SUPPRESSED/);
  });
  it("0 vessels in a short listen against a thin normal is still judged (too few expected to call the feed dead)", () => {
    // 1/h normal × 1 h = 1 expected; 0 seen is ordinary variance → suppressed by the ratio rule.
    const r = transitSignal({ ...base, distinctToday: 0, lastHour: 0, observedMinutesToday: 60, baselinePerHour: 1 });
    expect(r.state).toBe("suppressed");
  });
  it("a silent feed (no box saw a vessel) reads UNKNOWN even with a count from earlier today", () => {
    const r = transitSignal({ ...base, feedSilent: true });
    expect(r.state).toBe("unknown");
    expect(r.line).toMatch(/AIS silent/);
  });
  it("0 vessels while still learning is learning, not a verdict", () => {
    expect(transitSignal({ ...base, distinctToday: 0, baselinePerHour: null, baselineDays: 0 }).state).toBe("learning");
  });
});

describe("transitBaseline", () => {
  it("excludes thin-coverage days from the denominator", () => {
    const b = transitBaseline([
      { distinct: 240, observedMinutes: 1440 },   // 10/h
      { distinct: 3, observedMinutes: 20 },       // unobserved, not quiet
      { distinct: 120, observedMinutes: 720 },    // 10/h
    ]);
    expect(b.days).toBe(2);
    expect(b.perHour).toBe(10);
  });

  it("is null with no qualifying days", () => {
    expect(transitBaseline([{ distinct: 5, observedMinutes: 10 }])).toEqual({ perHour: null, days: 0 });
  });
});
