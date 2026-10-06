import { describe, it, expect } from "vitest";
import { appendEntry, entryMarkdown, parseEntries, latestEntry, entryCount, entryExcerpt } from "@/lib/docAppend";

const E1 = { date: "2026-10-05", text: "IRGCN seizures cluster 48–72 h after a designation.", source: "OSINT · X capture", sourceTitle: "Tanker seized off Fujairah", sourceUrl: "https://x.com/foo/status/1" };
const E2 = { date: "2026-10-06", text: "China is building a reversible export-control chokehold.\n\nSecond paragraph.", source: "News · Foreign Policy", sourceTitle: "Beijing's rare_earth play", sourceUrl: "https://foreignpolicy.com/a", thread: "PRC coercion" };

describe("entryMarkdown / appendEntry", () => {
  it("writes a dated heading, the text, and a refs line with title, source and thread link", () => {
    const md = entryMarkdown(E2);
    expect(md.split("\n")[0]).toBe("### 2026-10-06 — from News · Foreign Policy");
    expect(md).toContain("Second paragraph.");
    expect(md.split("\n").pop()).toBe("_Beijing's rare\\_earth play_ · [source](https://foreignpolicy.com/a) · thread [[PRC coercion]]");
  });
  it("appends at the END, never rewriting what is there; a blank doc starts with the entry", () => {
    const one = appendEntry("", E1);
    expect(one.startsWith("### 2026-10-05")).toBe(true);
    const two = appendEntry("# China references\n\nintro\n", E2);
    expect(two.startsWith("# China references\n\nintro\n\n### 2026-10-06")).toBe(true);
    expect(two.endsWith("\n")).toBe(true);
  });
  it("drops a non-http source url and never emits a bare link", () => {
    expect(entryMarkdown({ ...E1, sourceUrl: "javascript:alert(1)" })).not.toContain("[source]");
  });
});

describe("parseEntries / latestEntry", () => {
  it("reads back what appendEntry wrote, with the refs split out", () => {
    const content = appendEntry(appendEntry("# China references\n\nintro", E1), E2);
    const es = parseEntries(content);
    expect(es).toHaveLength(2);
    expect(es[0]).toMatchObject({ date: "2026-10-05", source: "OSINT · X capture", sourceTitle: "Tanker seized off Fujairah", sourceUrl: "https://x.com/foo/status/1" });
    expect(es[0].text).toBe("IRGCN seizures cluster 48–72 h after a designation.");
    expect(es[1].text).toBe("China is building a reversible export-control chokehold.\n\nSecond paragraph.");
    expect(es[1].sourceTitle).toBe("Beijing's rare_earth play");
    expect(entryCount(content)).toBe(2);
  });
  it("latestEntry is the newest DATE, not the last line; a doc with no entries is null", () => {
    const content = appendEntry(appendEntry("", E2), E1); // older appended after newer
    expect(latestEntry(content)?.date).toBe("2026-10-06");
    expect(latestEntry("# just a note\n\ntext")).toBeNull();
  });
  it("an entry ends at the next heading of any level", () => {
    const content = `${entryMarkdown(E1)}\n\n## Standing notes\n\nnot part of the entry`;
    expect(parseEntries(content)[0].text).toBe("IRGCN seizures cluster 48–72 h after a designation.");
  });
  it("entryExcerpt takes the first line, capped", () => {
    expect(entryExcerpt({ date: "2026-10-06", source: "x", text: "> quoted first line\nsecond" })).toBe("quoted first line");
    expect(entryExcerpt({ date: "2026-10-06", source: "x", text: "a".repeat(300) }, 20)).toHaveLength(20);
  });
});
