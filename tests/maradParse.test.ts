import { describe, it, expect } from "vitest";
import { parseMaradTitle, regionChokepoints, gradeMarad, parseMaradItems, maradTextsFor, parseMaradPage, maradInEffect, maradPageExcerpts, MARAD_MAX_AGE_DAYS } from "../lib/maradParse";
import { htmlToText } from "../lib/ukmtoParse";
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
    expect(parseMaradTitle("2025-007a – Black Sea – Risk to Commercial Vessels")).toMatchObject({ number: "2025-007A", seq: 7, region: "Black Sea" });
    // The live feed's UPPER-case reissue suffix (skipped as "title shape" in the first production diag).
    expect(parseMaradTitle("2026-001A-Strait of Hormuz, Persian Gulf, Gulf of Oman, and Arabian Sea-Military Operations and Potential Retaliatory Strikes by Iranian Forces"))
      .toMatchObject({ number: "2026-001A", seq: 1, region: "Strait of Hormuz, Persian Gulf, Gulf of Oman, and Arabian Sea", topic: "Military Operations and Potential Retaliatory Strikes by Iranian Forces" });
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
    // The live feed's Black Sea title (2026-10-26 diag) graded null before this phrase was known.
    expect(gradeMarad("Military Combat Operations")).toMatchObject({ cls: "strike", modality: "threat" });
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
  it("names what it set aside and why, so a production diag explains itself", () => {
    const skipped: { title: string; reason: string }[] = [];
    parseMaradItems(ITEMS, TODAY, undefined, skipped);
    const by = Object.fromEntries(skipped.map((s) => [s.title.slice(0, 8), s.reason]));
    expect(by["2026-009"]).toBe("superseded");
    expect(by["2026-004"]).toBe("expired");
    expect(by["2026-014"]).toBe("foreign link");
    expect(skipped.find((s) => s.title.startsWith("Maritime Security"))?.reason).toBe("title shape");
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

describe("parseMaradPage / maradInEffect — the page decides 'in effect', the feed date is only a proxy", () => {
  // Synthetic page in the MSCI layout (the host is blocked from the sandbox):
  // numbered paragraphs, the Cancellation paragraph last.
  const PAGE = `<html><body><h1>2026-001A-Strait of Hormuz, Persian Gulf, Gulf of Oman, and Arabian Sea-Military Operations and Potential Retaliatory Strikes by Iranian Forces</h1>
    <div class="field"><strong>Date Issued:</strong> September 23, 2026</div>
    <p>1. References: U.S. Maritime Advisory 2026-001, which expired on 23 July 2026 and is superseded by this advisory.</p>
    <p>2. Issue: Military operations in the region continue to pose a threat to commercial vessels.</p>
    <p>4. Contact Information: NAVCENT. 5. Cancellation: This message will automatically expire on 23 March 2027.</p></body></html>`;
  it("reads the issue date and the Cancellation paragraph's expiry — not the superseded advisory's", () => {
    const info = parseMaradPage(htmlToText(PAGE));
    expect(info).toEqual({ issued: "2026-09-23", expires: "2027-03-23", cancelled: false });
  });
  it("accepts the date spellings MARAD uses, and nothing it does not", () => {
    expect(parseMaradPage("Cancellation. This advisory will automatically expire on March 1, 2027.").expires).toBe("2027-03-01");
    expect(parseMaradPage("Expiration date: 2027-03-01").expires).toBe("2027-03-01");
    expect(parseMaradPage("Expires 03/01/2027").expires).toBe("2027-03-01");
    expect(parseMaradPage("expires on 45 Foo 2027").expires).toBeNull();
    expect(parseMaradPage("nothing dated here")).toEqual({ issued: null, expires: null, cancelled: false });
  });
  it("a cancellation is read only in the passive voice — a reissue that CANCELS the earlier advisory is in effect", () => {
    expect(parseMaradPage("This advisory supersedes and cancels U.S. Maritime Advisory 2025-012.").cancelled).toBe(false);
    expect(parseMaradPage("This advisory has been superseded by 2026-013.").cancelled).toBe(true);
    expect(parseMaradPage("This message was cancelled on 1 October 2026.").cancelled).toBe(true);
  });
  it("excerpts for the diag surround the deciding words and merge overlapping hits", () => {
    const text = "Date Issued: September 23, 2026. 2. Issue: threats persist. 5. Cancellation: This message will automatically expire on 23 March 2027.";
    const wide = maradPageExcerpts(text, 30);
    expect(wide.length).toBe(1);                                 // Issued · Cancellation · expire all overlap at ±30 → one excerpt
    expect(wide[0]).toMatch(/Issued.*Cancellation.*expire on 23 March 2027/);
    const tight = maradPageExcerpts(text, 6);
    expect(tight.length).toBeGreaterThanOrEqual(2);              // far enough apart to stay separate
    expect(tight[0]).toMatch(/Issued/);
    expect(tight[tight.length - 1]).toMatch(/expire/);
    expect(maradPageExcerpts("nothing here")).toEqual([]);
  });
  it("the 2026-001A case: an old feed date with a future expiry on the page is IN EFFECT", () => {
    const d = maradInEffect({ date: "2026-01-14" }, { issued: "2026-09-23", expires: "2027-03-23", cancelled: false }, TODAY);
    expect(d).toMatchObject({ keep: true, expires: "2027-03-23", source: "page" });
    expect(d.note).toBe("page: expires 2027-03-23");
  });
  it("a past expiry on the page is expired even with a fresh feed date; a cancellation is cancelled", () => {
    expect(maradInEffect({ date: "2026-10-01" }, { issued: null, expires: "2026-10-25", cancelled: false }, TODAY)).toMatchObject({ keep: false, reason: "expired" });
    expect(maradInEffect({ date: "2026-10-01" }, { issued: null, expires: "2026-10-26", cancelled: false }, TODAY).keep).toBe(true);   // expires today → still in effect today
    expect(maradInEffect({ date: "2026-10-01" }, { issued: null, expires: null, cancelled: true }, TODAY)).toMatchObject({ keep: false, reason: "cancelled" });
  });
  it("without a page the age proxy decides and SAYS so; the page's issue date beats the feed's", () => {
    expect(maradInEffect({ date: "2026-01-14" }, null, TODAY)).toMatchObject({ keep: false, reason: "expired", source: "proxy" });
    expect(maradInEffect({ date: "2026-01-14" }, null, TODAY).note).toMatch(/page not read/);
    expect(maradInEffect({ date: "2026-09-23" }, null, TODAY)).toMatchObject({ keep: true, source: "proxy" });
    expect(maradInEffect({ date: "2026-01-14" }, { issued: "2026-09-23", expires: null, cancelled: false }, TODAY).keep).toBe(true);
    expect(maradInEffect({ date: null }, null, TODAY)).toMatchObject({ keep: true, source: null });
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
  it("one advisory per class per strait — two spellings of the same region are not two threats", () => {
    const two = parseMaradItems([
      { title: "2026-001A-Strait of Hormuz, Persian Gulf, Gulf of Oman, and Arabian Sea-Military Operations and Potential Retaliatory Strikes by Iranian Forces", link: "https://www.maritime.dot.gov/msci/2026-001a-strait-hormuz-persian-gulf", pubDate: "Mon, 05 Oct 2026 14:00:00 +0000" },
      { title: "2025-002A-Strait of Hormuz, Arabian Gulf, Gulf of Oman, and Arabian Sea-Potential Retaliatory Strikes by Iranian Forces", link: "https://www.maritime.dot.gov/msci/2025-002a-strait-hormuz-arabian-gulf", pubDate: "Mon, 05 Oct 2026 14:00:00 +0000" },
    ], TODAY);
    expect(two.length).toBe(2);                       // two region spellings → two advisories kept
    const texts = maradTextsFor("hormuz", two);
    expect(texts.length).toBe(1);                     // but one declared threat per class on the strait
    expect(texts[0].title).toMatch(/^MARAD 2026-001A/);
  });
  it("a strait no advisory names gets nothing; a topic that grades null is left out", () => {
    expect(maradTextsFor("panama", advs)).toEqual([]);
    const gps = parseMaradItems([{ title: "2026-020-Strait of Hormuz-GPS Interference", link: "https://www.maritime.dot.gov/msci/2026-020-strait-hormuz-gps-interference", pubDate: "Mon, 05 Oct 2026 14:00:00 +0000" }], TODAY);
    expect(gps[0].chokepoints).toEqual(["hormuz"]);
    expect(maradTextsFor("hormuz", gps)).toEqual([]);
  });
});
