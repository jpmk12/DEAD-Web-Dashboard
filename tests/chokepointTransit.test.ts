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
