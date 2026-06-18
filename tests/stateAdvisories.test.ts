import { describe, it, expect } from "vitest";
import { parseAdvisories } from "@/lib/stateAdvisories";

// The live State feed (travel.state.gov/_res/rss/TAsTWs.xml) carries the threat
// level in an ATTRIBUTED <category domain="Threat-Level"> element. rss-parser
// returns attributed elements as objects, which used to throw and blank every
// advisory. These fixtures mirror the real shape so the regression stays fixed.
const xml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>Travel Advisories</title>
<item>
<title>Iran Travel Advisory</title>
<link>https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/iran-travel-advisory.html</link>
<description><![CDATA[<p>Do not travel to Iran due to <b>the risk of kidnapping</b>, <b>arbitrary arrest</b>, and <b>detention</b>.</p>]]></description>
<category domain="Threat-Level">Level 4: Do Not Travel</category>
<category domain="Country-Tag">IR</category>
<pubDate>Mon, 16 Jun 2026 12:00:00 EST</pubDate>
<dc:identifier>iran</dc:identifier>
</item>
<item>
<title>Ukraine Travel Advisory</title>
<link>https://travel.state.gov/.../ukraine-travel-advisory.html</link>
<description><![CDATA[<p>Do not travel to Ukraine. The Department ordered the departure of family members.</p>]]></description>
<category domain="Threat-Level">Level 4: Do Not Travel</category>
<category domain="Country-Tag">UP</category>
<pubDate>Sun, 15 Jun 2026 12:00:00 EST</pubDate>
</item>
<item>
<title>France Travel Advisory</title>
<link>https://travel.state.gov/.../france-travel-advisory.html</link>
<description><![CDATA[<p>Exercise increased caution in France due to terrorism and civil unrest.</p>]]></description>
<category domain="Threat-Level">Level 2: Exercise Increased Caution</category>
<category domain="Country-Tag">FR</category>
<pubDate>Sat, 14 Jun 2026 12:00:00 EST</pubDate>
</item>
</channel>
</rss>`;

describe("parseAdvisories (attributed-category RSS)", () => {
  it("does not throw on attributed <category> elements and returns all items", async () => {
    const out = await parseAdvisories(xml);
    expect(out.length).toBe(3);
  });

  it("extracts country + level from the Threat-Level category", async () => {
    const out = await parseAdvisories(xml);
    const iran = out.find((a) => a.country === "Iran");
    expect(iran).toBeTruthy();
    expect(iran!.level).toBe(4);
    expect(iran!.link).toMatch(/iran-travel-advisory/);
  });

  it("detects ordered departure from the description", async () => {
    const ukraine = (await parseAdvisories(xml)).find((a) => a.country === "Ukraine")!;
    expect(ukraine.orderedDeparture).toBe(true);
  });

  it("keeps lower-level advisories too (e.g. France Level 2)", async () => {
    const france = (await parseAdvisories(xml)).find((a) => a.country === "France")!;
    expect(france.level).toBe(2);
  });
});
