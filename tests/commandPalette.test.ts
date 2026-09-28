import { describe, it, expect } from "vitest";
import { rankCommands, scoreCommand, tokenize, groupResults, type Command } from "../lib/commandPalette";

const C: Command[] = [
  { id: "go:glance", group: "go", label: "Glance" },
  { id: "go:osint", group: "go", label: "OSINT", keywords: ["intel", "watch", "crisis map"] },
  { id: "act:brief", group: "act", label: "Morning brief", hint: "generate from loaded news" },
  { id: "act:capture", group: "act", label: "Quick capture", hint: "task, event, or note" },
  { id: "base:KWRI", group: "base", label: "McGuire (KWRI)", hint: "SITREP · New Jersey", keywords: ["KWRI", "WRI"] },
  { id: "base:OTBH", group: "base", label: "Al Udeid (OTBH)", hint: "SITREP · Qatar", keywords: ["OTBH"] },
  { id: "board:mp-1", group: "board", label: "CENTCOM · Iran", hint: "I&W board", keywords: ["iw", "warning"] },
  { id: "country:Iran", group: "country", label: "Iran", hint: "Regional · USCENTCOM", keywords: ["centcom"] },
  { id: "doc:1", group: "doc", label: "Iran escalation ladder", hint: "note" },
  { id: "doc:2", group: "doc", label: "Clausewitz — On War", hint: "theorist", keywords: ["clausewitz"] },
  { id: "prefs:you", group: "prefs", label: "Preferences — You", keywords: ["timezone", "watchlist", "alerts"] },
];

describe("rankCommands — empty query", () => {
  it("shows navigation and actions only, in group order", () => {
    const r = rankCommands("", C);
    expect(r.every((c) => c.group === "go" || c.group === "act")).toBe(true);
    expect(r[0].id).toBe("go:glance");
  });
});

describe("rankCommands — matching", () => {
  it("matches an ICAO through keywords", () => {
    expect(rankCommands("kwri", C)[0].id).toBe("base:KWRI");
  });

  it("requires every token to match (AND)", () => {
    const r = rankCommands("iran board", C);
    expect(r.map((c) => c.id)).toEqual(["board:mp-1"]);
  });

  it("ranks an exact label above a document that merely contains the word", () => {
    const r = rankCommands("iran", C);
    expect(r[0].id).toBe("country:Iran");
    expect(r.map((c) => c.id)).toContain("doc:1");
    expect(r.map((c) => c.id)).toContain("board:mp-1");
  });

  it("prefers a word-start match over a mid-word one", () => {
    const cmds: Command[] = [
      { id: "a", group: "doc", label: "Compartment" },
      { id: "b", group: "doc", label: "The art of war" },
    ];
    expect(rankCommands("art", cmds)[0].id).toBe("b");
  });

  it("falls back to a scattered subsequence that starts a word, for 3+ chars", () => {
    expect(scoreCommand(tokenize("clz"), C[9])).toBeGreaterThan(0);
    expect(scoreCommand(tokenize("lz"), C[9])).toBe(0);
    expect(scoreCommand(tokenize("xyz"), C[9])).toBe(0);
  });

  it("searches the hint too, so 'sitrep' lists the bases", () => {
    const r = rankCommands("sitrep", C);
    expect(r.map((c) => c.group)).toEqual(["base", "base"]);
  });

  it("returns nothing for a query nothing matches", () => {
    expect(rankCommands("zzzzzz", C)).toEqual([]);
  });

  it("respects the limit", () => {
    expect(rankCommands("a", C, 2)).toHaveLength(2);
  });

  it("ignores punctuation and accents in both query and label", () => {
    expect(rankCommands("centcom iran", C)[0].id).toBe("board:mp-1");
    expect(rankCommands("clausewitz on war", C)[0].id).toBe("doc:2");
  });
});

describe("groupResults", () => {
  it("groups consecutive items without reordering", () => {
    const g = groupResults(rankCommands("sitrep", C));
    expect(g).toHaveLength(1);
    expect(g[0].group).toBe("base");
    expect(g[0].items).toHaveLength(2);
  });
});
