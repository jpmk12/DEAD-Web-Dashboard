import { describe, it, expect } from "vitest";
import { openBoosts, topOpened, decayedOpens, MAX_BOOST, POINTS_PER_OPEN, HALF_LIFE_DAYS, type OpenRow } from "../lib/openSignal";

const NOW = Date.UTC(2026, 8, 29);
const day = 86_400_000;
const row = (surface: OpenRow["surface"], id: string, opens: number, ageDays: number): OpenRow =>
  ({ surface, id, opens, lastOpenAt: NOW - ageDays * day });

describe("openSignal", () => {
  it("decays by half every HALF_LIFE_DAYS", () => {
    expect(decayedOpens(row("base", "KWRI", 8, 0), NOW)).toBe(8);
    expect(decayedOpens(row("base", "KWRI", 8, HALF_LIFE_DAYS), NOW)).toBeCloseTo(4, 5);
    expect(decayedOpens(row("base", "KWRI", 8, 2 * HALF_LIFE_DAYS), NOW)).toBeCloseTo(2, 5);
  });

  it("keys boosts by palette id and caps them below the smallest token score", () => {
    const b = openBoosts([row("base", "KWRI", 2, 0), row("board", "mp-1", 100, 0), row("country", "Iran", 1, 0)], NOW);
    expect(b["base:KWRI"]).toBe(2 * POINTS_PER_OPEN);
    expect(b["board:mp-1"]).toBe(MAX_BOOST);
    expect(b["country:Iran"]).toBe(POINTS_PER_OPEN);
    expect(MAX_BOOST).toBeLessThan(30);
  });

  it("ignores unknown surfaces, empty ids and zero counts", () => {
    const b = openBoosts([
      { surface: "doc" as unknown as OpenRow["surface"], id: "1", opens: 5, lastOpenAt: NOW },
      row("base", "", 5, 0), row("base", "OTBH", 0, 0),
    ], NOW);
    expect(b).toEqual({});
  });

  it("orders recent by decayed weight, drops what has faded, honours the limit", () => {
    const ids = topOpened([
      row("base", "OTBH", 1, 400),     // one open, over a year ago — faded
      row("base", "KWRI", 3, 1),
      row("country", "Iran", 10, 90),  // 10 × 0.125 = 1.25
      row("board", "mp-1", 2, 0),
    ], 2, NOW);
    expect(ids).toEqual(["base:KWRI", "board:mp-1"]);
    expect(topOpened([row("base", "OTBH", 1, 400)], 4, NOW)).toEqual([]);
  });
});
