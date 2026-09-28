import { describe, it, expect } from "vitest";
import { classifyChronicity, chronicityBadge, shiftDay, MIN_OBSERVED } from "../lib/chronicity";
import type { DayObservation } from "../lib/chronicity";

const TODAY = "2026-09-28";

/** n days of history ending YESTERDAY, newest last. `pattern` is read from the
 *  oldest day forward; true = elevated. */
const hist = (pattern: boolean[]): DayObservation[] =>
  pattern.map((elevated, i) => ({
    day: shiftDay(TODAY, -(pattern.length - i))!,
    elevated,
  }));

describe("shiftDay", () => {
  it("moves whole days across month boundaries", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("refuses an unparseable day rather than inventing one", () => {
    // A bad day string must not produce a window that quietly includes
    // everything — the caller sees null and bails.
    expect(shiftDay("not-a-day", -1)).toBeNull();
    expect(shiftDay("2026-9-1", -1)).toBeNull();
  });
});

describe("classifyChronicity — learning mode", () => {
  it("refuses to characterise an elevated reading with too little history", () => {
    // With three days, "chronic" and "started Tuesday" are indistinguishable. A
    // wrong label here would tell a commander to stop worrying about something
    // new, so we say what we actually know.
    const r = classifyChronicity(hist([true, true]), true, TODAY);
    expect(r.state).toBe("unknown");
    expect(r.label).toMatch(/only 3 days of history/);
  });

  it("starts characterising once MIN_OBSERVED days exist", () => {
    const r = classifyChronicity(hist(Array(MIN_OBSERVED - 1).fill(true)), true, TODAY);
    expect(r.daysObserved).toBe(MIN_OBSERVED);
    expect(r.state).toBe("chronic");
  });

  it("treats a single day of history as unknown, not new", () => {
    expect(classifyChronicity([], true, TODAY).state).toBe("unknown");
  });
});

describe("classifyChronicity — the observed-days denominator", () => {
  it("counts against days OBSERVED, never calendar days", () => {
    // Six recorded days inside a 14-day window, all elevated. This is chronic
    // on everything we ever saw — reporting "6 of 14" would under-state it on
    // exactly the week the user was away and most needs telling.
    const r = classifyChronicity(hist([true, true, true, true, true]), true, TODAY);
    expect(r.daysObserved).toBe(6);
    expect(r.daysElevated).toBe(6);
    expect(r.label).toBe("chronic · 6 of last 6 observed days");
  });

  it("ignores days outside the window", () => {
    const old: DayObservation[] = [{ day: shiftDay(TODAY, -40)!, elevated: true }];
    const r = classifyChronicity([...old, ...hist([false, false, false, false])], true, TODAY);
    expect(r.daysObserved).toBe(5);
    expect(r.daysElevated).toBe(1);
  });

  it("does not let a recording gap read as a recovery", () => {
    // Elevated a week ago, no records since, elevated today. The previous
    // OBSERVED day was elevated, so this is a continuation — not "new today".
    const series: DayObservation[] = [
      { day: shiftDay(TODAY, -8)!, elevated: true },
      { day: shiftDay(TODAY, -7)!, elevated: true },
      { day: shiftDay(TODAY, -6)!, elevated: true },
      { day: shiftDay(TODAY, -5)!, elevated: true },
    ];
    const r = classifyChronicity(series, true, TODAY);
    expect(r.state).toBe("chronic");
  });

  it("collapses a duplicated day and lets today's live reading win", () => {
    const series = [
      ...hist([true, true, true, true]),
      { day: TODAY, elevated: false },   // a stale stored row for today
      { day: TODAY, elevated: false },
    ];
    const r = classifyChronicity(series, true, TODAY);   // live reading says elevated
    expect(r.daysObserved).toBe(5);
    expect(r.streak).toBe(5);
  });
});

describe("classifyChronicity — states", () => {
  it("calls it new when the previous observed day was clear", () => {
    const r = classifyChronicity(hist([false, false, false, false, false]), true, TODAY);
    expect(r.state).toBe("new");
    expect(r.label).toBe("new today");
    expect(r.streak).toBe(1);
  });

  it("calls it chronic when most observed days are elevated", () => {
    const r = classifyChronicity(hist([true, true, true, false, true, true]), true, TODAY);
    expect(r.state).toBe("chronic");
    expect(r.daysElevated).toBe(6);
    expect(r.daysObserved).toBe(7);
  });

  it("calls it recurring when it clears and returns without dominating", () => {
    // 3 of 8 elevated — under the chronic share — but it has flared twice.
    const r = classifyChronicity(hist([true, false, false, false, false, false, true]), true, TODAY);
    expect(r.state).toBe("recurring");
    expect(r.onsets).toBe(2);
    expect(r.label).toMatch(/recurring · 2 flare-ups/);
  });

  it("reports improving when clear today but elevated in the window", () => {
    const r = classifyChronicity(hist([true, true, true, false, false]), false, TODAY);
    expect(r.state).toBe("improving");
    expect(r.label).toMatch(/clear today/);
  });

  it("says nothing at all about a quiet entry", () => {
    // The panel must not grow a row per calm base — silence is the default.
    const r = classifyChronicity(hist([false, false, false, false, false]), false, TODAY);
    expect(r.state).toBe("quiet");
    expect(r.label).toBeNull();
  });

  it("flags a new flare that has happened before", () => {
    const r = classifyChronicity(hist([true, true, false, false, false, false]), true, TODAY);
    expect(r.state).toBe("new");
    expect(r.onsets).toBe(2);
    expect(r.label).toMatch(/new today · 2 flare-ups/);
  });
});

describe("chronicityBadge", () => {
  it("badges only the states worth a chip", () => {
    expect(chronicityBadge("chronic")).toBe("CHRONIC");
    expect(chronicityBadge("recurring")).toBe("RECURRING");
    expect(chronicityBadge("new")).toBe("NEW");
    expect(chronicityBadge("improving")).toBe("IMPROVING");
    expect(chronicityBadge("quiet")).toBeNull();
    expect(chronicityBadge("unknown")).toBeNull();
  });
});
