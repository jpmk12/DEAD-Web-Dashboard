import { describe, it, expect } from "vitest";
import {
  htmlToText, parseUkmtoDate, parseUkmtoPosition, seaAreaIn, parseUkmtoText, parseUkmtoHtml,
  gradeUkmto, ukmtoGeoEvents, ukmtoTextsFor, parseUkmtoCapture, mergeUkmto, UKMTO_URL,
} from "../lib/ukmtoParse";
import { readActivity, readInterdiction } from "../lib/chokepointSignals";

// The one entry seen verbatim (2026-10-11) plus the shapes UKMTO's own VRA
// overview tables use. The host is unreachable from the sandbox, so these
// fixtures ARE the contract until a production diag or a capture refines it.
const PAGE = `
Recent Incidents
163-26 - ADVISORY
Incident Date: 10 OCT 2026
Incident Time: TBC
Source: Military authorities
UKMTO have received a report of an incident involving a tanker and military forces in the Gulf of Oman. Vessels are advised to consider the latest maritime security information and maintain awareness of the evolving operational environment. Authorities are aware and relevant investigations remain ongoing.
162-26 - ATTACK
Incident Date: 08 OCT 2026
Incident Time: 0715 UTC
Position: 12°40'N 043°20'E
Source: Master
UKMTO has received a report of a vessel being struck by an unknown projectile 15NM west of Mocha. The crew are reported safe. Vessels are advised to transit with caution.
161 - 26 SUSPICIOUS APPROACH
Incident Date: 05 OCT 2026
Incident Time: 1130 UTC
Source: Master
A merchant vessel was approached by two small craft with persons on board 60NM east of Fujairah. The craft closed to 100m before moving away.
160-26 - WARNING
Incident Date: 01/10/2026
Source: UKMTO
UKMTO is aware of reports of increased military activity in the Arabian Gulf. Vessels may experience communications interference.
`;

describe("htmlToText", () => {
  it("drops scripts, breaks on block ends and decodes entities", () => {
    const html = `<html><head><style>.x{}</style><script>var a=1;</script></head><body><div class="e"><h3>163-26 - ADVISORY</h3><p>Incident Date: 10 OCT 2026</p><p>Position: 26&deg;24&#39;N 056&deg;25&#39;E</p>Text &amp; more</div></body></html>`;
    const t = htmlToText(html);
    expect(t).toContain("163-26 - ADVISORY\nIncident Date: 10 OCT 2026\nPosition: 26°24'N 056°25'E");
    expect(t).toContain("Text & more");
    expect(t).not.toContain("var a=1");
  });
});

describe("parseUkmtoDate", () => {
  it("reads UKMTO's date spellings, UK day-first, never a guess", () => {
    expect(parseUkmtoDate("10 OCT 2026")).toBe("2026-10-10");
    expect(parseUkmtoDate("8 October 2026")).toBe("2026-10-08");
    expect(parseUkmtoDate("01/10/2026")).toBe("2026-10-01");
    expect(parseUkmtoDate("2026-10-10")).toBe("2026-10-10");
    expect(parseUkmtoDate("TBC")).toBeNull();
    expect(parseUkmtoDate("31 FEB 2026")).toBeNull();
    expect(parseUkmtoDate("")).toBeNull();
  });
});

describe("parseUkmtoPosition", () => {
  it("reads degrees-minutes in the spellings the VRA tables use", () => {
    expect(parseUkmtoPosition("26°24'N 056°25'E")).toEqual({ lat: 26.4, lon: 56.417 });
    expect(parseUkmtoPosition("26 ° 24'N 056 ° 25'E")).toEqual({ lat: 26.4, lon: 56.417 });
    expect(parseUkmtoPosition("12-40N 043-20E")).toEqual({ lat: 12.667, lon: 43.333 });
    expect(parseUkmtoPosition("1240N 04320E")).toEqual({ lat: 12.667, lon: 43.333 });
    expect(parseUkmtoPosition("Position: 26.4°N 056.42°E")).toEqual({ lat: 26.4, lon: 56.42 });
    expect(parseUkmtoPosition("05 12.5S 040 30.0E")).toEqual({ lat: -5.208, lon: 40.5 });
  });
  it("returns null for prose, times and a null-island pair", () => {
    expect(parseUkmtoPosition("60NM east of Fujairah at 0715 UTC")).toBeNull();
    expect(parseUkmtoPosition("00°00'N 000°00'E")).toBeNull();
    expect(parseUkmtoPosition("")).toBeNull();
  });
});

describe("seaAreaIn", () => {
  it("prefers the first-named water and the specific over the general", () => {
    expect(seaAreaIn("an incident in the Gulf of Oman")?.name).toBe("Gulf of Oman");
    expect(seaAreaIn("15NM west of Mocha in the Southern Red Sea")?.name).toBe("Mocha");
    expect(seaAreaIn("transiting the Bab-el-Mandeb")?.name).toBe("Bab el Mandeb");
    expect(seaAreaIn("nothing maritime here")).toBeNull();
  });
});

describe("parseUkmtoText — the page", () => {
  const list = parseUkmtoText(PAGE);

  it("finds every entry by its reference and keeps the page's labels", () => {
    expect(list.map((i) => i.ref)).toEqual(["163-26", "162-26", "161-26", "160-26"]);
    expect(list.map((i) => i.label)).toEqual(["ADVISORY", "ATTACK", "SUSPICIOUS APPROACH", "WARNING"]);
    expect(list[0].id).toBe("ukmto-163-26");
    expect(list[0].url).toBe(UKMTO_URL);
  });

  it("reads the labelled fields and leaves what is absent null", () => {
    expect(list[0].date).toBe("2026-10-10");
    expect(list[0].time).toBe("TBC");
    expect(list[0].reportedBy).toBe("Military authorities");
    expect(list[1].time).toBe("0715 UTC");
    expect(list[3].date).toBe("2026-10-01");
    expect(list[3].time).toBeNull();
  });

  it("takes a reported position over an area, and an area only when there is no position", () => {
    expect(list[1].placement).toBe("reported");
    expect(list[1].lat).toBeCloseTo(12.667, 2);
    expect(list[1].lon).toBeCloseTo(43.333, 2);
    expect(list[0].placement).toBe("area");
    expect(list[0].area).toBe("Gulf of Oman");
    expect(list[0].lat).toBe(24.8);
    expect(list[2].placement).toBe("area");
    expect(list[2].area).toBe("Fujairah");
  });

  it("keeps the narrative without the field labels", () => {
    expect(list[0].text).toMatch(/^UKMTO have received a report of an incident involving a tanker/);
    expect(list[0].text).not.toContain("Incident Date");
    expect(list[1].text).toContain("struck by an unknown projectile");
    expect(list[1].text).not.toContain("Position:");
  });

  it("does not read '60NM' or a time as a reference", () => {
    const refs = parseUkmtoText("60-26 NM east\n23-45 UTC\n").map((i) => i.ref);
    expect(refs).toEqual([]);
  });

  it("parses the same page from HTML", () => {
    const html = PAGE.split("\n").filter(Boolean).map((l) => `<p>${l}</p>`).join("");
    expect(parseUkmtoHtml(html).map((i) => i.ref)).toEqual(["163-26", "162-26", "161-26", "160-26"]);
  });

  it("dedupes a reference that appears twice", () => {
    expect(parseUkmtoText(PAGE + "\n" + PAGE).length).toBe(4);
  });
});

describe("gradeUkmto — official-record standing", () => {
  const list = parseUkmtoText(PAGE);
  it("grades by the label first: ATTACK is a strike act, SUSPICIOUS APPROACH an approach act", () => {
    expect(gradeUkmto(list[1])).toMatchObject({ cls: "strike", modality: "act" });
    expect(gradeUkmto(list[2])).toMatchObject({ cls: "approach", modality: "act" });
  });
  it("reads an ADVISORY's narrative when the label names nothing", () => {
    // "involving a tanker and military forces" — state forces closing on a merchant.
    expect(gradeUkmto(list[0])).toMatchObject({ cls: "approach", modality: "act" });
    expect(gradeUkmto({ label: "ADVISORY", text: "UKMTO reminds vessels to report to the VRA on entry." })).toBeNull();
  });
  it("a WARNING is a declared threat, not an act", () => {
    const r = gradeUkmto(list[3]);
    expect(r?.modality).toBe("threat");
    expect(r!.weight).toBeLessThan(gradeUkmto(list[2])!.weight);
  });
  it("a release reads as a reversal", () => {
    expect(gradeUkmto({ label: "UPDATE", text: "The vessel was released by Iranian authorities and has resumed its passage." })?.modality).toBe("reversal");
  });
  it("never lets the news grammar's mood markers demote a record", () => {
    // "may" would read as analysis in a headline; an ATTACK is an attack.
    expect(gradeUkmto({ label: "ATTACK", text: "Vessels may experience further incidents." })?.modality).toBe("act");
  });
});

describe("the shared grammar learned UKMTO's phrasing", () => {
  it("grades a wire headline quoting UKMTO as the act it is", () => {
    expect(readInterdiction("UKMTO: vessel struck by an unknown projectile off Yemen")).toMatchObject({ cls: "strike", modality: "act" });
    expect(readInterdiction("Tanker boarded by armed persons in the Gulf of Oman, UKMTO says")).toMatchObject({ cls: "seizure", modality: "act" });
    expect(readInterdiction("Merchant ship reports suspicious approach by small craft near Hormuz")).toMatchObject({ cls: "approach", modality: "act" });
  });
  it("still earns nothing on a bare mention", () => {
    expect(readInterdiction("UKMTO publishes its weekly overview")).toBeNull();
  });
});

describe("the join to the chokepoint read", () => {
  const list = parseUkmtoText(PAGE);
  const HORMUZ = { lat: 26.57, lon: 56.25, radiusKm: 320, keywords: ["hormuz"] };
  const BAB = { lat: 12.58, lon: 43.33, radiusKm: 600, keywords: ["red sea"] };

  it("events carry the source and say when a dot is a centroid", () => {
    const ev = ukmtoGeoEvents(list);
    expect(ev.every((e) => e.source === "UKMTO")).toBe(true);
    expect(ev.find((e) => e.id === "ukmto-163-26")?.title).toContain("placed at Gulf of Oman — no position in the report");
    expect(ev.find((e) => e.id === "ukmto-162-26")?.title).not.toContain("placed at");
    expect(ev.find((e) => e.id === "ukmto-162-26")?.date).toBe("2026-10-08");
  });

  it("gives each strait only the incidents inside its radius, pre-graded", () => {
    // 163 (Gulf of Oman centroid, ~265 km) and 161 (Fujairah) are inside
    // Hormuz's 320 km; 160 is placed at the Arabian Gulf centroid, ~445 km
    // away — the radius rule, not a parser gap.
    const h = ukmtoTextsFor(HORMUZ, list);
    expect(h.map((t) => t.title.slice(0, 12))).toEqual(["UKMTO 163-26", "UKMTO 161-26"]);
    expect(h.every((t) => t.read && t.source === "UKMTO")).toBe(true);
    const b = ukmtoTextsFor(BAB, list);
    expect(b.map((t) => t.title.slice(0, 12))).toEqual(["UKMTO 162-26"]);
  });

  it("an unplaced incident joins by the strait's keywords, not by distance", () => {
    const unplaced = parseUkmtoText("150-26 - ATTACK\nIncident Date: 02 OCT 2026\nA vessel was attacked while transiting toward the Hormuz approaches.\n");
    expect(unplaced[0].placement).toBe("area"); // "hormuz" is itself a named water
    const bare = parseUkmtoText("151-26 - ATTACK\nIncident Date: 02 OCT 2026\nA vessel was attacked at an undisclosed location.\n");
    expect(bare[0].placement).toBeNull();
    expect(ukmtoTextsFor(HORMUZ, bare)).toEqual([]);
    expect(ukmtoTextsFor({ ...HORMUZ, keywords: ["undisclosed"] }, bare).length).toBe(1);
  });

  it("readActivity takes the pre-graded read as-is and scores the strait", () => {
    const r = readActivity(HORMUZ, ukmtoTextsFor(HORMUZ, list), ukmtoGeoEvents(list), "2026-10-11");
    expect(r.acts).toBe(2);
    expect(r.threats).toBe(0);
    expect(r.lead?.cls).toBe("approach");
    expect(r.lead?.source).toBe("UKMTO");
    expect(r.events.length).toBe(2);
    expect(r.score).toBeGreaterThan(40);
  });
});

describe("parseUkmtoCapture — the browser path", () => {
  it("accepts a dead-ukmto capture from UKMTO's own host only", () => {
    const ok = parseUkmtoCapture(JSON.stringify({ format: "dead-ukmto", version: 1, source: { host: "www.ukmto.org", pageUrl: "https://www.ukmto.org/recent-incidents" }, text: PAGE }));
    expect(ok.ok).toBe(true);
    if (ok.ok) { expect(ok.incidents.length).toBe(4); expect(ok.incidents[0].url).toBe("https://www.ukmto.org/recent-incidents"); }
    expect(parseUkmtoCapture(JSON.stringify({ format: "dead-ukmto", source: { host: "evil.example" }, text: PAGE })).ok).toBe(false);
    expect(parseUkmtoCapture(JSON.stringify({ format: "dead-events", source: { host: "www.ukmto.org" }, text: PAGE })).ok).toBe(false);
    expect(parseUkmtoCapture("{").ok).toBe(false);
    expect(parseUkmtoCapture(JSON.stringify({ format: "dead-ukmto", source: { host: "www.ukmto.org" }, text: "nothing here" })).ok).toBe(false);
  });
  it("ignores a pageUrl that is not on UKMTO", () => {
    const r = parseUkmtoCapture(JSON.stringify({ format: "dead-ukmto", source: { host: "www.ukmto.org", pageUrl: "https://evil.example/x" }, text: PAGE }));
    expect(r.ok && r.incidents[0].url).toBe(UKMTO_URL);
  });
});

describe("mergeUkmto", () => {
  it("keeps a reported position over an area placement and sorts newest first", () => {
    const fetched = parseUkmtoText("162-26 - ATTACK\nIncident Date: 08 OCT 2026\nA vessel was struck 15NM west of Mocha.\n");
    const captured = parseUkmtoText("162-26 - ATTACK\nIncident Date: 08 OCT 2026\nPosition: 12°40'N 043°20'E\nA vessel was struck 15NM west of Mocha. Crew safe.\n163-26 - ADVISORY\nIncident Date: 10 OCT 2026\nGulf of Oman incident.\n");
    const m = mergeUkmto(fetched, captured);
    expect(m.map((i) => i.ref)).toEqual(["163-26", "162-26"]);
    expect(m[1].placement).toBe("reported");
    expect(m[1].text).toContain("Crew safe");
  });
});
