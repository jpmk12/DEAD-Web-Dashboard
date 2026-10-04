import { describe, it, expect } from "vitest";
import { shouldUpgradeBrief, generationsOf, isSectionless, MAX_GENERATIONS } from "../lib/briefingUpgrade";

const now = { articles: 20, newsletters: 4, osint: 6, events: 3 };
const full = { keyDevelopments: ["a"], topStories: ["b"], suggestedFocus: ["c"] };

describe("shouldUpgradeBrief — bounded regeneration of a thin day-cached brief", () => {
  it("upgrades when the cached brief had no newsletters, no OSINT or no ARTICLES and they exist now", () => {
    expect(shouldUpgradeBrief({ ...full, inputs: { articles: 20, newsletters: 0, osint: 6, events: 3 } }, now)).toBe(true);
    expect(shouldUpgradeBrief({ ...full, inputs: { articles: 20, newsletters: 4, osint: 0, events: 3 } }, now)).toBe(true);
    expect(shouldUpgradeBrief({ ...full, inputs: { articles: 0, newsletters: 4, osint: 6, events: 3 } }, now)).toBe(true);
    expect(shouldUpgradeBrief({ ...full, inputs: { articles: 20, newsletters: 0, osint: 0, events: 0 } }, now)).toBe(true);
  });
  it("never a brief with no recorded inputs", () => {
    expect(shouldUpgradeBrief({}, now)).toBe(false);
    expect(shouldUpgradeBrief(null, now)).toBe(false);
  });
  it("a moving feed is not a missing section — some → more never upgrades a brief WITH sections", () => {
    expect(shouldUpgradeBrief({ ...full, inputs: { articles: 2, newsletters: 2, osint: 1, events: 3 } }, now)).toBe(false);
  });
  it("the inputs still being absent now does not upgrade either", () => {
    expect(shouldUpgradeBrief({ ...full, inputs: { articles: 20, newsletters: 0, osint: 0, events: 3 } }, { ...now, newsletters: 0, osint: 0 })).toBe(false);
  });

  describe("the headline-only brief (2026-10-04)", () => {
    const headlineOnly = { inputs: { articles: 0, newsletters: 0, osint: 0, events: 2 }, keyDevelopments: [], topStories: [], suggestedFocus: [] };
    it("is sectionless", () => {
      expect(isSectionless(headlineOnly)).toBe(true);
      expect(isSectionless(full)).toBe(false);
      expect(isSectionless({ keyDevelopments: ["x"] })).toBe(false);
    });
    it("upgrades as soon as articles exist", () => {
      expect(shouldUpgradeBrief(headlineOnly, { articles: 12, newsletters: 0, osint: 0, events: 2 })).toBe(true);
    });
    it("a sectionless brief built from SOME articles still upgrades when more arrive (truncated output)", () => {
      const thin = { ...headlineOnly, inputs: { articles: 3, newsletters: 4, osint: 2, events: 2 } };
      expect(shouldUpgradeBrief(thin, { articles: 20, newsletters: 4, osint: 2, events: 2 })).toBe(true);
      expect(shouldUpgradeBrief(thin, { articles: 3, newsletters: 4, osint: 2, events: 2 })).toBe(false);
    });
  });

  describe("generation cap", () => {
    it("reads the legacy upgraded flag as two generations and a missing count as one", () => {
      expect(generationsOf({ upgraded: true })).toBe(2);
      expect(generationsOf({ inputs: now })).toBe(1);
      expect(generationsOf({ generations: 3 })).toBe(3);
      expect(generationsOf(null)).toBe(0);
    });
    it("stops at MAX_GENERATIONS even when inputs say upgrade", () => {
      const thin = { inputs: { articles: 0, newsletters: 0, osint: 0, events: 0 }, keyDevelopments: [], topStories: [], suggestedFocus: [] };
      expect(shouldUpgradeBrief({ ...thin, generations: MAX_GENERATIONS - 1 }, now)).toBe(true);
      expect(shouldUpgradeBrief({ ...thin, generations: MAX_GENERATIONS }, now)).toBe(false);
    });
    it("a legacy upgraded brief (two generations) still gets the third when articles were never seen", () => {
      const thin = { inputs: { articles: 0, newsletters: 4, osint: 6, events: 0 }, upgraded: true, keyDevelopments: [], topStories: [], suggestedFocus: [] };
      expect(shouldUpgradeBrief(thin, now)).toBe(true);
    });
  });
});
