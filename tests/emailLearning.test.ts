import { describe, it, expect } from "vitest";
import { suggestSenderRules, correctionCounts, correctionExamples, whyLine, direction, actionKey, senderAddress, ruleKey, type Correction } from "../lib/emailLearning";

const DAY = 86_400_000;
const now = Date.parse("2026-10-06T12:00:00Z");
const c = (sender: string, set: Correction["prioritySet"], model: Correction["priorityModel"], daysAgo = 1, subject = "subject"): Correction =>
  ({ messageId: `${sender}-${daysAgo}-${set}`, accountEmail: "me@x.com", prioritySet: set, priorityModel: model, sender, subject, at: now - daysAgo * DAY });

describe("direction / senderAddress", () => {
  it("reads the direction against the model's call and never guesses without one", () => {
    expect(direction({ prioritySet: "High", priorityModel: "Low" })).toBe("up");
    expect(direction({ prioritySet: "Low", priorityModel: "Medium" })).toBe("down");
    expect(direction({ prioritySet: "High", priorityModel: "High" })).toBeNull();
    expect(direction({ prioritySet: "High", priorityModel: null })).toBeNull();
  });
  it("extracts the address from a display-name From", () => {
    expect(senderAddress("AFCYP <AFCYP@us.af.mil>")).toBe("afcyp@us.af.mil");
    expect(senderAddress("noreply@x.com")).toBe("noreply@x.com");
    expect(senderAddress("just a name")).toBe("");
  });
});

describe("suggestSenderRules", () => {
  const ctx = { vip: [], mute: [], dismissed: [], now };
  it("proposes Always High after three same-direction corrections, with evidence", () => {
    const rows = suggestSenderRules([c("AFCYP <afcyp@us.af.mil>", "High", "Low", 1), c("AFCYP <afcyp@us.af.mil>", "High", "Low", 3), c("AFCYP <afcyp@us.af.mil>", "High", "Medium", 9)], ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "high", sender: "afcyp@us.af.mil", count: 3, key: "rule:high:afcyp@us.af.mil" });
    expect(rows[0].evidence).toContain("3 emails");
  });
  it("needs three; two is not a pattern, and a sender corrected both ways earns nothing", () => {
    expect(suggestSenderRules([c("a@b.mil", "High", "Low"), c("a@b.mil", "High", "Low", 2)], ctx)).toHaveLength(0);
    expect(suggestSenderRules([c("a@b.mil", "High", "Low"), c("a@b.mil", "High", "Low", 2), c("a@b.mil", "High", "Low", 3), c("a@b.mil", "Low", "High", 4)], ctx)).toHaveLength(0);
  });
  it("ignores corrections outside the 30-day window and ones with no model call", () => {
    expect(suggestSenderRules([c("a@b.mil", "High", "Low", 40), c("a@b.mil", "High", "Low", 41), c("a@b.mil", "High", "Low", 42)], ctx)).toHaveLength(0);
    expect(suggestSenderRules([c("a@b.mil", "High", null), c("a@b.mil", "High", null), c("a@b.mil", "High", null)], ctx)).toHaveLength(0);
  });
  it("skips senders already covered by a rule (address or domain) and dismissed keys", () => {
    const cs = [c("a@b.mil", "High", "Low"), c("a@b.mil", "High", "Low", 2), c("a@b.mil", "High", "Low", 3)];
    expect(suggestSenderRules(cs, { ...ctx, vip: ["b.mil"] })).toHaveLength(0);
    expect(suggestSenderRules(cs, { ...ctx, vip: ["A@B.MIL"] })).toHaveLength(0);
    expect(suggestSenderRules(cs, { ...ctx, dismissed: [ruleKey("high", "a@b.mil")] })).toHaveLength(0);
    // a mute rule does not cover a HIGH proposal
    expect(suggestSenderRules(cs, { ...ctx, mute: ["b.mil"] })).toHaveLength(1);
  });
  it("lifts three distinct addresses on one domain to a domain rule, never on free mail", () => {
    const rows = suggestSenderRules([c("x@news.google.com", "Low", "Medium"), c("y@news.google.com", "Low", "High", 2), c("z@news.google.com", "Low", "Medium", 3), c("w@news.google.com", "Low", "Medium", 4)], ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "low", sender: "news.google.com", count: 4 });
    const free = suggestSenderRules([c("x@gmail.com", "Low", "Medium"), c("y@gmail.com", "Low", "Medium", 2), c("z@gmail.com", "Low", "Medium", 3)], ctx);
    expect(free).toHaveLength(0);
  });
});

describe("correctionCounts / correctionExamples", () => {
  it("tallies the window and splits by direction", () => {
    expect(correctionCounts([c("a@b.c", "High", "Low"), c("d@e.f", "Low", "High", 2), c("g@h.i", "High", "High", 3), c("j@k.l", "High", "Low", 60)], now)).toEqual({ total: 3, promoted: 1, demoted: 1 });
  });
  it("renders the most recent corrections first, capped, and nothing when there are none", () => {
    const cs = Array.from({ length: 20 }, (_, i) => c(`s${i}@x.mil`, "High", "Low", i + 1, `Subject ${i}`));
    const block = correctionExamples(cs, 5);
    expect(block.split("\n")).toHaveLength(6);
    expect(block).toContain("Subject 0");
    expect(block).not.toContain("Subject 5");
    expect(correctionExamples([c("a@b.c", "High", "High")])).toBe("");
  });
});

describe("whyLine / actionKey", () => {
  it("names which rule decided", () => {
    expect(whyLine({ source: "you", prioritySet: "High", priorityModel: "Low", modelWhy: "mass mailing" })).toBe("you set High (model said Low) · mass mailing");
    expect(whyLine({ source: "vip", modelWhy: "promo" })).toBe("Always High — VIP sender · promo");
    expect(whyLine({ source: "mute" })).toBe("Always Low — muted sender");
    expect(whyLine({ source: "model", modelWhy: "addressed to you · decision requested" })).toBe("addressed to you · decision requested");
    expect(whyLine({ source: "none" })).toContain("not triaged");
  });
  it("action keys are stable across whitespace and case", () => {
    expect(actionKey("m1", "Reply to  the  ATO cut")).toBe(actionKey("m1", "reply to the ato cut"));
    expect(actionKey("m1", "a")).not.toBe(actionKey("m2", "a"));
  });
});
