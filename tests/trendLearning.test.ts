import { describe, it, expect } from "vitest";
import { kevCadence, scaleShare, spectrumTrend, KEV_CADENCE_MIN_PRIOR_DAYS } from "../lib/spectrumTrend";
import { rollingHigh, newPairs, pairTermsOf, formatMoversForPrompt, HIGH_MIN_WEEKS, PAIR_MIN_WEEK, type PairRow } from "../lib/trends";

const TODAY = "2026-09-30";
const d = (back: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);

describe("spectrumTrend — environment and exposure along the series", () => {
  it("KEV cadence needs KEV_CADENCE_MIN_PRIOR_DAYS before it names a normal", () => {
    const short = { Cisco: [{ day: d(2), value: 1 }, { day: d(1), value: 2 }] };
    const c = kevCadence(short, TODAY)[0];
    expect(c.thisWeek).toBe(3);
    expect(c.normalPerWeek).toBeNull();
    expect(c.label).toMatch(/normal forming/);
    const prior = Array.from({ length: KEV_CADENCE_MIN_PRIOR_DAYS }, (_, i) => ({ day: d(10 + i), value: i % 7 === 0 ? 1 : 0 }));
    const c2 = kevCadence({ Cisco: [...prior, { day: d(1), value: 3 }] }, TODAY)[0];
    expect(c2.normalPerWeek).toBeCloseTo(1);        // 2 of 14 prior days × 7
    expect(c2.label).toBe("Cisco: 3 this week vs ~1.0/wk normal");
  });
  it("scaleShare is of observed days and needs four points", () => {
    expect(scaleShare([{ day: d(0), value: 2 }], TODAY)).toBeNull();
    const s = scaleShare([0, 1, 0, 2, 0].map((v, i) => ({ day: d(i), value: v })), TODAY)!;
    expect(s).toMatchObject({ hits: 2, observed: 5 });
    expect(s.label).toBe("G≥1 on 2 of 5 obs days (30 d)");
  });
  it("direction follows the G series when a storm day is on record, else KEV", () => {
    const g = [0, 0, 1, 2, 3].map((v, i) => ({ day: d(4 - i), value: v }));
    expect(spectrumTrend(g, {}, TODAY).direction).toBe("rising");
    const kev = { Cisco: [3, 2, 1, 0].map((v, i) => ({ day: d(3 - i), value: v })) };
    expect(spectrumTrend([], kev, TODAY).direction).toBe("falling");
  });
});

describe("trends — 90-day high", () => {
  const weekly = (weeks: number[], offsetBack = 0) =>
    weeks.flatMap((n, w) => [{ date: d(offsetBack + w * 7), count: n }]);   // one count per week, newest first
  it("says nothing before HIGH_MIN_WEEKS of history", () => {
    expect(HIGH_MIN_WEEKS).toBe(5);
    expect(rollingHigh(weekly([9, 2, 2]), TODAY).isHigh).toBeNull();
  });
  it("this week above every prior window is a high; equal is not", () => {
    const hist = weekly([9, 4, 6, 3, 5, 2]);   // 6 weeks: cur 9 vs prior max 6
    const r = rollingHigh(hist, TODAY);
    expect(r.cur7).toBe(9);
    expect(r.priorMax7).toBe(6);
    expect(r.isHigh).toBe(true);
    expect(rollingHigh(weekly([6, 4, 6, 3, 5, 2]), TODAY).isHigh).toBe(false);
  });
  it("the prompt notes at most two highs", () => {
    const m = (term: string, high: boolean) => ({ kind: "topic" as const, term, cur: 9, prev: 2, state: "rising" as const, score: 3, high90: high });
    const s = formatMoversForPrompt([m("a", true), m("b", true), m("c", true)], 6);
    expect((s.match(/90-day high/g) ?? []).length).toBe(2);
  });
});

describe("trends — pairs", () => {
  it("pairTermsOf pairs watch/region with topics, never a term with itself, capped", () => {
    const terms = [
      { kind: "watch" as const, term: "hormuz" }, { kind: "region" as const, term: "iran" },
      { kind: "topic" as const, term: "tanker" }, { kind: "topic" as const, term: "hormuz" }, { kind: "category" as const, term: "news" },
    ];
    const p = pairTermsOf(terms);
    expect(p).toEqual([
      { a: "watch|hormuz", b: "topic|tanker" },
      { a: "region|iran", b: "topic|tanker" },
      { a: "region|iran", b: "topic|hormuz" },
    ]);
    expect(pairTermsOf(terms, 1)).toHaveLength(1);
  });
  it("newPairs needs PAIR_MIN_WEEK sightings this week and silence for 60 days before", () => {
    expect(PAIR_MIN_WEEK).toBe(3);
    const rows: PairRow[] = [
      { date: d(1), a: "watch|hormuz", b: "topic|tanker", count: 2 },
      { date: d(0), a: "watch|hormuz", b: "topic|tanker", count: 1 },
      { date: d(2), a: "watch|hormuz", b: "topic|mine", count: 3 },
      { date: d(40), a: "watch|hormuz", b: "topic|mine", count: 1 },    // seen before → not new
      { date: d(3), a: "watch|suez", b: "topic|delay", count: 2 },       // below the floor
      { date: d(70), a: "watch|hormuz", b: "topic|tanker", count: 5 },   // outside the quiet window
    ];
    const n = newPairs(rows, TODAY);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ a: "watch|hormuz", b: "topic|tanker", thisWeek: 3 });
    expect(n[0].label).toBe('"hormuz" + "tanker" together 3× this week — first time in 60 d');
  });
});
