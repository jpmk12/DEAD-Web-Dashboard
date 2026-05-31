import { describe, it, expect } from "vitest";
import type { NewsItem } from "@/lib/types";
import {
  hashCtx, sanitiseCandidates, deterministicSplit, pickCritical, topAffinity,
  CANDIDATE_LIMIT, CRITICAL_COUNT,
} from "@/lib/overviewCurate";

function item(id: string, over: Partial<NewsItem> = {}): NewsItem {
  return { id, title: `T${id}`, source: "S", category: "defense", summary: "", pubDate: "", link: "", ...over };
}

describe("hashCtx", () => {
  it("is stable for the same input", () => {
    expect(hashCtx("role: analyst")).toBe(hashCtx("role: analyst"));
  });
  it("differs when the context changes", () => {
    expect(hashCtx("watchlist: Taiwan")).not.toBe(hashCtx("watchlist: Ukraine"));
  });
  it("handles empty input", () => {
    expect(typeof hashCtx("")).toBe("string");
  });
});

describe("sanitiseCandidates", () => {
  it("returns [] for non-arrays", () => {
    expect(sanitiseCandidates(null)).toEqual([]);
    expect(sanitiseCandidates("nope")).toEqual([]);
  });
  it("drops entries missing id/title/source", () => {
    const out = sanitiseCandidates([{ id: "a", title: "t", source: "s" }, { title: "no id" }, { id: "b" }]);
    expect(out.map((i) => i.id)).toEqual(["a"]);
  });
  it("caps the count at CANDIDATE_LIMIT", () => {
    const many = Array.from({ length: CANDIDATE_LIMIT + 20 }, (_, i) => ({ id: `i${i}`, title: "t", source: "s" }));
    expect(sanitiseCandidates(many)).toHaveLength(CANDIDATE_LIMIT);
  });
  it("bounds oversized fields", () => {
    const [out] = sanitiseCandidates([{ id: "a", title: "x".repeat(999), source: "y".repeat(999), summary: "z".repeat(999), link: "l".repeat(9999) }]);
    expect(out.title.length).toBe(300);
    expect(out.source.length).toBe(80);
    expect(out.summary.length).toBe(600);
    expect(out.link.length).toBe(2000);
  });
  it("omits imageUrl when not a string", () => {
    const [out] = sanitiseCandidates([{ id: "a", title: "t", source: "s" }]);
    expect(out.imageUrl).toBeUndefined();
  });
});

describe("deterministicSplit", () => {
  it("puts the top CRITICAL_COUNT in critical, the rest in discover", () => {
    const items = Array.from({ length: CRITICAL_COUNT + 5 }, (_, i) => item(`i${i}`));
    const split = deterministicSplit(items);
    expect(split.critical).toHaveLength(CRITICAL_COUNT);
    expect(split.discover).toHaveLength(5);
    expect(split.mode).toBe("deterministic");
  });
});

describe("pickCritical", () => {
  const sorted = [item("a"), item("b"), item("c"), item("d")];
  it("keeps known ids in the model's order", () => {
    const res = pickCritical({ critical: ["c", "a"] }, sorted);
    expect(res?.critical.map((i) => i.id)).toEqual(["c", "a"]);
    expect(res?.mode).toBe("ai");
  });
  it("puts the rest into discover in deterministic order", () => {
    const res = pickCritical({ critical: ["c", "a"] }, sorted);
    expect(res?.discover.map((i) => i.id)).toEqual(["b", "d"]);
  });
  it("dedupes and ignores unknown ids", () => {
    const res = pickCritical({ critical: ["a", "a", "zzz", "b"] }, sorted);
    expect(res?.critical.map((i) => i.id)).toEqual(["a", "b"]);
  });
  it("returns null when no usable ids (so caller falls back)", () => {
    expect(pickCritical({ critical: ["zzz"] }, sorted)).toBeNull();
    expect(pickCritical({}, sorted)).toBeNull();
    expect(pickCritical({ critical: "notarray" }, sorted)).toBeNull();
  });
});

describe("topAffinity", () => {
  it("keeps strong dislikes (sorts by absolute value, not descending)", () => {
    // -40 is a strong signal; a descending sort would drop it after positives.
    const out = topAffinity({ likeA: 5, likeB: 3, hate: -40 }, 2);
    expect(out).toContain("hate: -40");
  });
  it("formats positive scores with a + sign", () => {
    expect(topAffinity({ war: 7 }, 5)).toBe("war: +7");
  });
  it("filters out zero-score entries", () => {
    expect(topAffinity({ a: 0, b: 2 }, 5)).toBe("b: +2");
  });
  it("respects the limit", () => {
    const out = topAffinity({ a: 9, b: 8, c: 7, d: 6 }, 2);
    expect(out.split(", ")).toHaveLength(2);
  });
});
