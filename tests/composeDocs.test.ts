import { describe, it, expect } from "vitest";
import {
  compileDocs,
  splitAtHeadings,
  buildMasterAfterSplit,
  miniMarkdownToHtml,
  renderNotebookHtml,
  type ComposeDoc,
  type ComposeOptions,
} from "../lib/composeDocs";

const AT = new Date("2026-07-05T12:00:00Z");

function doc(title: string, content: string, tags: string[] = []): ComposeDoc {
  return { id: title.toLowerCase(), title, content, tags, updatedAt: "2026-07-01T00:00:00.000Z" };
}

function opts(over: Partial<ComposeOptions> = {}): ComposeOptions {
  return {
    title: "Synthesis",
    titlePage: true,
    toc: true,
    rewriteLinks: true,
    includeMeta: false,
    footnoteExternal: true,
    compiledAt: AT,
    ...over,
  };
}

describe("compileDocs", () => {
  it("builds title page, toc, anchored sections", () => {
    const md = compileDocs([doc("Alpha", "Body A"), doc("Beta", "Body B")], opts());
    expect(md).toContain("# Synthesis");
    expect(md).toContain("_Compiled 2026-07-05 · 2 sections_");
    expect(md).toContain("- [1 · Alpha](#sec-1)");
    expect(md).toContain('<a id="sec-2"></a>');
    expect(md).toContain("## 2 · Beta");
    expect(md).toContain("Body B");
  });

  it("rewrites internal wiki links to anchors (case-insensitive)", () => {
    const md = compileDocs([doc("Alpha", "see [[beta]]"), doc("Beta", "hi")], opts());
    expect(md).toContain("[beta](#sec-2)");
    expect(md).not.toContain("[[beta]]");
  });

  it("footnotes external links once per target and appends definitions", () => {
    const md = compileDocs(
      [doc("Alpha", "see [[Gamma]] and again [[Gamma]] and [[Delta]]")],
      opts({ toc: false }),
    );
    expect(md).toContain("Gamma[^1]");
    expect(md).toContain("Delta[^2]");
    // repeat reference reuses footnote 1, no footnote 3
    expect(md).not.toContain("[^3]");
    expect(md).toContain("[^1]: Gamma — not included in this compile");
  });

  it("leaves links untouched when rewriting is off", () => {
    const md = compileDocs([doc("Alpha", "see [[Beta]]")], opts({ rewriteLinks: false, toc: false }));
    expect(md).toContain("[[Beta]]");
  });

  it("renders external links as plain text when footnotes are off", () => {
    const md = compileDocs([doc("Alpha", "see [[Gamma]]")], opts({ footnoteExternal: false, toc: false }));
    expect(md).toContain("see Gamma");
    expect(md).not.toContain("[^1]");
  });

  it("includes per-section meta when asked", () => {
    const md = compileDocs([doc("Alpha", "x", ["saass", "600"])], opts({ includeMeta: true, toc: false }));
    expect(md).toContain("_tags: saass, 600 · updated 2026-07-01_");
  });
});

describe("splitAtHeadings", () => {
  const body = [
    "Intro paragraph.",
    "",
    "## Sun Tzu",
    "shi and deception",
    "### sub-point",
    "detail",
    "",
    "## Clausewitz",
    "friction, trinity",
    "```",
    "## not a heading (in fence)",
    "```",
    "tail",
  ].join("\n");

  it("splits at exactly the requested level, keeping deeper headings inside", () => {
    const { preamble, sections } = splitAtHeadings(body, 2);
    expect(preamble).toBe("Intro paragraph.");
    expect(sections.map((s) => s.title)).toEqual(["Sun Tzu", "Clausewitz"]);
    expect(sections[0].body).toContain("### sub-point");
    expect(sections[1].body).toContain("tail");
  });

  it("ignores headings inside code fences", () => {
    const { sections } = splitAtHeadings(body, 2);
    expect(sections.some((s) => s.title.includes("not a heading"))).toBe(false);
    expect(sections[1].body).toContain("## not a heading (in fence)");
  });

  it("returns everything as preamble when no headings match", () => {
    const { preamble, sections } = splitAtHeadings("just text\nno headings", 2);
    expect(sections).toEqual([]);
    expect(preamble).toBe("just text\nno headings");
  });

  it("does not match deeper or shallower levels", () => {
    const { sections } = splitAtHeadings("# H1\n\n### H3\n", 2);
    expect(sections).toEqual([]);
  });
});

describe("buildMasterAfterSplit", () => {
  const sections = [
    { title: "A", body: "aaa" },
    { title: "B", body: "bbb" },
    { title: "C", body: "ccc" },
  ];

  it("replaces extracted sections with grouped wiki-link bullets, keeps the rest inline", () => {
    const out = buildMasterAfterSplit("Intro.", sections, new Set([0, 2]), 2);
    expect(out).toContain("Intro.");
    expect(out).toContain("- [[A]]");
    expect(out).toContain("## B\n\nbbb");
    expect(out).toContain("- [[C]]");
    // A extracted, B kept, C extracted → two separate bullet groups
    expect(out.indexOf("- [[A]]")).toBeLessThan(out.indexOf("## B"));
    expect(out.indexOf("## B")).toBeLessThan(out.indexOf("- [[C]]"));
  });

  it("groups consecutive extractions into one list block", () => {
    const out = buildMasterAfterSplit("", sections, new Set([0, 1]), 2);
    expect(out).toContain("- [[A]]\n- [[B]]");
  });
});

describe("miniMarkdownToHtml", () => {
  it("escapes raw HTML", () => {
    const html = miniMarkdownToHtml("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders headings, lists, code, links", () => {
    const html = miniMarkdownToHtml("## Head\n\n- item\n\n`code`\n\n[x](https://example.com)\n[in](#sec-1)");
    expect(html).toContain("<h2>Head</h2>");
    expect(html).toContain("<li>item</li>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('<a href="#sec-1">in</a>');
  });

  it("renders footnote markers and task items", () => {
    const html = miniMarkdownToHtml("ref[^2]\n\n- [x] done");
    expect(html).toContain('href="#fn-2"');
    expect(html).toContain("☑");
  });
});

describe("renderNotebookHtml", () => {
  it("produces a self-contained page with sections, toc, and footnotes", () => {
    const html = renderNotebookHtml(
      [doc("Alpha", "see [[Beta]] and [[Gamma]]"), doc("Beta", "text")],
      opts(),
    );
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<section id="sec-1">');
    expect(html).toContain('href="#sec-2"'); // internal link + toc
    expect(html).toContain('id="fn-1"');     // Gamma footnote
    expect(html).not.toContain("src=");      // no external assets
    expect(html).toContain("Compiled 2026-07-05");
  });
});
