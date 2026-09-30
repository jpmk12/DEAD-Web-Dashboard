import { describe, it, expect } from "vitest";
import { shouldUpgradeBrief } from "../lib/briefingUpgrade";

const now = { articles: 20, newsletters: 4, osint: 6, events: 3 };

describe("shouldUpgradeBrief — one bounded regeneration of a thin day-cached brief", () => {
  it("upgrades when the cached brief had no newsletters or no OSINT and they exist now", () => {
    expect(shouldUpgradeBrief({ inputs: { articles: 20, newsletters: 0, osint: 6, events: 3 } }, now)).toBe(true);
    expect(shouldUpgradeBrief({ inputs: { articles: 20, newsletters: 4, osint: 0, events: 3 } }, now)).toBe(true);
    expect(shouldUpgradeBrief({ inputs: { articles: 20, newsletters: 0, osint: 0, events: 0 } }, now)).toBe(true);
  });
  it("never upgrades twice, and never a brief with no recorded inputs", () => {
    expect(shouldUpgradeBrief({ inputs: { articles: 20, newsletters: 0, osint: 0, events: 0 }, upgraded: true }, now)).toBe(false);
    expect(shouldUpgradeBrief({}, now)).toBe(false);
    expect(shouldUpgradeBrief(null, now)).toBe(false);
  });
  it("a moving feed is not a missing section — some → more never upgrades", () => {
    expect(shouldUpgradeBrief({ inputs: { articles: 20, newsletters: 2, osint: 1, events: 3 } }, now)).toBe(false);
  });
  it("the inputs still being absent now does not upgrade either", () => {
    expect(shouldUpgradeBrief({ inputs: { articles: 20, newsletters: 0, osint: 0, events: 3 } }, { ...now, newsletters: 0, osint: 0 })).toBe(false);
  });
});
