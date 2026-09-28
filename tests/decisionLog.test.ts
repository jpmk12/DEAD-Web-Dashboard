import { describe, it, expect } from "vitest";
import {
  hitRate, isDue, isPending, isOpen, daysUntilDue, validateDraft, dueAtFor,
  sortForDisplay, MIN_SCORED_FOR_RATE, MAX_EXPECTATION_LEN,
} from "../lib/decisionLog";
import type { DecisionEntry, DecisionOutcome } from "../lib/decisionLog";

const NOW = Date.parse("2026-09-28T12:00:00Z");

const entry = (over: Partial<DecisionEntry> = {}): DecisionEntry => ({
  id: "d1", problemId: "centcom-iran", indicatorId: "escalation",
  call: "escalating", expectation: "More than two strikes attributed to state actors",
  horizonDays: 14,
  createdAt: new Date(NOW - 14 * 86_400_000).toISOString(),
  dueAt: new Date(NOW + 1 * 86_400_000).toISOString(),
  outcome: null, scoredAt: null, scoreNote: null, by: "owner@example.com",
  ...over,
});

const scored = (outcome: DecisionOutcome, id = Math.random().toString(36)): DecisionEntry =>
  entry({ id, outcome, scoredAt: new Date(NOW).toISOString() });

describe("open / due / pending", () => {
  it("separates open from scored", () => {
    expect(isOpen(entry())).toBe(true);
    expect(isOpen(scored("right"))).toBe(false);
  });

  it("calls an open entry due once its horizon has passed", () => {
    const past = entry({ dueAt: new Date(NOW - 86_400_000).toISOString() });
    expect(isDue(past, NOW)).toBe(true);
    expect(isPending(past, NOW)).toBe(false);
  });

  it("never re-opens something already scored", () => {
    const past = entry({ dueAt: new Date(NOW - 86_400_000).toISOString(), outcome: "wrong" });
    expect(isDue(past, NOW)).toBe(false);
  });

  it("treats an unparseable due date as not-due rather than guessing", () => {
    expect(isDue(entry({ dueAt: "soon" }), NOW)).toBe(false);
    expect(daysUntilDue(entry({ dueAt: "soon" }), NOW)).toBeNull();
  });

  it("reports whole days, negative once overdue", () => {
    expect(daysUntilDue(entry(), NOW)).toBe(1);
    expect(daysUntilDue(entry({ dueAt: new Date(NOW - 3 * 86_400_000).toISOString() }), NOW)).toBe(-3);
  });

  it("dueAtFor lands the horizon out", () => {
    expect(dueAtFor(7, NOW)).toBe(new Date(NOW + 7 * 86_400_000).toISOString());
  });
});

describe("hitRate — ambiguity stays visible", () => {
  it("excludes ambiguous from the ratio but reports the count", () => {
    // A log that is mostly ambiguous means the expectations are not being
    // written sharply enough. Dropping those silently would hide the finding.
    const e = [
      ...Array.from({ length: 4 }, (_, i) => scored("right", `r${i}`)),
      scored("wrong", "w0"),
      scored("ambiguous", "a0"), scored("ambiguous", "a1"),
    ];
    const h = hitRate(e);
    expect(h.decided).toBe(5);
    expect(h.ambiguous).toBe(2);
    expect(h.rate).toBeCloseTo(0.8);
    expect(h.label).toBe("80% (4/5), 2 ambiguous");
  });

  it("gives a tally, not a percentage, below the floor", () => {
    // Two-for-three is not 67% skill.
    const h = hitRate([scored("right", "a"), scored("right", "b"), scored("wrong", "c")]);
    expect(h.rate).toBeNull();
    expect(h.label).toBe("2 of 3 so far");
    expect(MIN_SCORED_FOR_RATE).toBeGreaterThan(3);
  });

  it("says so when nothing is scored", () => {
    expect(hitRate([entry()]).label).toBe("no scored calls yet");
    expect(hitRate([]).rate).toBeNull();
  });

  it("does not claim a rate from ambiguity alone", () => {
    const h = hitRate([scored("ambiguous", "a"), scored("ambiguous", "b")]);
    expect(h.decided).toBe(0);
    expect(h.rate).toBeNull();
    expect(h.label).toBe("2 scored, none decisive");
  });
});

describe("validateDraft", () => {
  const ok = { problemId: "p", call: "holding", expectation: "No new FIR closures in the window", horizonDays: 14 };

  it("accepts a well-formed draft", () => {
    expect(validateDraft(ok)).toBeNull();
  });

  it("requires an expectation long enough to score later", () => {
    // An unscoreable entry is worse than none: it makes the hit rate look
    // better-founded than it is.
    expect(validateDraft({ ...ok, expectation: "dunno" })).toMatch(/what you expect/);
    expect(validateDraft({ ...ok, expectation: "   " })).toMatch(/what you expect/);
  });

  it("bounds the expectation", () => {
    expect(validateDraft({ ...ok, expectation: "x".repeat(MAX_EXPECTATION_LEN + 1) })).toMatch(/under/);
  });

  it("rejects an unknown call or horizon", () => {
    expect(validateDraft({ ...ok, call: "vibes" })).toMatch(/Pick a call/);
    expect(validateDraft({ ...ok, horizonDays: 90 })).toMatch(/Pick a horizon/);
    expect(validateDraft({ ...ok, horizonDays: "14" })).toMatch(/Pick a horizon/);
  });

  it("requires a problem", () => {
    expect(validateDraft({ ...ok, problemId: "  " })).toMatch(/problem is required/);
  });
});

describe("sortForDisplay", () => {
  it("puts what needs you first: due, then pending, then scored", () => {
    const due = entry({ id: "due", dueAt: new Date(NOW - 2 * 86_400_000).toISOString() });
    const moreOverdue = entry({ id: "older", dueAt: new Date(NOW - 9 * 86_400_000).toISOString() });
    const pending = entry({ id: "pending", dueAt: new Date(NOW + 5 * 86_400_000).toISOString() });
    const done = scored("right", "done");
    const r = sortForDisplay([done, pending, due, moreOverdue], NOW);
    expect(r.map((e) => e.id)).toEqual(["older", "due", "pending", "done"]);
  });
});
