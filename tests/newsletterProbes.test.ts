import { describe, it, expect } from "vitest";
import { subjectProbes, senderProbes } from "../lib/newsletterProbes";

describe("subjectProbes", () => {
  it("exact phrase, every word any order, phrase anywhere — 30 days each", () => {
    expect(subjectProbes("AMC News Clips").map((p) => p.query)).toEqual([
      'subject:"AMC News Clips" newer_than:30d',
      "subject:(AMC News Clips) newer_than:30d",
      '"AMC News Clips" newer_than:30d',
    ]);
  });
  it("a one-word subject has no loose-words probe; quotes and newlines never break the query", () => {
    expect(subjectProbes('Ear"ly\nBird').map((p) => p.key)).toEqual(["last30d", "looseWords", "anywhere"]);
    expect(subjectProbes("Brief").map((p) => p.key)).toEqual(["last30d", "anywhere"]);
    expect(subjectProbes("  ")).toEqual([]);
  });
});

describe("senderProbes (unchanged behaviour)", () => {
  it("30 days then the bare word", () => {
    expect(senderProbes("news@themerge.co").map((p) => p.query)).toEqual(["from:news@themerge.co newer_than:30d", "from:themerge newer_than:30d"]);
  });
});
