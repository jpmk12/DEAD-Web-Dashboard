import { describe, it, expect } from "vitest";
import { baseTempo, TEMPO_MIN_POINTS, CROSSWIND_DAY_KT } from "../lib/baseTempo";
import { crewTrend, CREW_TREND_MIN_DAYS } from "../lib/crewTrend";
import { timeToResolve, functionChronicity, RESOLVE_MIN_N } from "../lib/limfacTrend";

const TODAY = "2026-09-30";
const d = (back: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
const pts = (vals: number[], startBack = vals.length - 1) => vals.map((v, i) => ({ day: d(startBack - i), value: v }));

describe("baseTempo — the series read along", () => {
  it("says nothing below TEMPO_MIN_POINTS per part", () => {
    const t = baseTempo({ fc: pts([2, 2, 2]), notam: pts([5, 6, 7]), rwyclose: pts([1, 1, 1]), xwind: pts([25, 25, 25]) }, TODAY);
    expect(TEMPO_MIN_POINTS).toBe(4);
    expect(t.ifrThisMonth).toBeNull();
    expect(t.rwyClosed).toBeNull();
    expect(t.crosswind).toBeNull();
    expect(t.lines).toEqual([]);
  });
  it("IFR days this month vs last, of observed days", () => {
    const fc = [...pts([2, 0, 2, 0, 0, 3], 45), ...pts([0, 0, 2, 0, 0, 0, 0, 0], 10)];   // 3/6 last month, 1/8 this month
    const t = baseTempo({ fc, notam: [], rwyclose: [], xwind: [] }, TODAY);
    expect(t.ifrThisMonth).toEqual({ hits: 1, observed: 8 });
    expect(t.ifrLastMonth).toEqual({ hits: 3, observed: 6 });
    expect(t.lines[0]).toBe("IFR 1 of 8 obs days (30 d) vs 3 of 6 the month before");
  });
  it("NOTAM direction, closure share and crosswind days", () => {
    const t = baseTempo({
      fc: [],
      notam: pts([4, 6, 9, 12, 15, 18]),
      rwyclose: pts([0, 1, 0, 1, 1, 0]),
      xwind: pts([5, 22, 8, 31, 12, 4]),
    }, TODAY);
    expect(t.notamDirection).toBe("rising");
    expect(t.notamNow).toBe(18);
    expect(t.rwyClosed).toEqual({ hits: 3, observed: 6 });
    expect(t.crosswind).toEqual({ hits: 2, observed: 6 });
    expect(t.lines).toEqual([
      "NOTAM count rising (6 obs days)",
      "RWY closure window 3 of 6 obs days (30 d)",
      `crosswind ≥${CROSSWIND_DAY_KT} kt 2 of 6 obs days`,
    ]);
  });
});

describe("crewTrend — availability along the series", () => {
  const row = (back: number, total: number, out: number) => ({ day: d(back), qual: "AC", total, crewRest: out, onMission: 0, dnif: 0, other: 0 });
  it("forms at CREW_TREND_MIN_DAYS observed days", () => {
    const t = crewTrend([row(2, 8, 2), row(1, 8, 2), row(0, 8, 2)], [], TODAY);
    expect(CREW_TREND_MIN_DAYS).toBe(4);
    expect(t.direction).toBeNull();
    expect(t.line).toMatch(/3 observed days/);
  });
  it("reads direction, a thin run and the join to rising demand", () => {
    const rows = [row(5, 8, 1), row(4, 8, 2), row(3, 8, 4), row(2, 8, 5), row(1, 8, 6), row(0, 8, 6)];
    const demand = [{ day: d(1), aor: "CENTCOM", direction: "rise" as const }, { day: d(0), aor: "CENTCOM", direction: "rise" as const }, { day: d(4), aor: "CENTCOM", direction: "hold" as const }];
    const t = crewTrend(rows, demand, TODAY);
    expect(t.series.length).toBe(6);
    expect(t.direction).toBe("falling");
    expect(t.thinRun).toBe(3);           // 3/8, 2/8, 2/8 — 4/8 is exactly THIN_BELOW and still sufficient
    expect(t.mismatch).toEqual({ hits: 2, observed: 3 });
    expect(t.line).toContain("availability 2 of 8, falling over the last fortnight");
    expect(t.line).toContain("thin/critical 3 observed days running");
    expect(t.line).toContain("demand rose against thin crews 2 of 3 obs days (30 d)");
  });
  it("an invalid row (outs exceed total) reads as zero available, never negative", () => {
    const t = crewTrend([row(3, 4, 6), row(2, 4, 6), row(1, 4, 6), row(0, 4, 6)], [], TODAY);
    expect(t.series.every((p) => p.available === 0)).toBe(true);
  });
});

describe("limfacTrend — recurrence and time-to-resolve", () => {
  it("functionChronicity reads the 1/0 series like posture", () => {
    const series = pts([1, 1, 1, 1, 0, 1, 1], 6);
    const c = functionChronicity(series, true, TODAY);
    expect(c.state).toBe("chronic");
    expect(c.label).toMatch(/6 of last 7 observed days/);
  });
  it("timeToResolve needs RESOLVE_MIN_N resolved per function and reports the median", () => {
    const iso = (day: string) => `${day}T12:00:00.000Z`;
    const rows = [
      { fn: "fuel", status: "resolved", createdAt: iso(d(10)), updatedAt: iso(d(8)) },   // 2 d
      { fn: "fuel", status: "resolved", createdAt: iso(d(20)), updatedAt: iso(d(15)) },  // 5 d
      { fn: "fuel", status: "resolved", createdAt: iso(d(30)), updatedAt: iso(d(27)) },  // 3 d
      { fn: "fuel", status: "ongoing", createdAt: iso(d(1)), updatedAt: iso(d(0)) },     // not resolved
      { fn: "arff", status: "resolved", createdAt: iso(d(9)), updatedAt: iso(d(2)) },
    ];
    const r = timeToResolve(rows);
    expect(RESOLVE_MIN_N).toBe(3);
    const fuel = r.find((x) => x.fn === "fuel")!;
    expect(fuel.n).toBe(3);
    expect(fuel.medianDays).toBe(3);
    expect(fuel.label).toBe("resolves in ~3 d here (median of 3)");
    const arff = r.find((x) => x.fn === "arff")!;
    expect(arff.medianDays).toBeNull();
    expect(arff.label).toMatch(/1 resolved — 3 needed/);
  });
});
