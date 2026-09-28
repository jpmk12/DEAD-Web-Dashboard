import { describe, it, expect } from "vitest";
import { classify, countriesIn, instrumentOf, enrich, summarize, regulatoryLines, type RegulatoryDoc } from "../lib/regulatorySignals";

const TODAY = "2026-09-28";
const doc = (over: Partial<RegulatoryDoc> = {}): RegulatoryDoc => ({
  documentNumber: "2026-12345", title: "Notice", abstract: null, type: "Notice",
  publicationDate: "2026-09-26", url: "https://www.federalregister.gov/d/2026-12345", agencies: [], ...over,
});

describe("classify — agency first, vocabulary second", () => {
  it("classes by the issuing agency when it is a known one", () => {
    expect(classify(doc({ agencies: [{ name: "OFAC", slug: "foreign-assets-control-office" }], title: "Notice of OFAC Sanctions Actions" }))).toBe("sanctions");
    expect(classify(doc({ agencies: [{ name: "BIS", slug: "industry-and-security-bureau" }], title: "Additions to the Entity List" }))).toBe("export-control");
    expect(classify(doc({ agencies: [{ name: "USTR", slug: "trade-representative-office-of-united-states" }], title: "Section 301 Action" }))).toBe("tariff");
  });

  it("falls back to title vocabulary for an ambiguous agency, and to other", () => {
    expect(classify(doc({ agencies: [{ name: "President", slug: "executive-office-of-the-president" }], title: "Adjusting Imports of Steel — Proclamation imposing tariffs" }))).toBe("tariff");
    expect(classify(doc({ agencies: [{ name: "Treasury", slug: "treasury-department" }], title: "Blocking Property of Certain Persons" }))).toBe("sanctions");
    expect(classify(doc({ agencies: [{ name: "State", slug: "state-department" }], title: "Meeting of the Advisory Committee on Historical Diplomatic Documentation" }))).toBe("other");
  });

  it("does not let a passing mention override the agency", () => {
    expect(classify(doc({ agencies: [{ name: "BIS", slug: "industry-and-security-bureau" }], title: "Revisions related to sanctions coordination" }))).toBe("export-control");
  });
});

describe("countriesIn — word-bounded, adjective-tolerant", () => {
  it("matches the name and its common adjective forms", () => {
    expect(countriesIn("Designation of Iranian petrochemical networks", ["Iran", "Qatar"])).toEqual(["Iran"]);
    expect(countriesIn("Entity List additions: entities in China and Russia", ["China", "Russia", "Iraq"])).toEqual(["China", "Russia"]);
  });

  it("never matches inside another word", () => {
    expect(countriesIn("Romania trade notice", ["Oman"])).toEqual([]);
    expect(countriesIn("Nigerian cases", ["Niger"])).toEqual([]);
  });

  it("skips very short names", () => {
    expect(countriesIn("US action", ["US"])).toEqual([]);
  });
});

describe("instrumentOf", () => {
  it("names the legal instrument when recognisable", () => {
    expect(instrumentOf("Adjusting Imports of Aluminum Under Section 232")).toBe("Section 232");
    expect(instrumentOf("Additions to the Entity List")).toBe("Entity List");
    expect(instrumentOf("Routine notice")).toBeNull();
  });
});

describe("enrich + summarize", () => {
  const docs = [
    doc({ documentNumber: "a", publicationDate: "2026-09-27", agencies: [{ name: "OFAC", slug: "foreign-assets-control-office" }], title: "Sanctions Actions — Iranian networks" }),
    doc({ documentNumber: "b", publicationDate: "2026-09-27", agencies: [{ name: "BIS", slug: "industry-and-security-bureau" }], title: "Entity List additions" }),
    doc({ documentNumber: "c", publicationDate: "2026-08-20", agencies: [{ name: "USTR", slug: "trade-representative-office-of-united-states" }], title: "Section 301 tariff modification" }),
  ];
  const actions = enrich(docs, ["Iran"], TODAY);

  it("sorts newest first with watch-touching rows leading within a day", () => {
    expect(actions.map((a) => a.documentNumber)).toEqual(["a", "b", "c"]);
    expect(actions[0].touchesWatch).toBe(true);
    expect(actions[0].ageDays).toBe(1);
  });

  it("summarises counts, recency and watch touches into one line", () => {
    const s = summarize(actions);
    expect(s.byClass).toEqual({ sanctions: 1, "export-control": 1, tariff: 1, other: 0 });
    expect(s.recent).toBe(2);
    expect(s.touchingWatch).toBe(1);
    expect(s.line).toMatch(/1 sanctions, 1 export-control, 1 tariff\/trade actions in the window \(2 in the last 7 days, 1 naming a watched country\)/);
    expect(summarize([]).line).toBeNull();
  });

  it("builds prompt lines with watch-touching actions first", () => {
    const lines = regulatoryLines(actions, 2);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^2026-09-27 \[Sanctions · SDN designation\]|^2026-09-27 \[Sanctions\]/);
    expect(lines[0]).toMatch(/\(Iran\)/);
  });
});
