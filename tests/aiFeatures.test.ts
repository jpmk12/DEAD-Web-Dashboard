import { describe, it, expect } from "vitest";
import type { UserPrefs } from "@/lib/types";
import { isFeatureEnabled, ALL_AI_FEATURES, AI_FEATURE_LABELS } from "@/lib/aiFeatures";

const prefs = (over: Partial<UserPrefs> = {}): UserPrefs =>
  ({ aiEnabled: true, aiFeatureToggles: {}, ...over } as UserPrefs);

describe("isFeatureEnabled", () => {
  it("fails open when prefs are unavailable", () => {
    expect(isFeatureEnabled("news_overview", null)).toBe(true);
    expect(isFeatureEnabled("news_overview", undefined)).toBe(true);
  });
  it("master kill switch disables everything", () => {
    expect(isFeatureEnabled("news_overview", prefs({ aiEnabled: false }))).toBe(false);
  });
  it("per-feature toggle off disables just that feature", () => {
    expect(isFeatureEnabled("news_overview", prefs({ aiFeatureToggles: { news_overview: false } }))).toBe(false);
    expect(isFeatureEnabled("briefing", prefs({ aiFeatureToggles: { news_overview: false } }))).toBe(true);
  });
  it("defaults to enabled", () => {
    expect(isFeatureEnabled("news_overview", prefs())).toBe(true);
  });
});

describe("AI feature registry", () => {
  it("every feature in ALL_AI_FEATURES has a UI label (no missing-label holes)", () => {
    for (const f of ALL_AI_FEATURES) {
      expect(AI_FEATURE_LABELS[f], `missing label for ${f}`).toBeTruthy();
    }
  });
  it("includes the new news_overview feature", () => {
    expect(ALL_AI_FEATURES).toContain("news_overview");
  });
});
