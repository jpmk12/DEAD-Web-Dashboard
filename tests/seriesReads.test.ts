import { describe, it, expect } from "vitest";
import { elevatedHistory, surgeDays, chatterLeadRead, HISTORY_STALE_DAYS } from "../lib/seriesReads";
import { spectrumTrend, scaleShare } from "../lib/spectrumTrend";
import type { SeriesPoint } from "../lib/series";

const TODAY = "2026-10-29";
const day = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
/** values[0] is the oldest; the last value is `endAgo` days before today. */
const series = (values: number[], endAgo = 0): SeriesPoint[] =>
  values.map((v, i) => ({ day: day(endAgo + values.length - 1 - i), value: v }));

describe("elevatedHistory — outage / routing series", () => {
  it("nothing on record is null — 'no history yet', never quiet", () => {
    expect(elevatedHistory("IODA outages", [], TODAY)).toBeNull();
  });
  it("calls a country elevated most observed days chronic, with the honest denominator", () => {
    const h = elevatedHistory("Radar outages", series([2, 3, 2, 2, 0, 2, 3, 2, 2, 2]), TODAY)!;
    expect(h.state).toBe("chronic");
    expect(h.daysObserved).toBe(10);
    expect(h.label).toMatch(/^Radar outages: chronic · 9 of last 10 observed days/);
  });
  it("a quiet record says how many days it observed", () => {
    const h = elevatedHistory("BGP routing", series([0, 0, 1, 0, 0, 0]), TODAY)!;
    expect(h.state).toBe("quiet");
    expect(h.label).toBe("BGP routing: no elevated day in 6 observed (30 d)");
  });
  it("a note (1) is not elevated; amber (2) is", () => {
    expect(elevatedHistory("x", series([1, 1, 1, 1, 1]), TODAY)!.state).toBe("quiet");
    expect(elevatedHistory("x", series([0, 0, 0, 0, 2]), TODAY)!.state).toBe("new");
  });
  it("too little history is said, not characterised", () => {
    expect(elevatedHistory("x", series([2, 2]), TODAY)!.label).toMatch(/only 2 days of history/);
  });
  it("a stale record names its age instead of reading as today", () => {
    const h = elevatedHistory("x", series([0, 0, 0, 0, 0], HISTORY_STALE_DAYS + 3), TODAY)!;
    expect(h.label).toMatch(/last observed 6 d ago/);
  });
  it("only the trailing window counts", () => {
    const old = series([3, 3, 3, 3, 3], 40);
    expect(elevatedHistory("x", old, TODAY)).toBeNull();
  });
});

describe("surgeDays — the I&W surge rule over prior observed days", () => {
  it("needs seven prior days before calling a surge", () => {
    expect(surgeDays(series([4, 4, 4, 4, 4, 4, 30]))).toEqual([]);
  });
  it("flags a day above the command's own trailing normal (×1.4, floor mean+2)", () => {
    const s = series([4, 4, 4, 4, 4, 4, 4, 5, 12, 4]);
    expect(surgeDays(s)).toEqual([day(1)]);
    // 5 over a mean of 4 clears ×1.4 (5.6)? No — and the +2 floor (6) also holds it.
    expect(surgeDays(series([4, 4, 4, 4, 4, 4, 4, 6]))).toEqual([]);
  });
});

describe("chatterLeadRead — does chatter come before the ADS-B surge?", () => {
  // Lift: flat 4/day for 40 days with surges 30, 20 and 10 days ago.
  const liftVals = Array.from({ length: 40 }, (_, i) => ([30, 20, 10].includes(39 - i) ? 14 : 4));
  const lift = series(liftVals);

  it("is a tally below three surges, never a rate", () => {
    const r = chatterLeadRead([{ day: day(31), value: 2 }], series(Array(20).fill(4).concat([14]), 5), TODAY);
    expect(r.lead).toBeNull();
    expect(r.label).toMatch(/read forming — 1 surge on record \(3 before a read\)/);
  });
  it("counts chatter inside the 3 days before a surge as leading it", () => {
    const chatter = [{ day: day(32), value: 1 }, { day: day(21), value: 2 }, { day: day(10), value: 1 }];
    const r = chatterLeadRead(chatter, lift, TODAY);
    expect(r.surges).toBe(3);
    expect(r.lead?.hits).toBe(3);
    expect(r.label).toMatch(/^lift chatter preceded 3 of 3 ADS-B surges \(median lead 1 d\)/);
    expect(r.unanswered).toBe(0);
  });
  it("names the chatter days no surge followed — the false-alarm count", () => {
    const chatter = [{ day: day(32), value: 1 }, { day: day(25), value: 1 }, { day: day(16), value: 1 }];
    const r = chatterLeadRead(chatter, lift, TODAY);
    expect(r.scored).toBe(3);
    expect(r.unanswered).toBe(2);
    expect(r.label).toMatch(/2 of 3 chatter days not followed by a surge within 3 d/);
  });
  it("an open window or a window with no ADS-B record is not scored — ambiguous, never a miss", () => {
    const chatter = [{ day: day(1), value: 1 }, { day: day(60), value: 1 }];
    const r = chatterLeadRead(chatter, lift, TODAY);
    expect(r.scored).toBe(0);
  });
});

describe("spectrumTrend — R and S beside G", () => {
  const g = series([0, 1, 0, 0, 0]);
  it("labels each scale by its letter", () => {
    expect(scaleShare(series([0, 2, 0, 0]), TODAY, 1, "R")!.label).toBe("R≥1 on 1 of 4 obs days (30 d)");
  });
  it("names R and S on the line only when a day is on record", () => {
    const quiet = spectrumTrend(g, {}, TODAY, series([0, 0, 0, 0]), series([0, 0, 0, 0]));
    expect(quiet.line).toBe("G≥1 on 1 of 5 obs days (30 d)");
    expect(quiet.rShare?.hits).toBe(0);
    const busy = spectrumTrend(g, {}, TODAY, series([0, 3, 1, 0]), series([0, 0, 0, 1]));
    expect(busy.line).toBe("G≥1 on 1 of 5 obs days (30 d) · R≥1 on 2 of 4 obs days (30 d) · S≥1 on 1 of 4 obs days (30 d)");
  });
  it("keeps the old three-argument call working", () => {
    expect(spectrumTrend(g, {}, TODAY).rShare).toBeNull();
  });
});
