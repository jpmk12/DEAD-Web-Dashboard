import { describe, it, expect } from "vitest";
import {
  SEVERITY_RANK, SEVERITIES, isWorse, worseOf, worstOf, byWorstFirst, asSeverity,
  SEVERITY_DOT, SEVERITY_TEXT, SEVERITY_BORDER,
} from "../lib/severity";
import type { Severity } from "../lib/severity";

describe("the ordinals are load-bearing", () => {
  it("keeps forceProtection's exact numbers — its scoring multiplies by them", () => {
    // `rank * 20` in lib/forceProtection.ts depends on these precise values.
    // Moving one silently rescales every force-protection score.
    expect(SEVERITY_RANK).toEqual({ green: 0, unknown: 1, amber: 2, red: 3 });
  });

  it("is higher-is-worse, with unknown ABOVE green", () => {
    // "UNKNOWN is not clear", expressed as an ordering. A sort that buried
    // unknown below green would hide exactly what a dead feed produces.
    expect(isWorse("unknown", "green")).toBe(true);
    expect(isWorse("amber", "unknown")).toBe(true);
    expect(isWorse("red", "amber")).toBe(true);
    expect(isWorse("green", "unknown")).toBe(false);
    expect(isWorse("red", "red")).toBe(false);
  });

  it("lists every level exactly once", () => {
    expect([...SEVERITIES].sort()).toEqual(Object.keys(SEVERITY_RANK).sort());
  });
});

describe("worseOf / worstOf", () => {
  it("returns the worse of two", () => {
    expect(worseOf("green", "red")).toBe("red");
    expect(worseOf("amber", "unknown")).toBe("amber");
  });

  it("lets the first argument win a tie, matching the original reducer", () => {
    // forceProtection's `worse()` used `>=`; a reducer that flipped to `>`
    // would change which of two equal categories carries the composite's id.
    expect(worseOf("amber", "amber")).toBe("amber");
  });

  it("finds the worst in a list", () => {
    expect(worstOf(["green", "amber", "unknown"])).toBe("amber");
    expect(worstOf(["green", "green"])).toBe("green");
  });

  it("calls an empty group unknown, never green", () => {
    expect(worstOf([])).toBe("unknown");
    expect(worstOf([], "green")).toBe("green");   // only when the caller says so
  });
});

describe("byWorstFirst", () => {
  it("sorts worst first and composes with a tie-break", () => {
    const rows: { s: Severity; score: number }[] = [
      { s: "green", score: 9 }, { s: "red", score: 1 }, { s: "unknown", score: 5 },
      { s: "amber", score: 3 }, { s: "red", score: 7 },
    ];
    rows.sort((a, b) => byWorstFirst(a.s, b.s) || b.score - a.score);
    expect(rows.map((r) => `${r.s}:${r.score}`)).toEqual(["red:7", "red:1", "amber:3", "unknown:5", "green:9"]);
  });
});

describe("asSeverity", () => {
  it("narrows a valid value and defaults everything else to unknown", () => {
    expect(asSeverity("red")).toBe("red");
    expect(asSeverity("orange")).toBe("unknown");   // a different vocabulary is not this one
    expect(asSeverity(null)).toBe("unknown");
    expect(asSeverity(3)).toBe("unknown");
  });

  it("never defaults to green", () => {
    // A malformed severity from a feed must not read as clear.
    expect(asSeverity("")).not.toBe("green");
    expect(asSeverity(undefined)).not.toBe("green");
  });
});

describe("display tokens cover every level", () => {
  it("has a dot, text and border class for each severity", () => {
    for (const s of SEVERITIES) {
      expect(SEVERITY_DOT[s]).toMatch(/^#[0-9a-f]{6}$/);
      expect(SEVERITY_TEXT[s]).toMatch(/^text-/);
      expect(SEVERITY_BORDER[s]).toMatch(/^border-l-/);
    }
  });
});
