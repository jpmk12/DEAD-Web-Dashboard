import { describe, it, expect } from "vitest";
import { parseNetflows, trafficRead, TRAFFIC_DOWN, TRAFFIC_COLLAPSED, RECENT_HOURS, MIN_BASELINE_DAYS, NORM_DROP_DOWN, NETFLOWS_NORMALIZATIONS, isNormalizedRange } from "../lib/radarNetflows";

// The host is unreachable from the sandbox; the body follows the published
// reference for /radar/netflows/timeseries (serie_0.timestamps / values as
// strings, meta.normalization). The first production diag (2026-10-27)
// REFUSED PERCENTAGE_CHANGE ("Must have 1 comparison series"), so the read
// is tested under RAW_VALUES (a ratio) and MIN0_MAX (a drop in range units).
const NOW = Date.parse("2026-10-27T12:00:00Z");
const HOUR = 3_600_000;

/** A diurnal week ending at `end`, as a Radar body under `normalization`. */
function body(days: number, end: number, shape: (t: number, h: number) => number, normalization: "RAW_VALUES" | "MIN0_MAX" | "PERCENTAGE_CHANGE" = "RAW_VALUES") {
  const timestamps: string[] = [];
  const raw: number[] = [];
  for (let i = days * 24 - 1; i >= 0; i--) {
    const t = end - i * HOUR;
    raw.push(shape(t, new Date(t).getUTCHours()));
    timestamps.push(new Date(t).toISOString());
  }
  const min = Math.min(...raw), max = Math.max(...raw);
  const values = raw.map((v) => normalization === "MIN0_MAX" ? ((v - min) / (max - min)).toFixed(4) : normalization === "PERCENTAGE_CHANGE" ? ((v / 0.8 - 1) * 100).toFixed(3) : v.toFixed(3));
  return { success: true, result: { meta: { dateRange: [{ startTime: timestamps[0], endTime: timestamps.at(-1) }], aggInterval: "ONE_HOUR", normalization, lastUpdated: timestamps.at(-1) }, serie_0: { timestamps, values } } };
}
const diurnal = (_t: number, h: number) => 1 + 0.5 * Math.sin((h / 24) * 2 * Math.PI);
const dip = (f: number) => (t: number, h: number) => (NOW - t < RECENT_HOURS * HOUR ? f : 1) * diurnal(t, h);

describe("parseNetflows", () => {
  it("reads serie_0 with string values and the normalization, drops malformed pairs, keeps raw values as-is", () => {
    const s = parseNetflows(body(2, NOW, diurnal))!;
    expect(s.timestamps).toHaveLength(48);
    expect(s.normalization).toBe("RAW_VALUES");
    expect(s.aggInterval).toBe("ONE_HOUR");
    expect(s.lastUpdatedMs).toBe(NOW);
    expect(s.values[s.values.length - 1]).toBeCloseTo(diurnal(NOW, 12), 3);
    for (let i = 1; i < s.timestamps.length; i++) expect(s.timestamps[i]).toBeGreaterThan(s.timestamps[i - 1]);
    const bad = parseNetflows({ result: { meta: { normalization: "RAW_VALUES" }, serie_0: { timestamps: ["2026-10-27T00:00:00Z", "junk", "2026-10-27T02:00:00Z", "2026-10-27T03:00:00Z"], values: ["10", "20", "x", "-5"] } } })!;
    expect(bad.timestamps).toHaveLength(1);   // the junk timestamp, the NaN and the negative are gone
    expect(parseNetflows({ result: { meta: {} } })).toBeNull();
    expect(parseNetflows(null)).toBeNull();
  });
  it("converts PERCENTAGE_CHANGE to a relative level and takes a named series when serie_0 is absent", () => {
    const s = parseNetflows(body(2, NOW, diurnal, "PERCENTAGE_CHANGE"))!;
    expect(s.values.every((v) => v >= 0)).toBe(true);
    expect(s.values[s.values.length - 1]).toBeCloseTo(diurnal(NOW, 12) / 0.8, 3);
    const named = parseNetflows({ result: { meta: {}, ua: { timestamps: ["2026-10-27T00:00:00Z"], values: ["0.5"] } } })!;
    expect(named.values).toEqual([0.5]);
    expect(NETFLOWS_NORMALIZATIONS[0]).toBe("RAW_VALUES");
    expect(isNormalizedRange("MIN0_MAX")).toBe(true);
    expect(isNormalizedRange("RAW_VALUES")).toBe(false);
  });
});

describe("trafficRead under RAW_VALUES — hour-matched ratio, median, learning floor, stale guard", () => {
  it("an ordinary week reads normal at ~100%", () => {
    const r = trafficRead(parseNetflows(body(7, NOW, diurnal)), NOW);
    expect(r.state).toBe("normal");
    expect(r.ratio).toBeCloseTo(1, 2);
    expect(r.drop).toBeNull();
    expect(r.baselineDays).toBe(6);
    expect(r.why).toMatch(/^traffic 100% of the same hours on the prior 6 days/);
  });
  it("a drop over the last six hours reads DOWN, a shutdown-class drop reads COLLAPSED — against the same hours, not the daily mean", () => {
    const down = trafficRead(parseNetflows(body(7, NOW, dip(0.45))), NOW);
    expect(down.state).toBe("down");
    expect(down.ratio).toBeCloseTo(0.45, 2);
    expect(down.why).toMatch(/^traffic DOWN — 45% of the same hours/);
    const gone = trafficRead(parseNetflows(body(7, NOW, dip(0.1))), NOW);
    expect(gone.state).toBe("collapsed");
    expect(gone.ratio).toBeCloseTo(0.1, 2);
    expect(trafficRead(parseNetflows(body(7, NOW, dip(TRAFFIC_DOWN + 0.05))), NOW).state).toBe("normal");
    expect(trafficRead(parseNetflows(body(7, NOW, dip(TRAFFIC_COLLAPSED + 0.05))), NOW).state).toBe("down");
  });
  it("the nightly trough is NOT a drop — the same hours are compared", () => {
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
    expect(trafficRead(null, NOW)).toMatchObject({ state: "unknown", ratio: null, drop: null, why: "no traffic series" });
  });
});

describe("trafficRead under MIN0_MAX — a drop in range units, never a ratio (the subtracted minimum would amplify one)", () => {
  it("an ordinary week is normal with no ratio claimed; the trough still reads normal", () => {
    const r = trafficRead(parseNetflows(body(7, NOW, diurnal, "MIN0_MAX")), NOW);
    expect(r.state).toBe("normal");
    expect(r.ratio).toBeNull();
    expect(r.drop).toBeCloseTo(0, 2);
    expect(r.why).toMatch(/^traffic in its usual band/);
    const end = Date.parse("2026-10-27T03:00:00Z");
    expect(trafficRead(parseNetflows(body(7, end, diurnal, "MIN0_MAX")), end + 10 * 60_000).state).toBe("normal");
  });
  it("a modest dip that a ratio would amplify stays NORMAL; a real drop reads DOWN; a drop to the floor reads COLLAPSED", () => {
    // A 20% daytime dip: under MIN0_MAX the normalized RATIO would read ~0.6 (the trap); the drop in range units is small.
    const mild = trafficRead(parseNetflows(body(7, NOW, dip(0.8), "MIN0_MAX")), NOW);
    expect(mild.state).toBe("normal");
    expect(mild.drop!).toBeLessThan(NORM_DROP_DOWN);
    const down = trafficRead(parseNetflows(body(7, NOW, dip(0.5), "MIN0_MAX")), NOW);
    expect(down.state).toBe("down");
    expect(down.why).toMatch(/^traffic DOWN — \d+% of the week's range below .*range units not a ratio$/);
    const gone = trafficRead(parseNetflows(body(7, NOW, dip(0.02), "MIN0_MAX")), NOW);
    expect(gone.state).toBe("collapsed");
    expect(gone.ratio).toBeNull();
  });
});
