import { describe, it, expect } from "vitest";
import { parseMaradTitle, regionChokepoints, gradeMarad, parseMaradItems, maradTextsFor, MARAD_MAX_AGE_DAYS } from "../lib/maradParse";
import { readActivity } from "../lib/chokepointSignals";
import { CHOKEPOINTS } from "../lib/chokepoints";

// The feed is unreachable from the sandbox; these items follow the published
// RSS (title / link / pubDate) and MARAD's own title convention.
const ITEMS = [
  { title: "2026-013-Red Sea, Bab el Mandeb Strait, Gulf of Aden, Arabian Sea, and Somali Basin-Houthi Attacks on Commercial Vessels", link: "https://www.maritime.dot.gov/msci/2026-013-red-sea-bab-el-mandeb-strait-gulf-aden-arabian-sea-and-somali-basin-houthi-attacks", pubDate: "Mon, 05 Oct 2026 14:00:00 +0000" },
  { title: "2026-009-Red Sea, Bab el Mandeb Strait, Gulf of Aden, Arabian Sea, and Somali Basin-Houthi Attacks on Commercial Vessels", link: "https://www.maritime.dot.gov/msci/2026-009-red-sea-bab-el-mandeb-strait-gulf-aden-arabian-sea-and-somali-basin-houthi-attacks", pubDate: "Wed, 01 Jul 2026 14:00:00 +0000" },
  { title: "2026-011-Persian Gulf, Strait of Hormuz, Gulf of Oman, and Arabian Sea-Threats to Commercial Vessels by Iran and its Proxies", link: "https://www.maritime.dot.gov/msci/2026-011-persian-gulf-strait-hormuz-gulf-oman-and-arabian-sea-threats-commercial-vessels", pubDate: "Tue, 15 Sep 2026 14:00:00 +0000" },
  { title: "2026-012-Black Sea-Risk to Commercial Vessels from Military Activity and Mines", link: "https://www.maritime.dot.gov/msci/2026-012-black-sea-risk-commercial-vessels-military-activity-and-mines", pubDate: "Thu, 24 Sep 2026 14:00:00 +0000" },
  { title: "2026-010-Gulf of Guinea-Piracy and Armed Robbery", link: "https://www.maritime.dot.gov/msci/2026-010-gulf-guinea-piracy-and-armed-robbery", pubDate: "Mon, 10 Aug 2026 14:00:00 +0000" },
  { title: "2026-004-Worldwide-GPS Interference and Spoofing", link: "https://www.maritime.dot.gov/msci/2026-004-worldwide-gps-interference-and-spoofing", pubDate: "Mon, 02 Feb 2026 14:00:00 +0000" },
  { title: "Maritime Security Communications with Industry — program notice", link: "https://www.maritime.dot.gov/news/notice", pubDate: "Mon, 05 Oct 2026 14:00:00 +0000" },
  { title: "2026-014-Eastern Mediterranean-Hostilities", link: "https://evil.example/msci/2026-014-eastern-mediterranean", pubDate: "Mon, 05 Oct 2026 14:00:00 +0000" },
];
const TODAY = "2026-10-26";

describe("parseMaradTitle", () => {
  it("reads number / region / topic from MARAD's YYYY-NNN-Region-Topic form, incl. a reissue suffix and en dashes", () => {
    expect(parseMaradTitle(ITEMS[0].title)).toEqual({ number: "2026-013", year: 2026, seq: 13, region: "Red Sea, Bab el Mandeb Strait, Gulf of Aden, Arabian Sea, and Somali Basin", topic: "Houthi Attacks on Commercial Vessels" });
    expect(parseMaradTitle("2025-007a – Black Sea – Risk to Commercial Vessels")).toMatchObject({ number: "2025-007a", seq: 7, region: "Black Sea" });
    expect(parseMaradTitle("Program notice")).toBeNull();
  });
});

describe("regionChokepoints / gradeMarad", () => {
  it("places a region clause on the straits it names, with MARAD's own spellings", () => {
    expect(regionChokepoints("Red Sea, Bab el Mandeb Strait, Gulf of Aden, Arabian Sea, and Somali Basin")).toEqual(["babelmandeb"]);
    expect(regionChokepoints("Persian Gulf, Strait of Hormuz, Gulf of Oman, and Arabian Sea")).toEqual(["hormuz"]);
    expect(regionChokepoints("Black Sea")).toEqual(["bosphorus"]);
    expect(regionChokepoints("Gulf of Guinea")).toEqual([]);
    expect(regionChokepoints("Worldwide")).toEqual([]);
  });
  it("every mapped id is a real chokepoint", () => {
    const ids = new Set(CHOKEPOINTS.map((c) => c.id));
    for (const r of ["Red Sea", "Strait of Hormuz", "Suez Canal", "Black Sea", "Strait of Malacca", "Taiwan Strait", "Panama Canal"]) for (const id of regionChokepoints(r)) expect(ids.has(id)).toBe(true);
  });
  it("an advisory is a declared THREAT by the authority — never an act — classed by its topic", () => {
    expect(gradeMarad("Houthi Attacks on Commercial Vessels")).toMatchObject({ cls: "strike", modality: "threat" });
    expect(gradeMarad("Risk to Commercial Vessels from Military Activity and Mines")).toMatchObject({ cls: "mining", modality: "threat" });
    expect(gradeMarad("Piracy and Armed Robbery")).toMatchObject({ cls: "seizure", modality: "threat" });
    // The generic standing advisory names no instrument — the earliest-signal class, still a threat.
    expect(gradeMarad("Threats to Commercial Vessels by Iran and its Proxies")).toMatchObject({ cls: "approach", modality: "threat" });
    expect(gradeMarad("GPS Interference and Spoofing")).toBeNull();
    const act = gradeMarad("Attacks on Commercial Vessels")!;
    expect(act.weight).toBeLessThan(50);   // the threat discount applies
  });
});

describe("parseMaradItems", () => {
  const advs = parseMaradItems(ITEMS, TODAY);
  it("keeps the NEWEST advisory per region (a later number supersedes), drops foreign links and non-advisory titles", () => {
    const numbers = advs.map((a) => a.number);
    expect(numbers).toContain("2026-013");
    expect(numbers).not.toContain("2026-009");              // superseded by 013 for the same region
    expect(numbers).not.toContain("2026-014");              // link not on maritime.dot.gov
    expect(advs.find((a) => a.number === "2026-013")!.date).toBe("2026-10-05");
    expect(advs.every((a) => a.url.startsWith("https://www.maritime.dot.gov/msci/"))).toBe(true);
  });
  it("drops an advisory older than the auto-expiry window — a stale advisory is not a standing threat", () => {
    expect(advs.map((a) => a.number)).not.toContain("2026-004");   // Feb → >185 d by late October
    const fresh = parseMaradItems(ITEMS, "2026-03-01");
    expect(fresh.map((a) => a.number)).toContain("2026-004");
    expect(MARAD_MAX_AGE_DAYS).toBeGreaterThan(150);
  });
  it("a region no chokepoint covers is still an advisory, just off the strait board", () => {
    const guinea = advs.find((a) => a.number === "2026-010")!;
    expect(guinea.chokepoints).toEqual([]);
    expect(guinea.read).toMatchObject({ cls: "seizure", modality: "threat" });
  });
});

describe("maradTextsFor → the shared read", () => {
  const advs = parseMaradItems(ITEMS, TODAY);
  it("hands the strait a pre-graded threat text that readActivity uses AS-IS (a threat, never an act)", () => {
    const hormuz = CHOKEPOINTS.find((c) => c.id === "hormuz")!;
    const texts = maradTextsFor("hormuz", advs);
    expect(texts.length).toBe(1);
    expect(texts[0].source).toBe("MARAD");
    expect(texts[0].title).toMatch(/^MARAD 2026-011: Persian Gulf/);
    const read = readActivity(hormuz, texts, [], TODAY);
    expect(read.threats).toBe(1);
    expect(read.acts).toBe(0);
    expect(read.score).toBeGreaterThan(0);
    expect(read.lead?.source).toBe("MARAD");
  });
  it("a strait no advisory names gets nothing; a topic that grades null is left out", () => {
    expect(maradTextsFor("panama", advs)).toEqual([]);
    const gps = parseMaradItems([{ title: "2026-020-Strait of Hormuz-GPS Interference", link: "https://www.maritime.dot.gov/msci/2026-020-strait-hormuz-gps-interference", pubDate: "Mon, 05 Oct 2026 14:00:00 +0000" }], TODAY);
    expect(gps[0].chokepoints).toEqual(["hormuz"]);
    expect(maradTextsFor("hormuz", gps)).toEqual([]);
  });
});
