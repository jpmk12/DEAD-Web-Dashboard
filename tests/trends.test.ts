import { describe, it, expect } from "vitest";
import { classifyMovers, topicTerms, watchTermsIn, utcDate, formatMoversForPrompt, type MoverRow } from "@/lib/trends";

describe("classifyMovers", () => {
  const row = (term: string, cur: number, prev: number): MoverRow =>
    ({ kind: "topic", term, cur, prev });

  it("drops terms under the noise floor (cur+prev < 4)", () => {
    expect(classifyMovers([row("blip", 2, 1)])).toEqual([]);
    expect(classifyMovers([row("edge", 2, 2)])).toHaveLength(1);
  });

  it("classifies a term with no prior week as new", () => {
    const [m] = classifyMovers([row("hormuz", 6, 0)]);
    expect(m.state).toBe("new");
  });

  it("a single prior mention is rising, not new", () => {
    const [m] = classifyMovers([row("hormuz", 6, 1)]);
    expect(m.state).toBe("rising");
  });

  it("requires ~2x growth to call rising", () => {
    expect(classifyMovers([row("a", 10, 5)])[0].state).toBe("rising");   // 2.0x
    expect(classifyMovers([row("b", 8, 5)])[0].state).toBe("steady");    // 1.6x
  });

  it("calls fading on a halving from a real base", () => {
    expect(classifyMovers([row("a", 2, 6)])[0].state).toBe("fading");
    // prev too small to fade meaningfully
    expect(classifyMovers([row("b", 2, 4)])[0].state).toBe("steady");
  });

  it("sorts new/rising before fading before steady, by velocity", () => {
    const out = classifyMovers([
      row("steady", 6, 6),
      row("fader", 2, 8),
      row("riser", 9, 3),
      row("newcomer", 5, 0),
    ]);
    expect(out.map((m) => m.term)).toEqual(["newcomer", "riser", "fader", "steady"]);
  });

  it("never mutates negative inputs into nonsense", () => {
    const [m] = classifyMovers([row("weird", -2, 9)]);
    expect(m.cur).toBe(0);
    expect(m.state).toBe("fading");
  });
});

describe("term builders", () => {
  it("topicTerms extracts deduped lowercase keywords, capped", () => {
    const terms = topicTerms("Iran Iran strikes STRIKES near the Strait of Hormuz", 3);
    expect(terms.map((t) => t.term)).toEqual(["iran", "strikes", "near"]);
    expect(terms.every((t) => t.kind === "topic")).toBe(true);
  });

  it("watchTermsIn matches case-insensitively and skips 1-char terms", () => {
    const terms = watchTermsIn("USS Gerald R. Ford transits Hormuz", ["hormuz", "x", "  Ford "]);
    expect(terms.map((t) => t.term).sort()).toEqual(["ford", "hormuz"]);
  });
});

describe("utcDate / prompt formatting", () => {
  it("formats a UTC YYYY-MM-DD", () => {
    expect(utcDate(Date.UTC(2026, 5, 10, 23, 59))).toBe("2026-06-10");
  });

  it("formatMoversForPrompt omits steady terms and respects max", () => {
    const movers = classifyMovers([
      { kind: "topic", term: "riser", cur: 9, prev: 3 },
      { kind: "topic", term: "steady", cur: 6, prev: 6 },
    ]);
    const text = formatMoversForPrompt(movers);
    expect(text).toContain('RISING topic "riser" — 9 mentions this week vs 3 last week');
    expect(text).not.toContain("steady");
  });
});
