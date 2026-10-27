import { describe, it, expect } from "vitest";
import { parseNetflows, trafficRead, TRAFFIC_DOWN, TRAFFIC_COLLAPSED, RECENT_HOURS, MIN_BASELINE_DAYS } from "../lib/radarNetflows";

// The host is unreachable from the sandbox; the body follows the published
// reference for /radar/netflows/timeseries (serie_0.timestamps / values as
// strings, meta.normalization) with PERCENTAGE_CHANGE values — a percentage
// against one reference constant, so ratios survive the normalisation.
const NOW = Date.parse("2026-10-27T12:00:00Z");
const HOUR = 3_600_000;

/** A diurnal week ending at `end`, as a Radar body. `shape(t, hourOfDay)` → relative level. */
function body(days: number, end: number, shape: (t: number, h: number) => number, ref = 0.8) {
  const timestamps: string[] = [];
  const values: string[] = [];
  for (let i = days * 24 - 1; i >= 0; i--) {
    const t = end - i * HOUR;
    const h = new Date(t).getUTCHours();
    const v = shape(t, h);
    timestamps.push(new Date(t).toISOString());
    values.push(((v / ref - 1) * 100).toFixed(3));   // PERCENTAGE_CHANGE against the constant `ref`
  }
  return { success: true, result: { meta: { dateRange: [{ startTime: timestamps[0], endTime: timestamps.at(-1) }], aggInterval: "ONE_HOUR", normalization: "PERCENTAGE_CHANGE", lastUpdated: timestamps.at(-1) }, serie_0: { timestamps, values } } };
}
const diurnal = (_t: number, h: number) => 1 + 0.5 * Math.sin((h / 24) * 2 * Math.PI);

describe("parseNetflows", () => {
  it("reads serie_0 with string values, converts percentage change to a relative level, drops malformed pairs", () => {
    const s = parseNetflows(body(2, NOW, diurnal))!;
    expect(s.timestamps).toHaveLength(48);
    expect(s.values.every((v) => v >= 0)).toBe(true);
    expect(s.normalization).toBe("PERCENTAGE_CHANGE");
    expect(s.aggInterval).toBe("ONE_HOUR");
    expect(s.lastUpdatedMs).toBe(NOW);
    // Ascending, and the relative level at the reference hour is 1/ref-scaled consistently.
    for (let i = 1; i < s.timestamps.length; i++) expect(s.timestamps[i]).toBeGreaterThan(s.timestamps[i - 1]);
    const bad = parseNetflows({ result: { serie_0: { timestamps: ["2026-10-27T00:00:00Z", "junk", "2026-10-27T02:00:00Z", "2026-10-27T03:00:00Z"], values: ["10", "20", "x", "-250"] } } })!;
    expect(bad.timestamps).toHaveLength(1);   // the junk timestamp, the NaN and the sub-−100 value are gone
    expect(parseNetflows({ result: { meta: {} } })).toBeNull();
    expect(parseNetflows(null)).toBeNull();
  });
  it("takes a named series when serie_0 is absent", () => {
    const s = parseNetflows({ result: { meta: {}, ua: { timestamps: ["2026-10-27T00:00:00Z"], values: ["0"] } } })!;
    expect(s.values).toEqual([1]);
  });
});

describe("trafficRead — hour-matched, median, learning floor, stale guard", () => {
  it("an ordinary week reads normal at ~100%", () => {
    const r = trafficRead(parseNetflows(body(7, NOW, diurnal)), NOW);
    expect(r.state).toBe("normal");
    expect(r.ratio).toBeCloseTo(1, 2);
    expect(r.baselineDays).toBe(6);
    expect(r.recentHours).toBe(RECENT_HOURS);
    expect(r.why).toMatch(/^traffic 100% of the same hours on the prior 6 days/);
  });
  it("a drop over the last six hours reads DOWN, a shutdown-class drop reads COLLAPSED — against the same hours, not the daily mean", () => {
    const dip = (f: number) => (t: number, h: number) => (NOW - t < RECENT_HOURS * HOUR ? f : 1) * diurnal(t, h);
    const down = trafficRead(parseNetflows(body(7, NOW, dip(0.45))), NOW);
    expect(down.state).toBe("down");
    expect(down.ratio).toBeCloseTo(0.45, 2);
    expect(down.why).toMatch(/^traffic DOWN — 45% of the same hours/);
    const gone = trafficRead(parseNetflows(body(7, NOW, dip(0.1))), NOW);
    expect(gone.state).toBe("collapsed");
    expect(gone.ratio).toBeCloseTo(0.1, 2);
    // The thresholds themselves.
    expect(trafficRead(parseNetflows(body(7, NOW, dip(TRAFFIC_DOWN + 0.05))), NOW).state).toBe("normal");
    expect(trafficRead(parseNetflows(body(7, NOW, dip(TRAFFIC_COLLAPSED + 0.05))), NOW).state).toBe("down");
  });
  it("the nightly trough is NOT a drop — the same hours are compared (the MIN0_MAX trap)", () => {
    // Ends at 03:00Z, the trough of the curve: hour-matched the ratio is 1.
    const end = Date.parse("2026-10-27T03:00:00Z");
    const r = trafficRead(parseNetflows(body(7, end, diurnal)), end + 10 * 60_000);
    expect(r.state).toBe("normal");
    expect(r.ratio).toBeCloseTo(1, 2);
  });
  it("fewer than MIN_BASELINE_DAYS matched days is LEARNING, a tally not a ratio", () => {
    const r = trafficRead(parseNetflows(body(2, NOW, diurnal)), NOW);
    expect(r.state).toBe("learning");
    expect(r.ratio).toBeNull();
    expect(r.baselineDays).toBe(1);
    expect(r.why).toBe(`learning — 1 of ${MIN_BASELINE_DAYS} prior days matched for every recent hour`);
  });
  it("a stale series or no series is UNKNOWN, never normal", () => {
    const stale = trafficRead(parseNetflows(body(7, NOW - 6 * HOUR, diurnal)), NOW);
    expect(stale.state).toBe("unknown");
    expect(stale.why).toMatch(/^series stale — last sample 6 h ago/);
    expect(trafficRead(null, NOW)).toMatchObject({ state: "unknown", ratio: null, why: "no traffic series" });
  });
});
