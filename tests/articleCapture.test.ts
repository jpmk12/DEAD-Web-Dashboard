import { describe, it, expect } from "vitest";
import { parseArticleCapture } from "../lib/articleCapture";

const NOW = "2026-07-19T12:00:00.000Z";
const good = (over: Record<string, unknown> = {}) => JSON.stringify({
  format: "dead-article",
  version: 1,
  url: "https://www.wsj.com/world/middle-east/some-iran-piece",
  title: "  Iran signals   escalation ",
  byline: "By A. Reporter",
  publishedAt: "2026-07-18T09:00:00Z",
  source: "wsj.com",
  text: "Tehran warned of retaliation ".repeat(4),
  capturedAt: NOW,
  ...over,
});

describe("parseArticleCapture", () => {
  it("accepts a well-formed article and normalizes it", () => {
    const r = parseArticleCapture(good());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.article.title).toBe("Iran signals escalation");       // whitespace collapsed
    expect(r.article.source).toBe("wsj.com");
    expect(r.article.byline).toBe("By A. Reporter");
    expect(r.article.publishedAt).toBe("2026-07-18T09:00:00.000Z");
    expect(r.article.url).toBe("https://www.wsj.com/world/middle-east/some-iran-piece");
    expect(r.article.id.startsWith("art_")).toBe(true);
  });

  it("is idempotent by canonical url (same url → same id)", () => {
    const a = parseArticleCapture(good());
    const b = parseArticleCapture(good({ title: "Different headline, same URL" }));
    expect(a.ok && b.ok && a.article.id === b.article.id).toBe(true);
  });

  it("rejects wrong format, bad JSON, missing title, and thin body", () => {
    expect(parseArticleCapture("{").ok).toBe(false);
    expect(parseArticleCapture(JSON.stringify({ format: "dead-x-capture" })).ok).toBe(false);
    expect(parseArticleCapture(good({ title: "" })).ok).toBe(false);
    expect(parseArticleCapture(good({ text: "too short" })).ok).toBe(false);
  });

  it("drops a non-https url but still succeeds (hashes on source+title), defaults source", () => {
    const r = parseArticleCapture(good({ url: "javascript:alert(1)", source: "" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.article.url).toBe("");
    expect(r.article.source).toBe("Analysis");
  });

  it("a digest page becomes one draft per substantial section, keyed by the page URL plus the heading; an ordinary article has none", () => {
    const sec = (n: number) => ({ heading: `Item ${n} about Hormuz`, text: `Paragraph one of item ${n}. `.repeat(8) });
    const r = parseArticleCapture(good({ title: "The world in brief", sections: [sec(1), sec(2), sec(3), { heading: "Thin", text: "too short" }, { heading: "x", text: "no heading ".repeat(20) }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sections).toHaveLength(3);
    expect(r.sections[0].title).toBe("Item 1 about Hormuz — The world in brief");
    expect(r.sections[0].url).toBe("https://www.wsj.com/world/middle-east/some-iran-piece#item-1-about-hormuz");
    expect(r.sections[0].id).not.toBe(r.article.id);
    expect(new Set(r.sections.map((s) => s.id)).size).toBe(3);
    expect(r.sections[0].publishedAt).toBe(r.article.publishedAt);
    // Re-capturing the same page yields the same section ids.
    const again = parseArticleCapture(good({ title: "The world in brief", sections: [sec(1), sec(2), sec(3)] }));
    expect(again.ok && again.sections[1].id).toBe(r.sections[1].id);
    // Below the floor it is an ordinary article.
    const two = parseArticleCapture(good({ sections: [sec(1), sec(2)] }));
    expect(two.ok && two.sections).toEqual([]);
    expect(parseArticleCapture(good()).ok && (parseArticleCapture(good()) as { sections: unknown[] }).sections).toEqual([]);
  });

  it("caps overlong body text", () => {
    const r = parseArticleCapture(good({ text: "x ".repeat(50_000) }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.article.text.length).toBeLessThanOrEqual(60_000);
  });
});
