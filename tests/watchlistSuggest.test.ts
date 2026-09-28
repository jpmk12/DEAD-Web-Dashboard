import { describe, it, expect } from "vitest";
import { suggestWatchlist, isCovered, dropKey, addKey } from "../lib/watchlistSuggest";
import type { TrendMover, SignalKind } from "../lib/trends";

const mover = (
  term: string, cur: number, prev: number,
  state: TrendMover["state"], kind: SignalKind = "topic",
): TrendMover => ({ term, cur, prev, state, kind, score: (cur + 1) / (prev + 1) });

describe("isCovered", () => {
  it("treats a broader watched term as already covering a longer candidate", () => {
    // Watching "Hormuz" already catches "Strait of Hormuz" — proposing the
    // longer form would be noise.
    expect(isCovered("Strait of Hormuz", ["Hormuz"])).toBe(true);
    expect(isCovered("hormuz", ["Strait of Hormuz"])).toBe(true);
    expect(isCovered("Bab el-Mandeb", ["Hormuz"])).toBe(false);
  });

  it("is case and whitespace insensitive, and treats empty as covered", () => {
    expect(isCovered("  TAIWAN ", ["taiwan"])).toBe(true);
    expect(isCovered("", ["anything"])).toBe(true);
    expect(isCovered("Taiwan", ["", "  "])).toBe(false);
  });
});

describe("suggestWatchlist — additions", () => {
  const movers = [
    mover("Bab el-Mandeb", 11, 0, "new", "region"),
    mover("Hormuz", 9, 2, "rising", "region"),
    mover("port strike", 7, 3, "rising"),
    mover("quiet thing", 9, 8, "steady"),
  ];

  it("proposes new and rising terms with the evidence attached", () => {
    const { add } = suggestWatchlist(movers, [], []);
    expect(add.map((a) => a.term)).toEqual(["Bab el-Mandeb", "Hormuz", "port strike"]);
    expect(add[0].reason).toBe("11 mentions this week, none the week before");
    expect(add[1].reason).toBe("9 mentions this week, up from 2");
  });

  it("never proposes a steady term — a suggestion has to be earned", () => {
    expect(suggestWatchlist(movers, [], []).add.some((a) => a.term === "quiet thing")).toBe(false);
  });

  it("skips what is already covered and what was dismissed", () => {
    const { add } = suggestWatchlist(movers, ["hormuz"], ["bab el-mandeb"]);
    expect(add.map((a) => a.term)).toEqual(["port strike"]);
  });

  it("holds a floor on mentions and on term length", () => {
    const weak = [mover("Yemen", 3, 0, "new", "region"), mover("oil", 20, 0, "new")];
    const { add } = suggestWatchlist(weak, [], []);
    expect(add).toEqual([]);   // 3 mentions is under the floor; "oil" is too short to be a watch term
  });

  it("ignores thread labels — editorial groupings, not search terms", () => {
    const { add } = suggestWatchlist([mover("IRAN WAR", 30, 0, "new", "label")], [], []);
    expect(add).toEqual([]);
  });

  it("orders by mentions and caps the list", () => {
    const many = Array.from({ length: 12 }, (_, i) => mover(`term-${i}`, 20 - i, 0, "new"));
    const { add } = suggestWatchlist(many, [], []);
    expect(add).toHaveLength(6);
    expect(add[0].term).toBe("term-0");
  });
});

describe("suggestWatchlist — removals", () => {
  it("proposes dropping a watched term that has gone quiet", () => {
    const movers = [mover("Sahel", 1, 9, "fading", "watch")];
    const { drop } = suggestWatchlist(movers, ["Sahel"], []);
    expect(drop).toHaveLength(1);
    expect(drop[0].reason).toBe("1 matches this week, down from 9");
  });

  it("words it differently when the term matched nothing at all", () => {
    const { drop } = suggestWatchlist([mover("Sahel", 0, 8, "fading", "watch")], ["Sahel"], []);
    expect(drop[0].reason).toBe("no matches this week, 8 the week before");
  });

  it("stays silent about a term with no history — a new entry is not a dead one", () => {
    // This is the important guard: absence of data looks identical to a term
    // added yesterday, and recommending its deletion would be wrong.
    expect(suggestWatchlist([], ["Just Added"], []).drop).toEqual([]);
  });

  it("never proposes dropping a term that is still steady or rising", () => {
    const movers = [mover("Hormuz", 9, 8, "steady", "watch"), mover("Taiwan", 12, 3, "rising", "watch")];
    expect(suggestWatchlist(movers, ["Hormuz", "Taiwan"], []).drop).toEqual([]);
  });

  it("honours a drop dismissal without suppressing the add suggestion for the same word", () => {
    const movers = [mover("Sahel", 0, 8, "fading", "watch")];
    expect(suggestWatchlist(movers, ["Sahel"], [dropKey("Sahel")]).drop).toEqual([]);
    // The two dismissal namespaces are independent.
    expect(dropKey("Sahel")).toBe("drop:sahel");
    expect(addKey(" Sahel ")).toBe("sahel");
  });

  it("only considers watch-kind movers, not topic mentions of the same word", () => {
    // A topic-kind row for "Sahel" says the word appeared; only the watch-kind
    // row says the user's watchlist actually matched something.
    const movers = [mover("Sahel", 0, 8, "fading", "topic")];
    expect(suggestWatchlist(movers, ["Sahel"], []).drop).toEqual([]);
  });
});
