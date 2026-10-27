import { describe, it, expect } from "vitest";
import {
  htmlToText, parseUkmtoDate, parseUkmtoPosition, seaAreaIn, parseUkmtoText, parseUkmtoHtml,
  gradeUkmto, ukmtoGeoEvents, ukmtoTextsFor, parseUkmtoCapture, mergeUkmto, UKMTO_URL,
  fitUkmtoRow, UKMTO_COLUMN_WIDTHS, parseUkmtoApi, apiRecords, apiRecordToIncident, parseDddmmss,
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

describe("parseUkmtoApi — the SCCD feed, read tolerantly (shape unverified)", () => {
  const flat = [
    { id: 9123, reference: "162-26", incidentType: "Attack", incidentDate: "2026-10-08T07:15:00Z", latitude: 12.6667, longitude: 43.3333, description: "A vessel was struck by an unknown projectile 15NM west of Mocha.", source: "Master" },
    { id: 9124, reference: "163-26", incidentType: "Advisory", incidentDate: "10 OCT 2026", description: "An incident involving a tanker and military forces in the Gulf of Oman.", source: "Military authorities" },
    { id: 9125, title: "161-26 SUSPICIOUS APPROACH", date: "2026-10-05", location: { lat: 25.2, lng: 56.9 }, narrative: "Approached by two small craft 60NM east of Fujairah." },
    { id: 9126, description: "no reference anywhere", latitude: 1, longitude: 1 },
    { id: 9123, reference: "162-26", incidentType: "Attack", description: "duplicate" },
  ];
  it("finds the records under the usual keys, a GeoJSON collection, or a bare array", () => {
    expect(apiRecords(flat)).toHaveLength(5);
    expect(apiRecords({ data: flat })).toHaveLength(5);
    expect(apiRecords({ result: { incidents: flat } })).toHaveLength(5);
    expect(apiRecords({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: null }] })).toHaveLength(1);
    expect(apiRecords({ count: 0 })).toEqual([]);
    expect(apiRecords(null)).toEqual([]);
  });
  it("reads reference / label / date / position / narrative by the names such feeds use; a row with no reference is skipped; duplicates collapse", () => {
    const p = parseUkmtoApi(flat);
    expect(p.records).toBe(5);
    expect(p.incidents.map((i) => i.ref)).toEqual(["163-26", "162-26", "161-26"]);   // newest first, the duplicate and the ref-less row gone
    const atk = p.incidents.find((i) => i.ref === "162-26")!;
    expect(atk.label).toBe("ATTACK");
    expect(atk.date).toBe("2026-10-08");
    expect(atk.time).toBe("0715 UTC");
    expect(atk.placement).toBe("reported");
    expect(atk.lat).toBeCloseTo(12.6667, 3);
    expect(atk.reportedBy).toBe("Master");
    expect(gradeUkmto(atk)?.cls).toBe("strike");
    const adv = p.incidents.find((i) => i.ref === "163-26")!;
    expect(adv.placement).toBe("area");
    expect(adv.area).toBe("Gulf of Oman");
    const app = p.incidents.find((i) => i.ref === "161-26")!;
    expect(app.label).toBe("SUSPICIOUS APPROACH");          // from the title, reference stripped
    expect(app.lat).toBeCloseTo(25.2, 3);
    expect(p.keys).toContain("reference");
  });
  it("reads the LIVE SCCD row shape (first 1.2.5 run, 2026-10-27): a bare incidentNumber keyed with the year of utcDateOfIncident, incidentTypeName, the sitecore anchor as the door", () => {
    // Verbatim from the run log's sample (cut where the log cut it).
    const live = { incidentIssuer: "UKMTO", incidentNumber: 143, sitecoreId: "a5b33f9d-6c8e-43fc-9af0-3936d61bf55d", utcDateCreated: "2026-09-29T10:28:14Z", utcDateOfIncident: "2026-09-28T23:00:00Z", pinColour: "Yellow", incidentTypeName: "Suspicious Activity" };
    const r = apiRecordToIncident(live)!;
    expect(r.ref).toBe("143-26");
    expect(r.date).toBe("2026-09-28");                 // the incident's date, not the creation date
    expect(r.time).toBe("2300 UTC");
    expect(r.label).toBe("SUSPICIOUS ACTIVITY");
    expect(r.reportedBy).toBe("UKMTO");
    expect(r.url).toBe("https://www.ukmto.org/recent-incidents#a5b33f9d-6c8e-43fc-9af0-3936d61bf55d");
    expect(r.placement).toBeNull();                    // no position field on this row — never guessed
    // The second run's full key list: positions in locationLatitude / locationLongitude (decimal) with a
    // DDDMMSS spelling beside them, the narrative in otherDetails, the water in region / place, the vessel.
    const full = { ...live, incidentTypeLevel: 2, locationLatitude: 12.6667, locationLongitude: 43.3333, locationLatitudeDDDMMSS: "124000N", locationLongitudeDDDMMSS: "0432000E", region: "Bab el Mandeb", place: "15NM west of Mocha", vesselName: "MV EXAMPLE", vesselType: "Bulk carrier", vesselUnderPirateControl: false, dateVesselTaken: null, crewHeld: null, otherDetails: "A vessel was struck by an unknown projectile.", hideFromTicker: false, extendTickerTime: false };
    const f = apiRecordToIncident(full)!;
    expect(f.placement).toBe("reported");
    expect(f.lat).toBeCloseTo(12.6667, 3);
    expect(f.lon).toBeCloseTo(43.3333, 3);
    expect(f.text).toBe("A vessel was struck by an unknown projectile. Vessel: MV EXAMPLE (Bulk carrier)");
    expect(gradeUkmto(f)?.cls).toBe("approach");       // the page's LABEL (Suspicious Activity) grades first, the narrative second
    expect(gradeUkmto({ ...f, label: "ATTACK" })?.cls).toBe("strike");
    // Decimals absent → the DDDMMSS spelling; none → the region names the water (area-placed, said).
    const dms = apiRecordToIncident({ ...full, locationLatitude: null, locationLongitude: null })!;
    expect(dms.placement).toBe("reported");
    expect(dms.lat).toBeCloseTo(12.6667, 3);
    expect(dms.lon).toBeCloseTo(43.3333, 3);
    const areaOnly = apiRecordToIncident({ ...full, locationLatitude: 0, locationLongitude: 0, locationLatitudeDDDMMSS: "", locationLongitudeDDDMMSS: "", otherDetails: "" })!;
    expect(areaOnly.placement).toBe("area");
    expect(areaOnly.area).toBe("Mocha");               // the first-named water wins (the port is the more precise placement); the region is the fallback
    expect(apiRecordToIncident({ ...full, locationLatitude: 0, locationLongitude: 0, locationLatitudeDDDMMSS: "", locationLongitudeDDDMMSS: "", otherDetails: "", place: "" })!.area).toBe("Bab el Mandeb");
    expect(areaOnly.text).toMatch(/^15NM west of Mocha, Bab el Mandeb/);
    const piracy = apiRecordToIncident({ ...full, vesselUnderPirateControl: true, crewHeld: "19" })!;
    expect(piracy.text).toMatch(/Vessel under pirate control — crew held: 19/);
    expect(parseDddmmss("124000N", "0432000E")).toEqual({ lat: 12 + 40 / 60, lon: 43 + 20 / 60 });
    expect(parseDddmmss("124000S", "0432000W")).toEqual({ lat: -(12 + 40 / 60), lon: -(43 + 20 / 60) });
    expect(parseDddmmss("abc", "0432000E")).toBeNull();
    // A December row keeps its own year; a bare number with no date at all is skipped.
    expect(apiRecordToIncident({ incidentNumber: 201, utcDateOfIncident: "2025-12-30T01:00:00Z" })?.ref).toBe("201-25");
    expect(apiRecordToIncident({ incidentNumber: 7 })).toBeNull();
    // The ticker's rows carry no reference — skipped, never keyed on the link.
    expect(apiRecordToIncident({ navigationLink: "/recent-incidents#428cc21c-1484-49d6-95b6-02e527dffcc5", navigationLinkText: "UKMTO has received a verified time-late report…", date: "2026-10-23T08:30:00Z", type: "Attack" })).toBeNull();
    // The text parse's "143-26" and the API's bare 143 merge into ONE row.
    const cap = JSON.stringify({ format: "dead-ukmto", version: 1, source: { host: "www.ukmto.org", pageUrl: UKMTO_URL }, text: "143-26 - SUSPICIOUS ACTIVITY\nIncident Date: 28 SEP 2026\nSource: Master\nPosition: 12°40'N 043°20'E\nApproached by two small craft.", api: [{ url: "https://sccd.royalnavy.mod.uk/api/ukmto/all", status: 200, body: JSON.stringify([live]) }] });
    const p = parseUkmtoCapture(cap);
    expect(p.ok && p.incidents.length).toBe(1);
    expect(p.ok && p.incidents[0].placement).toBe("reported");   // the text's position fills what the API row lacks
    expect(p.ok && p.apiKeys).toEqual(Object.keys(live));
    expect(p.ok && p.placed).toBe(1);
  });
  it("reads a GeoJSON feature's properties and [lon, lat] geometry, and a string position", () => {
    const f = apiRecordToIncident({ type: "Feature", properties: { ref: "160-26", category: "WARNING", date: "01/10/2026", summary: "Increased military activity in the Arabian Gulf." }, geometry: { type: "Point", coordinates: [50.5, 26.1] } })!;
    expect(f.ref).toBe("160-26");
    expect(f.lon).toBeCloseTo(50.5, 3);
    expect(f.lat).toBeCloseTo(26.1, 3);
    expect(f.date).toBe("2026-10-01");
    expect(gradeUkmto(f)?.modality).toBe("threat");
    const s = apiRecordToIncident({ reference: "159-26", type: "Boarding", position: "12°40'N 043°20'E", details: "Boarded by armed persons." })!;
    expect(s.placement).toBe("reported");
    expect(s.lat).toBeCloseTo(12.667, 2);
    expect(apiRecordToIncident({ description: "nothing to key on" })).toBeNull();
  });
  it("a capture carrying the SCCD body uses its rows (positions win) and keeps the text parse as the fallback; a foreign host's body is ignored", () => {
    const cap = (api: unknown[], text = PAGE) => JSON.stringify({ format: "dead-ukmto", version: 1, source: { host: "www.ukmto.org", pageUrl: UKMTO_URL }, text, api });
    const r = parseUkmtoCapture(cap([{ url: "https://sccd.royalnavy.mod.uk/api/ukmto/all", status: 200, body: JSON.stringify({ data: flat }) }]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fromApi).toBe(3);
    expect(r.incidents.map((i) => i.ref)).toEqual(["163-26", "162-26", "161-26", "160-26"]);   // 160-26 only in the text
    expect(r.incidents.find((i) => i.ref === "161-26")?.placement).toBe("reported");          // the API's position, not the text's unplaced row
    const foreign = parseUkmtoCapture(cap([{ url: "https://evil.example/api/ukmto/all", status: 200, body: JSON.stringify(flat) }]));
    expect(foreign.ok && foreign.fromApi).toBe(0);
    const apiOnly = parseUkmtoCapture(cap([{ url: "https://sccd.royalnavy.mod.uk/api/ukmto/all", status: 200, body: JSON.stringify(flat) }], ""));
    expect(apiOnly.ok && apiOnly.incidents.length).toBe(3);
    const junk = parseUkmtoCapture(cap([{ url: "https://sccd.royalnavy.mod.uk/api/ukmto/all", status: 200, body: "<html>" }]));
    expect(junk.ok && junk.fromApi).toBe(0);
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

describe("fitUkmtoRow — a parsed row always fits the table", () => {
  it("clips every string to its column width (the 2026-10-26 incident_at refusal)", () => {
    const [inc] = parseUkmtoText("171-26 - SUSPICIOUS APPROACH\nIncident Date: 25 OCT 2026\nIncident Time: 0415 UTC (0815 local, as reported by the Master to UKMTO watchkeeper)\nSource: Master\nPosition: 12°40'N 043°20'E\nA vessel reported a small craft approaching.\n");
    expect(inc.time!.length).toBeGreaterThan(UKMTO_COLUMN_WIDTHS.time); // the PAGE cap is wider than the column
    const row = fitUkmtoRow(inc);
    expect(row.time!.length).toBeLessThanOrEqual(UKMTO_COLUMN_WIDTHS.time);
    expect(row.time!.startsWith("0415 UTC")).toBe(true);
    expect(row.ref).toBe("171-26");
    expect(row.placement).toBe("reported");
    expect(row.text).toBe(inc.text); // body is TEXT — kept whole
    for (const k of ["ref", "label", "date", "reportedBy", "area", "url"] as const) {
      const v = row[k];
      if (typeof v === "string") expect(v.length).toBeLessThanOrEqual(UKMTO_COLUMN_WIDTHS[k]);
    }
  });
  it("a non-finite coordinate is stored as null and its placement dropped; an empty clip reads null", () => {
    const row = fitUkmtoRow({
      id: "ukmto-1-26", ref: "1-26", label: "ATTACK", date: null, time: "   ", reportedBy: null,
      lat: Number.NaN, lon: 56.2, placement: "reported", area: null, text: "x", url: "https://www.ukmto.org/recent-incidents",
    });
    expect(row.lat).toBeNull();
    expect(row.lon).toBeNull();
    expect(row.placement).toBeNull();
    expect(row.time).toBeNull();
  });
});
