import { describe, it, expect } from "vitest";
import { transitionSince, computeDelta, rankFor, levelName, dayOf } from "../lib/oeDelta";
import type { LevelSeries } from "../lib/oeDelta";

const NOW = Date.parse("2026-09-28T15:00:00Z");
const d = (daysAgo: number) => dayOf(NOW - daysAgo * 86_400_000);

const series = (kind: LevelSeries["kind"], levels: [number, string][], over: Partial<LevelSeries> = {}): LevelSeries => ({
  kind, id: "x", label: "Al Udeid", points: levels.map(([ago, level]) => ({ day: d(ago), level })), ...over,
});

describe("rankFor / levelName", () => {
  it("places each vocabulary on a higher-is-worse scale", () => {
    expect(rankFor("posture", "red")).toBe(3);
    expect(rankFor("sitrep", "r")).toBe(3);
    expect(rankFor("iw", "alert")).toBe(3);
    expect(rankFor("posture", "unknown")).toBe(1);   // above green — UNKNOWN is not clear
  });

  it("returns null for a level it cannot place rather than guessing", () => {
    expect(rankFor("posture", "orange")).toBeNull();
    expect(rankFor("sitrep", "x")).toBeNull();
  });

  it("spells LEDs out for sentences", () => {
    expect(levelName("sitrep", "a")).toBe("amber");
    expect(levelName("iw", "watch")).toBe("watch");
  });
});

describe("transitionSince — net change", () => {
  it("reports the level at the last look versus now", () => {
    const t = transitionSince(series("posture", [[3, "green"], [1, "amber"], [0, "red"]]), d(2))!;
    expect(t.from).toBe("green");
    expect(t.to).toBe("red");
    expect(t.direction).toBe("worse");
    expect(t.reason).toBe("Al Udeid: green → red");
  });

  it("is silent when nothing changed net, even if it moved in between", () => {
    // Went red and came back while you were away: no net change here — the
    // chronicity chip on the row carries the recurrence story.
    expect(transitionSince(series("posture", [[3, "amber"], [1, "red"], [0, "amber"]]), d(2))).toBeNull();
  });

  it("treats an improvement as a first-class change", () => {
    const t = transitionSince(series("sitrep", [[3, "r"], [0, "g"]], { axis: "wx" }), d(2))!;
    expect(t.direction).toBe("better");
    expect(t.reason).toBe("Al Udeid wx: red → green");
  });

  it("is silent when nothing has been recorded since the last look", () => {
    expect(transitionSince(series("posture", [[5, "green"], [3, "red"]]), d(1))).toBeNull();
  });
});

describe("transitionSince — the baseline rules", () => {
  it("uses the last OBSERVED day at or before the look, so a gap is not a level", () => {
    // Recorded 6 days ago (amber), nothing for days, then red today. Last look
    // was 2 days ago — inside the gap. The baseline is the amber, not "nothing".
    const t = transitionSince(series("posture", [[6, "amber"], [0, "red"]]), d(2))!;
    expect(t.from).toBe("amber");
    expect(t.direction).toBe("worse");
  });

  it("never claims a direction without a baseline — reports NEW instead", () => {
    // Series began after the last look. "Worse" would be a claim about a past
    // the app never observed.
    const t = transitionSince(series("iw", [[1, "watch"], [0, "warning"]]), d(3))!;
    expect(t.direction).toBe("new");
    expect(t.from).toBeNull();
    expect(t.reason).toMatch(/no earlier record to compare/);
  });

  it("does not report a fresh series that is merely calm", () => {
    // Green, calm and unknown arriving fresh are not news.
    expect(transitionSince(series("posture", [[0, "green"]]), d(3))).toBeNull();
    expect(transitionSince(series("posture", [[0, "unknown"]]), d(3))).toBeNull();
    expect(transitionSince(series("iw", [[0, "watch"]]), d(3))).toBeNull();
  });

  it("ignores malformed points and unplaceable levels", () => {
    const s = series("posture", [[3, "green"], [0, "red"]]);
    s.points.push({ day: "not-a-day", level: "red" }, { day: d(1), level: "orange" });
    const t = transitionSince(s, d(2))!;
    expect(t.to).toBe("red");            // the orange point is skipped, not treated as latest
    expect(transitionSince(series("posture", [[3, "green"], [0, "purple"]]), d(2))).toBeNull();
  });

  it("accepts unordered points", () => {
    const t = transitionSince(series("posture", [[0, "red"], [3, "green"]]), d(2))!;
    expect(t.from).toBe("green");
    expect(t.to).toBe("red");
  });
});

describe("computeDelta", () => {
  it("buckets and ranks: worse by how bad, improved by how far, then new", () => {
    const r = computeDelta([
      series("posture", [[3, "green"], [0, "amber"]], { id: "a", label: "Ramstein" }),
      series("posture", [[3, "green"], [0, "red"]], { id: "b", label: "Al Udeid" }),
      series("sitrep", [[3, "r"], [0, "g"]], { id: "c", label: "KWRI", axis: "ops" }),
      series("iw", [[1, "alert"]], { id: "d", label: "CENTCOM · Iran" }),
    ], NOW - 2 * 86_400_000, NOW);
    expect(r.worse.map((t) => t.label)).toEqual(["Al Udeid", "Ramstein"]);
    expect(r.better.map((t) => t.label)).toEqual(["KWRI"]);
    expect(r.fresh.map((t) => t.label)).toEqual(["CENTCOM · Iran"]);
    expect(r.line).toBe("2 worse · 1 improved · 1 new since your last look");
    expect(r.firstLook).toBe(false);
  });

  it("compares with yesterday on a first look, and says so", () => {
    // A delta against an unstated baseline is one the user cannot evaluate.
    const r = computeDelta([series("posture", [[1, "green"], [0, "red"]])], 0, NOW);
    expect(r.firstLook).toBe(true);
    expect(r.sinceDay).toBe(d(1));
    expect(r.line).toMatch(/since yesterday$/);
  });

  it("says nothing at all when nothing moved", () => {
    const r = computeDelta([series("posture", [[3, "green"], [0, "green"]])], NOW - 86_400_000, NOW);
    expect(r.line).toBeNull();
    expect(r.worse).toEqual([]);
  });

  it("caps each bucket", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      series("posture", [[3, "green"], [0, "red"]], { id: `p${i}`, label: `Base ${i}` }));
    expect(computeDelta(many, NOW - 2 * 86_400_000, NOW, { max: 3 }).worse).toHaveLength(3);
  });
});
