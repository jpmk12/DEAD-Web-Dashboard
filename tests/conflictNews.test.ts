import { describe, it, expect } from "vitest";
import { scoreConflictNews } from "@/lib/conflictNews";
import type { NewsItem } from "@/lib/types";

const item = (title: string, pubDate = "2026-06-16T00:00:00Z"): NewsItem => ({
  id: title, title, source: "Reuters · local", category: "local", pubDate, summary: "", link: `https://ex/${encodeURIComponent(title)}`,
});

describe("scoreConflictNews", () => {
  it("flags escalation on active-hostilities phrasing", () => {
    const r = scoreConflictNews([item("Airstrikes pound the capital overnight"), item("Markets open higher")]);
    expect(r.count).toBe(1);
    expect(r.escalation).toBe(true);
    expect(r.latest?.title).toMatch(/Airstrikes/);
  });

  it("counts lower-intensity conflict without escalation", () => {
    const r = scoreConflictNews([item("Clashes reported near the border"), item("Militants ambush a patrol")]);
    expect(r.count).toBe(2);
    expect(r.escalation).toBe(false);
  });

  it("does not false-trigger on routine defense/diplomacy coverage", () => {
    const r = scoreConflictNews([item("Officials discuss missile program at talks"), item("New trade deal signed")]);
    expect(r.escalation).toBe(false);
    // "missile program" is not an attack phrase; only the broad set may catch it
    // — assert escalation specifically stays off.
  });

  it("returns the newest matching article as latest", () => {
    const r = scoreConflictNews([
      item("Shelling continues", "2026-06-10T00:00:00Z"),
      item("Drone strike kills commander", "2026-06-16T00:00:00Z"),
    ]);
    expect(r.latest?.title).toMatch(/Drone strike/);
  });

  it("empty input → zero, no escalation", () => {
    expect(scoreConflictNews([])).toEqual({ count: 0, escalation: false });
  });
});
