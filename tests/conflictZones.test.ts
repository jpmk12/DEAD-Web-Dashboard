import { describe, it, expect } from "vitest";
import {
  firCodesIn, firsByName, countriesIn, altitudeIn, readDate, kiczId, kiczLevel, parseKiczNotam,
  parseFaaRestrictionsPage, czibIdIn, parseCzibListing, parseCzibPage, czibZone, mergeFaaZones, sortZones,
} from "../lib/conflictZones";

const TEHRAN = "A0014/22 NOTAMN Q) KICZ/QARLC/IV/NBO/E/000/999/ A) KICZ B) 2209200000 C) PERM E) SECURITY..UNITED STATES OF AMERICA PROHIBITION FOR THE TEHRAN FLIGHT INFORMATION REGION (FIR) (OIIX). ALL FLIGHT OPERATIONS IN THE TEHRAN FIR (OIIX) AT ALL ALTITUDES BY U.S. AIR CARRIERS AND COMMERCIAL OPERATORS ARE PROHIBITED. SEE 14 CFR 91.1617 (SFAR NO. 117).";
const KABUL = "A0007/25 E) SECURITY..UNITED STATES OF AMERICA PROHIBITION FOR THE KABUL FLIGHT INFORMATION REGION (FIR) (OAKX). U.S. OPERATORS ARE PROHIBITED FROM CONDUCTING FLIGHT OPERATIONS IN THE KABUL FIR (OAKX) BELOW FL 320.";
const ADVISORY = "A0008/26 E) SECURITY..UNITED STATES OF AMERICA ADVISORY FOR THE SAN JUAN FLIGHT INFORMATION REGION (TJZS FIR). A POTENTIALLY HAZARDOUS SITUATION EXISTS. U.S. OPERATORS SHOULD EXERCISE CAUTION.";

describe("the shared readers", () => {
  it("FIR codes: in parentheses, after FIR, or before FIR — never KICZ / SFAR", () => {
    expect(firCodesIn(TEHRAN)).toEqual(["OIIX"]);
    expect(firCodesIn(ADVISORY)).toEqual(["TJZS"]);
    expect(firCodesIn("(KICZ) (SFAR) SEE (ICAO)")).toEqual([]);
    expect(firCodesIn("routes via (ABCD) waypoint")).toEqual([]); // unknown code, no FIR words
  });
  it("FIRs by city — strict in a text, loose in a short label", () => {
    expect(firsByName("THE SANA'A FIR IS")).toEqual(["OYSC"]);
    expect(firsByName("Sanaa traffic")).toEqual([]);
    expect(firsByName("KICZ NOTAM A0022/24 - Sanaa Pointer", true)).toEqual(["OYSC"]);
  });
  it("countries word-bounded, longest first", () => {
    expect(countriesIn("airspace of Nigeria and Niger")).toEqual(expect.arrayContaining(["Nigeria", "Niger"]));
    expect(countriesIn("Nigerian airspace")).toEqual([]);
    expect(countriesIn("Airspace of Iran")).toEqual(["Iran"]);
  });
  it("altitudes in the issuers' words", () => {
    expect(altitudeIn(TEHRAN)).toBe("all altitudes");
    expect(altitudeIn(KABUL)).toBe("below FL320");
    expect(altitudeIn("at and above FL 260")).toBe("FL260 and above");
    expect(altitudeIn("between FL 100 and FL 250")).toBe("FL100–FL250");
    expect(altitudeIn("no level")).toBeNull();
  });
  it("dates in every spelling met", () => {
    expect(readDate("16/11/2026")).toBe("2026-11-16");
    expect(readDate("2026-03-28")).toBe("2026-03-28");
    expect(readDate("28 February 2026")).toBe("2026-02-28");
    expect(readDate("Feb 28, 2026")).toBe("2026-02-28");
    expect(readDate("31/13/2026")).toBeNull();
  });
});

describe("FAA KICZ NOTAMs", () => {
  it("number and level in the FAA's own words", () => {
    expect(kiczId(TEHRAN)).toBe("A0014/22");
    expect(kiczId("KICZ_NOTAM_A0022_24")).toBe("A0022/24");
    expect(kiczLevel(TEHRAN)).toBe("prohibited");
    expect(kiczLevel(ADVISORY)).toBe("caution");
    expect(kiczLevel("A0001/26 SECURITY..NOTICE OF FLIGHT DATA")).toBe("notice");
  });
  it("a NOTAM → a zone placed at its FIR; an unknown FIR is named but unplaced", () => {
    const z = parseKiczNotam(TEHRAN, { start: "2022-09-20T00:00:00Z" })!;
    expect(z).toMatchObject({ id: "KICZ A0014/22", source: "faa", level: "prohibited", firs: ["OIIX"], altitude: "all altitudes", issued: "2022-09-20", validTo: null });
    expect(z.points).toEqual([{ lat: expect.any(Number), lon: expect.any(Number), by: "fir", name: "Tehran FIR (OIIX)" }]);
    expect(z.title).toMatch(/Tehran FIR — prohibited \(all altitudes\)/);
    const k = parseKiczNotam(KABUL)!;
    expect(k).toMatchObject({ level: "prohibited", altitude: "below FL320", firs: ["OAKX"] });
    const a = parseKiczNotam(ADVISORY)!;
    expect(a).toMatchObject({ level: "caution", firs: ["TJZS"], points: [] });
  });
  it("a cancellation or a text with no number is no zone", () => {
    expect(parseKiczNotam("A0003/26 NOTAMC A0014/22 E) CANCELLED")).toBeNull();
    expect(parseKiczNotam("SECURITY ADVISORY WITHOUT A NUMBER")).toBeNull();
  });
  it("the restrictions page's KICZ links become stubs; other links are ignored", () => {
    const html = `<ul>
      <li><a href="doc/KICZ NOTAM A0022_24 - Sanaa Pointer.pdf">KICZ NOTAM A0022/24 - Sanaa Pointer</a></li>
      <li><a href="/air_traffic/publications/us_restrictions/Afghanistan/doc/KICZ-NOTAM-A0007-25-Kabul-Pointer.pdf">KICZ NOTAM A0007/25 Kabul Pointer</a></li>
      <li><a href="KICZ-ADVISORY-NOTAM-A0014-26-XX01.pdf">KICZ Advisory NOTAM A0014/26</a></li>
      <li><a href="https://evil.example/KICZ-A0099-26.pdf">KICZ A0099/26</a></li>
      <li><a href="/other.pdf">Something else</a></li></ul>`;
    const zs = parseFaaRestrictionsPage(html);
    expect(zs.map((z) => z.id)).toEqual(["KICZ A0022/24", "KICZ A0007/25", "KICZ A0014/26", "KICZ A0099/26"]);
    expect(zs[0]).toMatchObject({ firs: ["OYSC"], level: "notice" });
    expect(zs[0].url).toMatch(/^https:\/\/www\.faa\.gov\/air_traffic\/publications\/us_restrictions\/doc\//);
    expect(zs[1]).toMatchObject({ firs: ["OAKX"], countries: ["Afghanistan"] });
    expect(zs[2].level).toBe("caution");
    expect(zs[3].url).toBeNull(); // a foreign host is never linked
  });
  it("merge: the NOTAM text wins; a stub keeps a NOTAM the DAIP read missed", () => {
    const fromN = [parseKiczNotam(TEHRAN)!];
    const fromP = parseFaaRestrictionsPage(`<a href="x/KICZ_A0014_22.pdf">KICZ A0014/22 Tehran</a><a href="y/KICZ_A0007_25.pdf">KICZ A0007/25 Kabul</a>`);
    const m = mergeFaaZones(fromN, fromP);
    expect(m.find((z) => z.id === "KICZ A0014/22")).toMatchObject({ level: "prohibited", altitude: "all altitudes" });
    expect(m.find((z) => z.id === "KICZ A0014/22")!.url).toMatch(/KICZ_A0014_22\.pdf/);
    expect(m.find((z) => z.id === "KICZ A0007/25")).toBeTruthy();
  });
});

describe("EASA CZIBs", () => {
  it("bulletin numbers in both spellings — a plain ISO date is never one", () => {
    expect(czibIdIn("CZIB-2022-01R14")).toEqual({ key: "2022-01", rev: 14, label: "CZIB-2022-01R14" });
    expect(czibIdIn("2026-03-R5")).toEqual({ key: "2026-03", rev: 5, label: "CZIB-2026-03R5" });
    expect(czibIdIn("CZIB 2017-08")).toMatchObject({ key: "2017-08", rev: 0 });
    expect(czibIdIn("2026-03-28")).toBeNull();
  });
  const LISTING = `<table><tr><th>Number</th><th>Subject</th><th>Issued</th><th>Valid until</th><th>Status</th></tr>
    <tr><td><a href="/en/domains/air-operations/czibs/czib-2017-08r19">CZIB-2017-08R19</a></td><td>Airspace of Afghanistan</td><td>20/06/2026</td><td>31/12/2026</td><td>Active</td></tr>
    <tr><td><a href="/en/domains/air-operations/czibs/czib-2017-08r18">CZIB-2017-08R18</a></td><td>Airspace of Afghanistan</td><td>01/01/2026</td><td>30/06/2026</td><td>Superseded</td></tr>
    <tr><td><a href="/en/domains/air-operations/czibs/czib-2017-04r19">CZIB-2017-04R19</a></td><td>Airspace of Iraq</td><td>01/02/2025</td><td>01/08/2025</td><td>Withdrawn</td></tr>
    <tr><td>2026-03-R5</td><td>Airspace of the Middle East and Persian Gulf</td><td>28/02/2026</td><td>28/02/2027</td><td>Active</td></tr></table>`;
  it("the listing: highest revision per bulletin, title, dates, status, link", () => {
    const es = parseCzibListing(LISTING);
    const af = es.find((e) => e.key === "2017-08")!;
    expect(af).toMatchObject({ rev: 19, title: "Airspace of Afghanistan", status: "active", issued: "2026-06-20", validTo: "2026-12-31", countries: ["Afghanistan"] });
    expect(af.url).toBe("https://www.easa.europa.eu/en/domains/air-operations/czibs/czib-2017-08r19");
    expect(es.find((e) => e.key === "2017-04")!.status).toBe("withdrawn");
    const me = es.find((e) => e.key === "2026-03")!;
    expect(me).toMatchObject({ label: "CZIB-2026-03R5", status: "active", validTo: "2027-02-28", url: null });
  });
  it("a bulletin's page adds the FIRs, the recommendation and its level", () => {
    const p = parseCzibPage(`<h1>CZIB-2026-03R5</h1><p>Affected airspace: Tehran FIR (OIIX), Baghdad FIR (ORBB), Damascus FIR (OSTT) and the airspace of Israel.</p>
      <p>Valid until: 28/02/2027</p><p>Recommendation: Operators should not operate within the affected airspace at all flight levels.</p>`);
    expect(p.firs.sort()).toEqual(["OIIX", "ORBB", "OSTT"]);
    expect(p).toMatchObject({ level: "avoid", altitude: "all altitudes", validTo: "2027-02-28", withdrawn: false });
    expect(p.countries).toContain("Israel");
    expect(parseCzibPage("<p>Operators should exercise caution below FL 260.</p>")).toMatchObject({ level: "caution", altitude: "below FL260" });
  });
  it("czibZone: withdrawn / superseded / expired / past validity are dropped; places by FIR, then by country", () => {
    const es = parseCzibListing(LISTING);
    const today = "2026-11-26";
    expect(czibZone(es.find((e) => e.key === "2017-04")!, null, today)).toBeNull();
    expect(czibZone({ ...es.find((e) => e.key === "2017-08")!, validTo: "2026-11-01" }, null, today)).toBeNull();
    const af = czibZone(es.find((e) => e.key === "2017-08")!, null, today)!;
    expect(af).toMatchObject({ id: "CZIB-2017-08R19", source: "easa", level: "avoid" });
    expect(af.points).toEqual([{ lat: expect.any(Number), lon: expect.any(Number), by: "country", name: "Afghanistan" }]);
    expect(af.text).toMatch(/recommendation not read/);
    const page = parseCzibPage(`<p>Tehran FIR (OIIX), Damascus FIR (OSTT), Israel.</p><p>Operators should not operate.</p>`);
    const me = czibZone(es.find((e) => e.key === "2026-03")!, page, today)!;
    expect(me.points.map((p) => p.by)).toEqual(["fir", "fir", "country"]);
    expect(me.points.map((p) => p.name)).toContain("Israel");
  });
  it("sortZones: binding before recommendation, worst first", () => {
    const a = parseKiczNotam(ADVISORY)!, b = parseKiczNotam(TEHRAN)!;
    const c = czibZone(parseCzibListing(LISTING).find((e) => e.key === "2017-08")!, null, "2026-11-26")!;
    expect(sortZones([a, c, b]).map((z) => z.id)).toEqual(["KICZ A0014/22", "CZIB-2017-08R19", "KICZ A0008/26"]);
  });
});
