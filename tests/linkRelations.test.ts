import { describe, it, expect } from "vitest";
import { parseWikiInner, extractWikiLinkRefs } from "../lib/linkRelations";

describe("parseWikiInner", () => {
  it("plain title", () => {
    expect(parseWikiInner("Clausewitz")).toEqual({ title: "Clausewitz", relation: null, note: null });
  });

  it("relation only", () => {
    expect(parseWikiInner("Jomini | contradicts")).toEqual({ title: "Jomini", relation: "contradicts", note: null });
  });

  it("relation with note", () => {
    expect(parseWikiInner("Jomini | contradicts: principles vs friction")).toEqual({
      title: "Jomini", relation: "contradicts", note: "principles vs friction",
    });
  });

  it("relation is case-insensitive", () => {
    expect(parseWikiInner("Corbett | EXTENDS: naval trinity").relation).toBe("extends");
  });

  it("unknown leading word becomes a note, never an error", () => {
    expect(parseWikiInner("Mahan | the concentration counterpoint")).toEqual({
      title: "Mahan", relation: null, note: "the concentration counterpoint",
    });
  });

  it("empty pipe segment is a plain link", () => {
    expect(parseWikiInner("Mahan | ")).toEqual({ title: "Mahan", relation: null, note: null });
  });

  it("note containing colons survives intact", () => {
    const r = parseWikiInner("Boyd | extends: tempo: the OODA argument");
    expect(r.note).toBe("tempo: the OODA argument");
  });
});

describe("extractWikiLinkRefs", () => {
  it("extracts refs in order with metadata, skipping empty titles", () => {
    const refs = extractWikiLinkRefs("see [[A | supports: x]] then [[B]] and [[ | contradicts]]");
    expect(refs).toEqual([
      { title: "A", relation: "supports", note: "x" },
      { title: "B", relation: null, note: null },
    ]);
  });
});
