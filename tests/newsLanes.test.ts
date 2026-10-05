import { describe, it, expect } from "vitest";
import { laneFor, groupMovers, threadForArticle, mentionsTerm } from "../lib/newsLanes";
import { queueReason, perSource, oldestAgeDays } from "../lib/newsletterQueue";
import type { TrendMover } from "../lib/trends";

describe("laneFor", () => {
  const crit = new Set(["b"]);
  it("an analysis outlet is depth even when curated as critical", () => {
    expect(laneFor({ id: "b", source: "War on the Rocks", summary: "x" }, crit)).toBe("depth");
  });
  it("a long wire body is depth; a curated wire piece is now; the rest folds", () => {
    expect(laneFor({ id: "a", source: "Defense News", summary: "x".repeat(900) }, crit)).toBe("depth");
    expect(laneFor({ id: "b", source: "Defense News", summary: "short" }, crit)).toBe("now");
    expect(laneFor({ id: "c", source: "Defense News", summary: "short" }, crit)).toBe("rest");
  });
});

describe("groupMovers / mentionsTerm / threadForArticle", () => {
  const m = (term: string, state: TrendMover["state"], cur: number, prev: number): TrendMover => ({ kind: "topic", term, state, cur, prev, velocity: 0 } as TrendMover);
  it("rising sorts by velocity, new by count, fading by how far it fell", () => {
    const g = groupMovers([m("boeing", "rising", 18, 9), m("israel", "rising", 150, 70), m("combat pay", "new", 7, 0), m("bab el-mandeb", "new", 9, 0), m("cisa", "fading", 3, 10), m("golden dome", "fading", 5, 10), m("x", "steady", 5, 5)]);
    expect(g.rising.map((x) => x.term)).toEqual(["israel", "boeing"]);
    expect(g.fresh.map((x) => x.term)).toEqual(["bab el-mandeb", "combat pay"]);
    expect(g.fading.map((x) => x.term)).toEqual(["cisa", "golden dome"]);
  });
  it("mentionsTerm is case-insensitive and ignores one-letter terms", () => {
    expect(mentionsTerm({ title: "Bab el-Mandeb seized", summary: "" }, "bab el-mandeb")).toBe(true);
    expect(mentionsTerm({ title: "x", summary: "" }, "x")).toBe(false);
  });
  it("threadForArticle finds the owning thread", () => {
    expect(threadForArticle("a2", [{ label: "IRAN WAR", articleIds: ["a1", "a2"] }])).toBe("IRAN WAR");
    expect(threadForArticle("zz", [{ label: "IRAN WAR", articleIds: ["a1"] }])).toBeNull();
  });
});

describe("newsletter queue", () => {
  it("earns a row for a watchlist hit, a thread match or a kept pin — else none", () => {
    const n = { id: "1", subject: "What to do about the Houthis", bullets: ["Red Sea attacks resume."] };
    expect(queueReason(n, ["houthis"], [], new Set())).toEqual({ kind: "watch", text: "⚑ houthis" });
    expect(queueReason(n, [], [{ label: "RED SEA" }], new Set())?.kind).toBe("thread");
    expect(queueReason(n, [], [], new Set(["1"]))?.kind).toBe("kept");
    expect(queueReason(n, [], [{ label: "IRAN WAR" }], new Set())).toBeNull();
  });
  it("counts per source and ages the oldest", () => {
    expect(perSource([{ source: "politico" }, { source: "asf" }, { source: "politico" }])).toEqual([{ source: "politico", count: 2 }, { source: "asf", count: 1 }]);
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(oldestAgeDays([{ date: "2026-10-04T12:00:00Z" }, { date: "2026-09-30T06:00:00Z" }], now)).toBe(5);
    expect(oldestAgeDays([{ date: "bad" }], now)).toBeNull();
  });
});
