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

  it("caps overlong body text", () => {
    const r = parseArticleCapture(good({ text: "x ".repeat(50_000) }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.article.text.length).toBeLessThanOrEqual(60_000);
  });
});
