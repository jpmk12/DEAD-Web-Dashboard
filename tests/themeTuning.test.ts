import { describe, it, expect } from "vitest";
import {
  tuneRows, previewPhrases, phraseStats, candidateTerms, suggestPhrases, exclusionCandidates, backfillSeries, coverageOf,
  type ThemeFeedback,
} from "../lib/themeTuning";
import type { NewsItem } from "../lib/types";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const H = 3_600_000;
const n = (id: string, title: string, source: string, hoursAgo = 2): NewsItem => ({ id, title, source, category: "social", pubDate: new Date(NOW - hoursAgo * H).toISOString(), summary: "", link: `https://x.com/s/${id}` });

// A pool: tanker posts that also name Al Udeid / aerial refueling; one that
// names those terms but not the phrase (a miss); unrelated chatter.
const pool: NewsItem[] = [
  n("1", "KC-46 tanker surge at Al Udeid, aerial refueling tracks busy", "𝕏 @spotA", 3),
  n("2", "Tanker surge continues: Al Udeid ramp full, aerial refueling over Iraq", "𝕏 @spotB", 10),
  n("3", "Another tanker surge into Al Udeid with aerial refueling support", "✉ Mobility Brief", 30),
  n("4", "tanker surge noted by a third handle, Al Udeid again", "𝕏 @spotC", 50),
  n("5", "Six KC-135s landed at Al Udeid for aerial refueling of the strike package", "𝕏 @spotD", 5),
  n("6", "Al Udeid aerial refueling orbit stood up overnight", "𝕏 @spotE", 70),
  n("7", "Oil prices rise on Gulf shipping concerns", "✉ Markets Daily", 4),
  n("8", "Election results in Moldova", "📄 FP", 20),
  n("9", "IRGC seized an oil tanker near Hormuz", "𝕏 @news1", 6),
  n("10", "Weather: heat wave across the Gulf", "feed Gulf News", 8),
  ...Array.from({ length: 30 }, (_, i) => n(`r${i}`, `Unrelated item number ${i} about domestic politics and sport`, `feed F${i % 5}`, 12 + i * 8)),
];

describe("tuneRows / coverage", () => {
  it("windows, dedupes and reads source kinds", () => {
    const rows = tuneRows([...pool, pool[0], n("old", "tanker surge", "𝕏 @x", 24 * 20)], NOW);
    expect(rows.find((r) => r.id === "old")).toBeUndefined();
    expect(rows.filter((r) => r.id === "1")).toHaveLength(1);
    expect(rows[0].t).toBeGreaterThanOrEqual(rows[1].t);
    const cov = coverageOf(rows, NOW);
    expect(cov.byKind.x?.items).toBeGreaterThan(0);
    expect(cov.days).toBeGreaterThan(9);
  });
});

describe("previewPhrases", () => {
  it("counts what a phrase set would catch, per phrase, with exclusions", () => {
    const rows = tuneRows(pool, NOW);
    const p = previewPhrases(["tanker surge", "nonexistent phrase"], [], rows, NOW);
    expect(p.total).toBe(4);
    expect(p.sources).toBe(4);
    expect(p.byPhrase).toEqual([{ phrase: "tanker surge", hits: 4 }, { phrase: "nonexistent phrase", hits: 0 }]);
    const q = previewPhrases(["tanker"], ["oil tanker"], rows, NOW);
    expect(q.excluded).toBe(1);
    expect(q.samples.every((s) => !/oil tanker/i.test(s.title))).toBe(true);
  });
});

describe("phraseStats", () => {
  it("flags a dead phrase only over a week of coverage, and a noisy one only past the judged floor", () => {
    const rows = tuneRows(pool, NOW);
    const fb: ThemeFeedback[] = ["1", "2", "3"].map((id) => ({ themeId: "t", itemId: id, verdict: "no", phrase: "tanker surge", by: "", at: "" }));
    const s = phraseStats({ phrases: ["tanker surge", "zzz qqq"], exclude: [] }, rows, fb, NOW);
    expect(s[0].hits).toBe(4);
    expect(s[0].flag).toBe("noisy");
    expect(s[0].precision).toBe(0);
    expect(s[1].flag).toBe("dead");
    const two = phraseStats({ phrases: ["tanker surge"], exclude: [] }, rows, fb.slice(0, 2), NOW);
    expect(two[0].precision).toBeNull();
    expect(two[0].flag).toBeNull();
  });
});

describe("candidateTerms", () => {
  it("reads designators, capitalised runs with connectors and plain bigrams; drops stopwords, urls and handles", () => {
    const t = candidateTerms("KC-46 over the Strait of Hormuz near Al Udeid — aerial refueling https://t.co/x @someone");
    expect(t.has("kc-46")).toBe(true);
    expect(t.has("strait of hormuz")).toBe(true);
    expect(t.has("al udeid")).toBe(true);
    expect(t.has("aerial refueling")).toBe(true);
    expect([...t.keys()].some((k) => k.includes("t.co") || k.includes("someone"))).toBe(false);
    expect(t.has("the")).toBe(false);
  });
});

describe("suggestPhrases", () => {
  it("needs three matched items before suggesting anything", () => {
    const rows = tuneRows(pool.slice(0, 2), NOW);
    const s = suggestPhrases({ phrases: ["tanker surge"] }, rows);
    expect(s.suggestions).toEqual([]);
    expect(s.note).toMatch(/need 3/);
  });
  it("suggests a term common in the theme and rare elsewhere that would add items, and finds the misses", () => {
    const rows = tuneRows(pool, NOW);
    const s = suggestPhrases({ phrases: ["tanker surge"] }, rows);
    const terms = s.suggestions.map((x) => x.term.toLowerCase());
    expect(terms).toContain("al udeid");
    const au = s.suggestions.find((x) => x.term.toLowerCase() === "al udeid")!;
    expect(au.inMatched).toBe(4);
    expect(au.wouldAdd).toBe(2);
    expect(au.why).toMatch(/in 4 of 4 matched items/);
    expect(s.misses.map((m) => m.id).sort()).toEqual(["5", "6"]);
  });
  it("never suggests a dismissed term, nor one from a ✕-marked item, nor a phrase already covered", () => {
    const rows = tuneRows(pool, NOW);
    const s = suggestPhrases({ phrases: ["tanker surge"], dismissed: ["Al Udeid"] }, rows);
    expect(s.suggestions.map((x) => x.term.toLowerCase())).not.toContain("al udeid");
    const covered = suggestPhrases({ phrases: ["tanker surge", "Al Udeid"] }, rows);
    expect(covered.suggestions.map((x) => x.term.toLowerCase())).not.toContain("al udeid");
    // Reject two of the four matched items: "Al Udeid" now sits in 2 → below the floor.
    const rej = suggestPhrases({ phrases: ["tanker surge"] }, rows, { rejected: new Set(["1", "2"]) });
    expect(rej.suggestions.map((x) => x.term.toLowerCase())).not.toContain("al udeid");
  });
});

describe("exclusionCandidates", () => {
  it("offers the matched phrase with its neighbouring word, never a stopword", () => {
    expect(exclusionCandidates("IRGC seized an oil tanker near Hormuz", "tanker")).toEqual(["oil tanker", "tanker near"]);
    expect(exclusionCandidates("the tanker", "tanker")).toEqual([]);
  });
});

describe("backfillSeries", () => {
  it("rebuilds the peak trailing-24-h count only over days every carrying source kind reaches", () => {
    const xs = Array.from({ length: 10 }, (_, d) => n(`x${d}`, "tanker surge", `𝕏 @h${d}`, 24 * d + 6));
    // Newsletters carry the theme too but only reach 3 days back.
    const nl = Array.from({ length: 3 }, (_, d) => n(`nl${d}`, "tanker surge brief", "✉ Brief", 24 * d + 4));
    const bf = backfillSeries({ phrases: ["tanker surge"] }, tuneRows([...xs, ...nl], NOW), NOW);
    expect(bf.points.length).toBeGreaterThan(0);
    // The newsletter's oldest item is ~2 d 4 h ago → the first FULL day after it.
    expect(bf.from).toBe("2026-11-07");
    expect(bf.points.every((p) => p.day < "2026-11-08")).toBe(true);
    expect(bf.today).toBeGreaterThanOrEqual(2);
    // X alone reaches ~9 days.
    const xOnly = backfillSeries({ phrases: ["tanker surge"] }, tuneRows(xs, NOW), NOW);
    expect(xOnly.points.length).toBeGreaterThanOrEqual(7);
    expect(xOnly.note).toMatch(/backfilled/);
  });
  it("writes nothing from an empty pool", () => {
    const bf = backfillSeries({ phrases: ["tanker surge"] }, [], NOW);
    expect(bf.points).toEqual([]);
    expect(bf.from).toBeNull();
  });
});
