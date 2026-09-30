import { describe, it, expect } from "vitest";
import { attentionGaps, openKeyFor, GAP_MAX } from "../lib/attentionGaps";
import type { LevelSeries } from "../lib/oeDelta";
import type { OpenRow } from "../lib/openSignal";

const NOW = Date.parse("2026-09-30T15:00:00Z");
const d = (ago: number) => new Date(NOW - ago * 86_400_000).toISOString().slice(0, 10);
const ms = (ago: number) => NOW - ago * 86_400_000;

const board = (id: string, levels: [number, string][]): LevelSeries => ({ kind: "iw", id, label: `CENTCOM · ${id}`, points: levels.map(([ago, level]) => ({ day: d(ago), level })) });
const country = (name: string, levels: [number, string][]): LevelSeries => ({ kind: "posture", id: `c:${name.toLowerCase()}`, label: name, points: levels.map(([ago, level]) => ({ day: d(ago), level })) });
const led = (icao: string, axis: string, levels: [number, string][]): LevelSeries => ({ kind: "sitrep", id: `${icao}:${axis}`, label: icao, axis, points: levels.map(([ago, level]) => ({ day: d(ago), level })) });
const open = (surface: OpenRow["surface"], id: string, ago: number): OpenRow => ({ surface, id, opens: 1, lastOpenAt: ms(ago) });

describe("attentionGaps — what worsened since you last opened it", () => {
  it("keys series to the open-tracking surfaces; a posture base entry has no key", () => {
    expect(openKeyFor(board("iran", []))).toEqual({ surface: "board", id: "iran" });
    expect(openKeyFor(led("KWRI", "wx", []))).toEqual({ surface: "base", id: "KWRI" });
    expect(openKeyFor(country("Iran", []))).toEqual({ surface: "country", id: "Iran" });
    expect(openKeyFor({ kind: "posture", id: "b:al udeid", label: "Al Udeid", points: [] })).toBeNull();
  });

  it("a board that stepped up after the last open is a gap; opened since, it is not; never opened says so", () => {
    const series = [
      board("iran", [[10, "calm"], [5, "watch"], [1, "warning"]]),
      board("levant", [[10, "calm"], [3, "watch"], [1, "watch"]]),
      board("sahel", [[10, "calm"], [2, "warning"]]),
    ];
    const opens = [open("board", "iran", 7), open("board", "levant", 1)];
    const g = attentionGaps(opens, series, NOW);
    // Same level: never-opened is the larger gap and leads; levant was opened after its step.
    expect(g.map((x) => x.id)).toEqual(["sahel", "iran"]);
    expect(g[1].line).toBe("CENTCOM · iran — worse since 09-29, not opened for 7 d");
    expect(g[0].line).toBe("CENTCOM · sahel — worse since 09-28, never opened");
  });

  it("an improvement is never a gap, nor a step-up that has since recovered, nor one outside the window", () => {
    const series = [
      board("a", [[10, "warning"], [2, "watch"]]),                 // improving
      board("b", [[10, "calm"], [6, "warning"], [1, "calm"]]),     // recovered
      board("c", [[30, "calm"], [20, "warning"], [1, "warning"]]), // old step, outside 14 d
    ];
    expect(attentionGaps([], series, NOW)).toEqual([]);
  });

  it("collapses a base's LEDs to one row (the worst) and keys the open by ICAO", () => {
    const series = [led("KWRI", "wx", [[5, "g"], [2, "a"]]), led("KWRI", "ops", [[5, "g"], [1, "r"]])];
    const g = attentionGaps([open("base", "kwri", 3)], series, NOW);
    expect(g).toHaveLength(1);
    expect(g[0].level).toBe("r");
    expect(g[0].line).toBe("KWRI ops — worse since 09-29, not opened for 3 d");
    expect(attentionGaps([open("base", "KWRI", 0)], series, NOW)).toEqual([]);
  });

  it("caps at GAP_MAX, worst first", () => {
    const series = Array.from({ length: 6 }, (_, i) => board(`p${i}`, [[8, "calm"], [2, i === 0 ? "alert" : "warning"]]));
    const g = attentionGaps([], series, NOW);
    expect(GAP_MAX).toBe(3);
    expect(g).toHaveLength(3);
    expect(g[0].id).toBe("p0");
  });
});
