import { describe, it, expect } from "vitest";
import type { NewsItem } from "@/lib/types";
import type { ArticlePrefs } from "@/lib/articlePrefs";
import { scoreArticle, sortByPreference, extractKeywords } from "@/lib/articlePrefs";

function item(over: Partial<NewsItem> = {}): NewsItem {
  return { id: "1", title: "Title", source: "Reuters", category: "defense", summary: "", pubDate: "2024-01-01", link: "", ...over };
}
const prefs = (over: Partial<ArticlePrefs> = {}): ArticlePrefs => ({ keywords: {}, sources: {}, lastUpdated: "", ...over });

describe("extractKeywords", () => {
  it("drops stop-words and short tokens", () => {
    const kws = extractKeywords("The new hypersonic missile test");
    expect(kws).not.toContain("the");   // stop word
    expect(kws).not.toContain("new");   // stop word
    expect(kws).toContain("hypersonic");
    expect(kws).toContain("missile");
  });
});

describe("scoreArticle", () => {
  it("adds keyword affinity from title + summary", () => {
    const s = scoreArticle(item({ title: "hypersonic test" }), prefs({ keywords: { hypersonic: 3, test: 1 } }));
    expect(s).toBe(4);
  });
  it("weights source affinity x2", () => {
    const s = scoreArticle(item({ source: "Reuters" }), prefs({ sources: { Reuters: 5 } }));
    expect(s).toBe(10);
  });
  it("adds +10 for a watchlist title match (case-insensitive)", () => {
    const s = scoreArticle(item({ title: "Crisis in TAIWAN strait" }), prefs(), ["taiwan"]);
    expect(s).toBe(10);
  });
  it("can go negative for disliked keywords/sources", () => {
    const s = scoreArticle(item({ title: "boring update", source: "Spam" }), prefs({ keywords: { boring: -2, update: -1 }, sources: { Spam: -3 } }));
    expect(s).toBe(-2 - 1 + (-3) * 2);
  });
});

describe("sortByPreference", () => {
  it("returns input untouched when there are no preferences", () => {
    const items = [item({ id: "a" }), item({ id: "b" })];
    expect(sortByPreference(items, prefs(), [])).toEqual(items);
  });
  it("orders higher-scoring articles first", () => {
    const items = [
      item({ id: "low", title: "routine", source: "X" }),
      item({ id: "high", title: "hypersonic", source: "X" }),
    ];
    const out = sortByPreference(items, prefs({ keywords: { hypersonic: 9 } }), []);
    expect(out[0].id).toBe("high");
  });
  it("breaks ties by recency", () => {
    const items = [
      item({ id: "older", pubDate: "2024-01-01" }),
      item({ id: "newer", pubDate: "2024-06-01" }),
    ];
    // watchlist gives both the same +10; tie-break should put newer first.
    const out = sortByPreference(items, prefs(), ["title"]);
    expect(out[0].id).toBe("newer");
  });
});
