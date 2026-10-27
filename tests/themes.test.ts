import { describe, it, expect } from "vitest";
import {
  validateThemeDraft, normalizePhrases, parsePhrasesText, matchTheme, themeVolume, readThemes, themeLine, themeLines, sortThemeReads,
  THEME_LEARNING_DAYS, THEME_MAX_PHRASES, type Theme,
} from "../lib/themes";
import type { NewsItem } from "../lib/types";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const item = (id: string, title: string, source: string, hoursAgo = 2, link = ""): NewsItem => ({ id, title, source, category: "social", pubDate: ago(hoursAgo), summary: "", link });
const theme = (over: Partial<Theme> = {}): Theme => ({ id: "t1", name: "Tanker surge", phrases: ["tanker surge", "KC-135 wave", "refueling bridge"], by: "ops@example.com", updatedAt: ago(48), ...over });

describe("validateThemeDraft / normalize", () => {
  it("needs a name and at least one phrase; caps the count", () => {
    expect(validateThemeDraft({})).toMatch(/Name the theme/);
    expect(validateThemeDraft({ name: "x", phrases: ["a"] })).toMatch(/Name the theme/);
    expect(validateThemeDraft({ name: "Tankers", phrases: "no" })).toMatch(/must be a list/);
    expect(validateThemeDraft({ name: "Tankers", phrases: ["", "  "] })).toMatch(/at least one phrase/);
    expect(validateThemeDraft({ name: "Tankers", phrases: ["a"] })).toMatch(/too short/);
    expect(validateThemeDraft({ name: "Tankers", phrases: Array.from({ length: THEME_MAX_PHRASES + 1 }, (_, i) => `phrase ${i}`) })).toMatch(/Keep it to/);
    expect(validateThemeDraft({ name: "Tankers", phrases: ["tanker surge"] })).toBeNull();
  });
  it("dedupes phrases case-insensitively and parses a comma / newline list", () => {
    expect(normalizePhrases(["KC-135", " kc-135 ", "", "wave"])).toEqual(["KC-135", "wave"]);
    expect(parsePhrasesText("tanker surge, KC-135 wave\nrefueling bridge;  ")).toEqual(["tanker surge", "KC-135 wave", "refueling bridge"]);
  });
});

describe("matchTheme — phrases, word-bounded, literal", () => {
  it("matches a phrase inside a sentence in the theme's own spelling and refuses a longer word", () => {
    const t = theme({ phrases: ["Hormuz", "KC-135"] });
    expect(matchTheme(t, "Transits through the Strait of Hormuz.")).toBe("Hormuz");
    expect(matchTheme(t, "the hormuzian coast")).toBeNull();
    expect(matchTheme(t, "6x kc-135 out of Mildenhall")).toBe("KC-135");
    expect(matchTheme(t, "a KC-135R launched")).toBeNull(); // the designator continues — not the phrase
  });
  it("treats punctuation in a phrase literally", () => {
    expect(matchTheme(theme({ phrases: ["C-17 (Globemaster)"] }), "two C-17 (Globemaster) jets")).toBe("C-17 (Globemaster)");
    expect(matchTheme(theme({ phrases: ["C.17"] }), "C-17 inbound")).toBeNull();
  });
});

describe("themeVolume — the theme's own normal, with a learning floor", () => {
  it("is UNKNOWN when the pool did not answer, learning below the floor, and never a surge while learning", () => {
    expect(themeVolume(9, { mean: 1, samples: 20, kind: "flat" }, false).state).toBe("unobserved");
    const l = themeVolume(9, { mean: 1, samples: THEME_LEARNING_DAYS - 1, kind: "flat" }, true);
    expect(l.state).toBe("learning");
    expect(l.why).toMatch(/day 7 of 7 · 9 today/);
    expect(themeVolume(9, null, true).why).toMatch(/day 1 of 7/);
  });
  it("surges at twice its own mean with a floor of three; quiet only against a real normal", () => {
    expect(themeVolume(2, { mean: 0.5, samples: 10, kind: "flat" }, true).state).toBe("normal"); // 2 ≥ 1 but below the floor
    expect(themeVolume(3, { mean: 0.5, samples: 10, kind: "flat" }, true).state).toBe("surge");
    expect(themeVolume(5, { mean: 4, samples: 10, kind: "flat" }, true).state).toBe("normal");
    expect(themeVolume(8, { mean: 4, samples: 10, kind: "flat" }, true).state).toBe("surge");
    expect(themeVolume(0, { mean: 2, samples: 10, kind: "flat" }, true)).toMatchObject({ state: "quiet" });
    expect(themeVolume(0, { mean: 0.3, samples: 10, kind: "flat" }, true).state).toBe("normal");
  });
});

describe("readThemes — the read over the own-source pool", () => {
  const pool: NewsItem[] = [
    item("a", "Big tanker surge tonight: 6x KC-135 out of Mildenhall heading east", "𝕏 @spotter1", 3, "https://x.com/spotter1/status/1"),
    item("b", "Another KC-135 wave reported over the Atlantic", "𝕏 @spotter2", 5),
    item("c", "Iran threatens to close Hormuz if the tanker surge continues", "📄 FP", 30),
    item("d", "Analysts say a refueling bridge could signal a longer deployment", "✉ War on the Rocks", 50),
    item("e", "Old tanker surge post", "𝕏 @spotter1", 24 * 9), // outside the window
    item("f", "Nothing about aircraft here", "𝕏 @spotter3", 1),
  ];
  it("counts reports, distinct sources, days and framing; keeps the newest as the lead", () => {
    const [r] = readThemes([theme()], pool, { nowMs: NOW });
    expect(r.reports).toBe(4);
    expect(r.handles).toBe(4);
    expect(r.corroborated).toBe(true);
    expect(r.framing).toEqual({ act: 2, threat: 1, analysis: 1, reversal: 0 });
    expect(r.lead?.id).toBe("a");
    expect(r.lead?.phrase).toBe("tanker surge");
    expect(r.lead?.kind).toBe("x");
    expect(r.matches.map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
    expect(Object.values(r.byDay).reduce((s, n) => s + n, 0)).toBe(4);
    expect(r.volume.today).toBe(2);
  });
  it("own sources only caps at watching and says so; wires agreeing lifts the cap, wires unread is said", () => {
    const [own] = readThemes([theme()], pool, { nowMs: NOW, wires: [] });
    expect(own.ownOnly).toBe(true);
    expect(own.line).toMatch(/own sources only — reads as watching at most/);
    const [agree] = readThemes([theme()], pool, { nowMs: NOW, wires: [item("w1", "US tanker surge to the Gulf continues", "Reuters", 4)] });
    expect(agree.wires).toBe(1);
    expect(agree.ownOnly).toBe(false);
    expect(agree.line).toMatch(/1 wire item agree/);
    const [unread] = readThemes([theme()], pool, { nowMs: NOW });
    expect(unread.wires).toBeNull();
    expect(unread.line).toMatch(/wires not read/);
  });
  it("a declared theme with no match still gets a read; an unobserved pool reads UNKNOWN, never quiet", () => {
    const [r] = readThemes([theme({ id: "t2", name: "Hormuz", phrases: ["Hormuz"] })], pool, { nowMs: NOW, baselines: { t2: { mean: 2, samples: 12, kind: "flat" } } });
    expect(r.reports).toBe(1); // item c names Hormuz
    const [none] = readThemes([theme({ id: "t3", name: "Guam", phrases: ["Guam"] })], pool, { nowMs: NOW, baselines: { t3: { mean: 2, samples: 12, kind: "flat" } } });
    expect(none.reports).toBe(0);
    expect(none.volume.state).toBe("quiet");
    expect(none.line).toMatch(/nothing in your sources in 7 d/);
    const [dead] = readThemes([theme()], [], { nowMs: NOW, observed: false });
    expect(dead.volume.state).toBe("unobserved");
    expect(dead.line).toBe("Tanker surge · UNKNOWN — own sources did not answer — UNKNOWN, not quiet");
  });
  it("orders surge, then corroborated, then by reports; prompt lines carry the newest item", () => {
    const reads = readThemes([theme(), theme({ id: "t2", name: "Hormuz", phrases: ["Hormuz"] })], pool, { nowMs: NOW, baselines: { t1: { mean: 0.5, samples: 10, kind: "flat" }, t2: { mean: 0.1, samples: 10, kind: "flat" } } });
    expect(reads[0].volume.state).toBe("normal"); // 2 today — below the floor of 3
    expect(sortThemeReads(reads).map((r) => r.id)).toEqual(["t1", "t2"]);
    const lines = themeLines(reads);
    expect(lines[0]).toMatch(/^- Tanker surge · normal — 4 items from 4 sources in 7 d · 2 act, 1 threat, 1 analysis · wires not read · newest: 𝕏 @spotter1: "Big tanker surge/);
    expect(themeLine(reads[1])).toMatch(/^Hormuz · normal — 1 item from 1 source in 7 d · 1 threat/);
  });
});
