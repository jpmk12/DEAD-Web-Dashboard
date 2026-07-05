import { describe, it, expect } from "vitest";
import { findUnlinkedMentions, linkifyMention, snippetAround, type MentionCandidate } from "../lib/docMentions";

const CANDS: MentionCandidate[] = [
  { id: "cvc", title: "Carl von Clausewitz — On War", names: ["Carl von Clausewitz — On War", "Clausewitz", "CvC"] },
  { id: "bob", title: "Battle of Britain", names: ["Battle of Britain"] },
  { id: "boyd", title: "John Boyd — Patterns of Conflict", names: ["John Boyd — Patterns of Conflict", "Boyd"] },
];

describe("findUnlinkedMentions", () => {
  it("finds alias mentions with word boundaries, case-insensitive", () => {
    const ms = findUnlinkedMentions("here clausewitz would object to the checklist", CANDS);
    expect(ms).toHaveLength(1);
    expect(ms[0].targetId).toBe("cvc");
    expect(ms[0].name).toBe("clausewitz"); // original casing preserved
  });

  it("ignores text already inside wiki links", () => {
    const ms = findUnlinkedMentions("linked [[Clausewitz]] already", CANDS);
    expect(ms).toHaveLength(0);
  });

  it("ignores mentions inside code fences", () => {
    const ms = findUnlinkedMentions("```\nClausewitz in code\n```\nprose here", CANDS);
    expect(ms).toHaveLength(0);
  });

  it("requires word boundaries", () => {
    const ms = findUnlinkedMentions("neoclausewitzian arguments", CANDS);
    expect(ms).toHaveLength(0);
  });

  it("one mention per target doc, multiple targets sorted by position", () => {
    const ms = findUnlinkedMentions("Boyd then Clausewitz then Clausewitz again", CANDS);
    expect(ms.map((m) => m.targetId)).toEqual(["boyd", "cvc"]);
  });

  it("respects dismissed names", () => {
    const ms = findUnlinkedMentions("Clausewitz here", CANDS, new Set(["clausewitz"]));
    expect(ms).toHaveLength(0);
  });

  it("skips names shorter than 3 chars", () => {
    const ms = findUnlinkedMentions("CvC shorthand", [{ id: "x", title: "T", names: ["Cv"] }]);
    expect(ms).toHaveLength(0);
  });
});

describe("linkifyMention", () => {
  it("wraps the occurrence in [[ ]] preserving original text (short form)", () => {
    const content = "here clausewitz objects";
    const [m] = findUnlinkedMentions(content, CANDS);
    expect(linkifyMention(content, m)).toBe("here [[clausewitz]] objects");
  });

  it("returns null when the doc changed under the mention", () => {
    const content = "here clausewitz objects";
    const [m] = findUnlinkedMentions(content, CANDS);
    expect(linkifyMention("totally different text!!", m)).toBeNull();
  });
});

describe("snippetAround", () => {
  it("trims, collapses whitespace, and ellipsises both ends", () => {
    const content = `${"x".repeat(200)} the  match here ${"y".repeat(200)}`;
    const idx = content.indexOf("match");
    const s = snippetAround(content, idx, 5);
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(s).toContain("the match here");
  });
});
