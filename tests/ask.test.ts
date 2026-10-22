import { describe, it, expect } from "vitest";
import { resolveAsk, isWarningShaped, normalizeQuestion, type AskCatalogue } from "../lib/askResolve";
import { renderAskPack, renderAskUser, ASK_SYSTEM, ASK_PACK_MAX_CHARS } from "../lib/askFormat";

const CAT: AskCatalogue = {
  boards: [
    { id: "centcom-iran", label: "CENTCOM · Iran", countries: ["Iran", "Iraq", "Israel", "Yemen"], aor: "CENTCOM", chokepointId: "hormuz", spacePowers: ["IRN"] },
    { id: "mp-russia", label: "EUCOM · Russia / Baltics", countries: ["Russia", "Poland", "Lithuania"], aor: "EUCOM", chokepointId: "bosphorus", spacePowers: ["RUS"] },
  ],
  chokepoints: [{ id: "hormuz", name: "Strait of Hormuz", keywords: ["hormuz", "persian gulf"] }, { id: "bosphorus", name: "Turkish Straits", keywords: ["bosphorus", "black sea"] }],
  countries: ["Iran", "Iraq", "Israel", "Yemen", "Russia", "Poland", "Lithuania", "China", "North Korea", "Brazil"],
};

describe("resolveAsk — the question's entities and shape", () => {
  it("places 'how likely is conflict with Iran' on the Iran board, Hormuz and the economy tile", () => {
    const r = resolveAsk("How likely is conflict with Iran?", CAT);
    expect(r.countries).toEqual(["Iran"]);
    expect(r.boardIds).toEqual(["centcom-iran"]);
    expect(r.aors).toEqual(["CENTCOM"]);
    expect(r.actorIds).toEqual(["iran"]);
    expect(r.warningShaped).toBe(true);
    expect(r.wantsProbability).toBe(true);
    expect(r.unplaced).toEqual([]);
  });
  it("reads 'what indicators show Russia positioning for war' as an indicators question on the Russia board", () => {
    const r = resolveAsk("What indicators are you seeing that show Russia positioning for war?", CAT);
    expect(r.boardIds).toEqual(["mp-russia"]);
    expect(r.wantsIndicators).toBe(true);
    expect(r.wantsProbability).toBe(false);
    expect(r.topics).toContain("posture");
  });
  it("resolves the wires' names — Tehran, the Kremlin, the Houthis — and straits by keyword", () => {
    expect(resolveAsk("Is Tehran preparing to close Hormuz?", CAT).countries).toEqual(["Iran"]);
    expect(resolveAsk("Is Tehran preparing to close Hormuz?", CAT).chokepointIds).toEqual(["hormuz"]);
    expect(resolveAsk("Kremlin mobilisation signals?", CAT).boardIds).toEqual(["mp-russia"]);
    expect(resolveAsk("Houthi threat to shipping", CAT).countries).toEqual(["Yemen"]);
  });
  it("a command name without a country matches every board in that command", () => {
    const r = resolveAsk("What is moving in CENTCOM this week?", CAT);
    expect(r.boardIds).toEqual(["centcom-iran"]);
    expect(r.aors).toEqual(["CENTCOM"]);
  });
  it("says what it could not place instead of guessing", () => {
    const r = resolveAsk("Is Ruritania mobilising against Brazil?", CAT);
    expect(r.countries).toEqual(["Brazil"]);
    expect(r.boardIds).toEqual([]);
    expect(r.unplaced).toContain("Ruritania");
  });
  it("normalises a question for the cache key", () => {
    expect(normalizeQuestion("  How LIKELY is conflict with Iran?! ")).toBe("how likely is conflict with iran");
  });
});

describe("isWarningShaped — the client's auto-route", () => {
  it("routes warning questions and leaves scheduling alone", () => {
    expect(isWarningShaped("How likely is conflict with Iran?")).toBe(true);
    expect(isWarningShaped("what indicators show russia positioning for war")).toBe(true);
    expect(isWarningShaped("Move my 3pm with Dave to Thursday")).toBe(false);
    expect(isWarningShaped("what's on my calendar tomorrow")).toBe(false);
    expect(isWarningShaped("war")).toBe(false);
  });
});

describe("the pack format and the contract", () => {
  it("labels every section, states UNAVAILABLE, and truncates from the bottom", () => {
    const text = renderAskPack([
      { surface: "OSINT › Commands › I&W · CENTCOM · Iran", text: "Level WATCH", asOf: "2026-10-22T10:00:00Z" },
      { surface: "Glance › 7-day demand horizon", text: "", unavailable: true },
    ], "2026-10-22T10:05:00Z");
    expect(text).toContain("## OSINT › Commands › I&W · CENTCOM · Iran (as of 2026-10-22T10:00:00Z)");
    expect(text).toContain("## Glance › 7-day demand horizon\nUNAVAILABLE this pass.");
    const big = renderAskPack([
      { surface: "first", text: "x".repeat(ASK_PACK_MAX_CHARS - 500) },
      { surface: "second", text: "y".repeat(2000) },
      { surface: "third", text: "z" },
    ], "2026-10-22T10:05:00Z");
    expect(big).toContain("## first");
    expect(big).not.toContain("## second");
    expect(big).toContain("2 further section(s) omitted");
  });
  it("the contract forbids a bare probability and demands the surfaces by name", () => {
    expect(ASK_SYSTEM).toMatch(/Do NOT give a probability/);
    expect(ASK_SYSTEM).toMatch(/decision-log call/);
    expect(ASK_SYSTEM).toMatch(/Not observed/);
    expect(ASK_SYSTEM).toMatch(/never as evidence of calm/);
    const u = renderAskUser("How likely is conflict with Iran?", { countries: ["Iran"], aors: ["CENTCOM"], boards: ["CENTCOM · Iran"], unplaced: [], wantsProbability: true }, "PACK");
    expect(u).toContain("QUESTION: How likely is conflict with Iran?");
    expect(u).toContain("apply the probability rule");
    expect(u.endsWith("PACK")).toBe(true);
  });
});
