import { describe, it, expect } from "vitest";
import { profileSeeds, proposeThemes, fieldShortName, PROPOSE_MIN_ITEMS } from "../lib/themeProposals";
import { tuneRows } from "../lib/themeTuning";
import type { NewsItem } from "../lib/types";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const H = 3_600_000;
const n = (id: string, title: string, source: string, hoursAgo = 2): NewsItem => ({ id, title, source, category: "social", pubDate: new Date(NOW - hoursAgo * H).toISOString(), summary: "", link: `https://x.com/s/${id}` });

// Jordan items cluster on Azraq / Tower 22 drones; Hormuz items; an ICAO no
// post uses; filler.
const pool: NewsItem[] = [
  n("j1", "Drone intercepted near Azraq, Jordan says air defence active", "𝕏 @a", 3),
  n("j2", "Jordanian air force downs drone over Azraq; Tower 22 on alert", "𝕏 @b", 8),
  n("j3", "Tower 22 in Jordan targeted again, Azraq sirens", "✉ Gulf Brief", 20),
  n("j4", "Amman confirms debris fell near Azraq after Tower 22 attack", "𝕏 @c", 30),
  n("j5", "Muwaffaq Salti reported busy; Jordan airspace reopened", "𝕏 @d", 40),
  n("j6", "Jordan border quiet as Amman hosts talks", "📄 FP", 50),
  n("j7", "Azraq and Tower 22: what the drone attacks on Jordan mean", "📄 WOTR", 60),
  n("j8", "Jordan and Egypt sign water deal", "feed Reuters", 80),
  n("j9", "Amman inflation eases, Jordan central bank says", "✉ Econ Daily", 90),
  n("j10", "Jordanian king meets EU leaders on refugees", "feed AP", 100),
  n("j11", "Jordan tourism rebounds in Petra", "📄 Travel", 110),
  n("j12", "Amman traffic plan approved by Jordan cabinet", "𝕏 @j", 120),
  n("j13", "Jordan wins regional football match", "feed Sport", 130),
  n("x1", "Azraq again — Tower 22 says a second drone was downed overnight", "𝕏 @e", 70),
  n("x2", "Tower 22 resupplied after Azraq strike, reports say", "𝕏 @f", 75),
  n("h1", "IRGC boats shadow tanker in the Strait of Hormuz", "𝕏 @g", 4),
  n("h2", "Hormuz transits fall as insurers raise premiums", "✉ Shipping Wk", 9),
  n("h3", "Strait of Hormuz: navy escort for two tankers", "𝕏 @h", 15),
  n("h4", "Persian Gulf tanker traffic thin, Hormuz watchers say", "𝕏 @i", 25),
  n("h5", "Hormuz incident reported by mariners", "feed Maritime", 35),
  ...Array.from({ length: 40 }, (_, i) => n(`r${i}`, `Unrelated item ${i} about domestic politics and sport scores`, `feed F${i % 6}`, 12 + i * 6)),
];
const rows = tuneRows(pool, NOW);

describe("profileSeeds", () => {
  it("makes one seed per declared thing, with its other names", () => {
    const seeds = profileSeeds({
      hub: { icao: "ojaq", label: "Muwaffaq Salti AB, Jordan" },
      starCountries: ["Jordan"],
      aois: [{ name: "Iran & Hormuz", intensity: "primary", countries: ["Iran", "Jordan"], chokepointIds: ["hormuz"] }],
      watchlist: ["KC-46", "x"],
    });
    const hub = seeds.find((s) => s.key === "field:OJAQ")!;
    expect(hub.phrases).toEqual(["OJAQ", "Muwaffaq Salti"]);
    expect(hub.name).toBe("OJAQ · Muwaffaq Salti");
    const jordan = seeds.filter((s) => s.key === "country:jordan");
    expect(jordan).toHaveLength(1); // declared twice, one seed
    expect(jordan[0].phrases).toContain("Amman");
    expect(jordan[0].origin).toBe("star-country"); // the stronger origin wins
    expect(jordan[0].label).toContain("Iran & Hormuz");
    expect(seeds.find((s) => s.key === "chokepoint:hormuz")?.phrases).toContain("Strait of Hormuz");
    expect(seeds.find((s) => s.key === "country:iran")?.phrases).toContain("IRGC");
    expect(seeds.some((s) => s.key === "term:x")).toBe(false); // too short
  });

  it("short field names", () => {
    expect(fieldShortName("Al Udeid AB, Qatar")).toBe("Al Udeid");
    expect(fieldShortName("Ramstein Air Base (ETAR)")).toBe("Ramstein");
  });
});

describe("proposeThemes", () => {
  const seeds = profileSeeds({
    hub: { icao: "OJAQ", label: "Muwaffaq Salti AB, Jordan" },
    aois: [{ name: "Iran & Hormuz", intensity: "primary", countries: ["Jordan"], chokepointIds: ["hormuz"] }],
    watchlist: ["Moldova"],
  });

  it("proposes seeds with evidence and says why the others were left out", () => {
    const res = proposeThemes(seeds, rows, []);
    const jordan = res.proposals.find((p) => p.key === "seed:country:jordan")!;
    expect(jordan).toBeTruthy();
    expect(jordan.items).toBeGreaterThanOrEqual(PROPOSE_MIN_ITEMS);
    expect(jordan.sources).toBeGreaterThanOrEqual(2);
    expect(jordan.why).toMatch(/area of interest “Iran & Hormuz”/);
    expect(jordan.why).toMatch(/no overlap with your themes/);
    // Names that appear nowhere are dropped from the phrases and said.
    expect(jordan.droppedPhrases).not.toContain("Jordan");
    expect(res.proposals.find((p) => p.key === "seed:chokepoint:hormuz")).toBeTruthy();
    // The hub: one post names it, from one source — below the floor.
    expect(res.proposals.find((p) => p.key === "seed:field:OJAQ")).toBeUndefined();
    expect(res.skipped.find((s) => s.key === "field:OJAQ")?.reason).toMatch(/needs 5/);
    expect(res.skipped.find((s) => s.key === "term:moldova")?.reason).toMatch(/names nothing/);
  });

  it("adds strong co-terms from the evidence and offers a narrower theme", () => {
    const res = proposeThemes(seeds, rows, []);
    const jordan = res.proposals.find((p) => p.key === "seed:country:jordan")!;
    const added = jordan.added.map((a) => a.term.toLowerCase());
    expect(added.some((t) => t === "azraq" || t === "tower")).toBe(true);
    const narrow = res.proposals.find((p) => p.kind === "narrow" && p.key.startsWith("narrow:country:jordan:"));
    expect(narrow).toBeTruthy();
    expect(narrow!.phrases.map((p) => p.toLowerCase())).toEqual(expect.arrayContaining(["azraq", "tower"]));
    expect(narrow!.name.startsWith("Jordan · ")).toBe(true);
  });

  it("drops a proposal an existing theme already catches", () => {
    const res = proposeThemes(seeds, rows, [{ name: "Hormuz watch", phrases: ["Hormuz", "Strait of Hormuz"] }]);
    expect(res.proposals.find((p) => p.key === "seed:chokepoint:hormuz")).toBeUndefined();
    expect(res.skipped.find((s) => s.key === "chokepoint:hormuz")?.reason).toMatch(/Hormuz watch/);
  });

  it("never proposes a declined key again, and interest only orders", () => {
    const res = proposeThemes(seeds, rows, [], { dismissed: new Set(["seed:country:jordan"]) });
    expect(res.proposals.find((p) => p.key === "seed:country:jordan")).toBeUndefined();
    const base = proposeThemes(seeds, rows, []);
    const boosted = proposeThemes(seeds, rows, [], { boosts: { "country:jordan": 20 } });
    expect(boosted.proposals.map((p) => p.key).sort()).toEqual(base.proposals.map((p) => p.key).sort());
    const j = (r: typeof base) => r.proposals.find((p) => p.key === "seed:country:jordan")!.score;
    expect(j(boosted)).toBeGreaterThan(j(base));
  });

  it("an empty pool proposes nothing and says so", () => {
    expect(proposeThemes(seeds, [], []).note).toMatch(/no stored items/);
  });
});
