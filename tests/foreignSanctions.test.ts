import { describe, it, expect } from "vitest";
import { parseEuCsv, parseUkCsv, designationWaves, splitCsvLine, ukRegimeCountry } from "../lib/foreignSanctionsParse";
import { LEVERAGE } from "../lib/leverage";
import { CURATED_ACTOR_IDS } from "../lib/economicWarfare";

describe("splitCsvLine", () => {
  it("honours quotes, embedded delimiters and doubled quotes", () => {
    expect(splitCsvLine('a,"b, c","d ""e""",f', ",")).toEqual(["a", "b, c", 'd "e"', "f"]);
    expect(splitCsvLine("x;;y", ";")).toEqual(["x", "", "y"]);
  });
});

describe("parseEuCsv", () => {
  const csv = [
    "fileGenerationDate;2026-09-29",
    "Entity_LogicalId;Entity_EU_ReferenceNumber;Entity_DesignationDate;Entity_SubjectType;Entity_Regulation_Type;Entity_Regulation_PublicationDate;Entity_Regulation_Programme;NameAlias_WholeName",
    "100;EU.1;2026-09-15;person;regulation;2026-09-15;IRN;First Alias",
    "100;EU.1;2026-09-15;person;regulation;2026-09-15;IRN;Second Alias",
    "101;EU.2;2026-09-16;enterprise;regulation;2026-09-16;UKR;Some Company",
    "102;EU.3;2026-09-17;person;regulation;2026-09-17;CYB;Hacker",
    ";;;;;;;",
  ].join("\n");
  it("keys by header name, dedupes alias rows, maps programmes to countries", () => {
    const rows = parseEuCsv(csv);
    expect(rows.length).toBe(3);
    expect(rows[0]).toMatchObject({ source: "EU", programme: "IRN", country: "Iran", listedOn: "2026-09-15", entityId: "100" });
    expect(rows[1].country).toBe("Russia");
    expect(rows[2].country).toBeNull();
  });
  it("returns nothing when the expected columns are missing", () => {
    expect(parseEuCsv("a;b;c\n1;2;3")).toEqual([]);
  });
});

describe("parseUkCsv", () => {
  const csv = [
    "Last Updated:,29/09/2026",
    'Name 6,Name 1,Title,Country,Other Information,Group Type,Regime,Listed On,Last Updated,Group ID',
    'DOE,John,,Iran,"Note, with comma",Individual,Iran (Nuclear),15/09/2026,15/09/2026,9001',
    'DOE,Jon,,Iran,alias,Individual,Iran (Nuclear),15/09/2026,15/09/2026,9001',
    'ACME,,,Russia,,Entity,Russia,02/09/2026,02/09/2026,9002',
    'X,,,,,Entity,Cyber,03/09/2026,03/09/2026,9003',
  ].join("\n");
  it("parses dd/mm/yyyy, dedupes by Group ID, maps regimes", () => {
    const rows = parseUkCsv(csv);
    expect(rows.length).toBe(3);
    expect(rows[0]).toMatchObject({ source: "UK", programme: "Iran (Nuclear)", country: "Iran", listedOn: "2026-09-15", entityId: "9001" });
    expect(rows[1].country).toBe("Russia");
    expect(rows[2].country).toBeNull();
  });
  it("maps regime names", () => {
    expect(ukRegimeCountry("Democratic People's Republic of Korea")).toBe("North Korea");
    expect(ukRegimeCountry("Guinea-Bissau")).toBe("Guinea-Bissau");
    expect(ukRegimeCountry("Global Human Rights")).toBeNull();
  });
});

describe("designationWaves", () => {
  it("groups in-window listings per source+programme, newest wave first", () => {
    const rows = [
      ...parseEuCsv("Entity_LogicalId;Entity_Regulation_PublicationDate;Entity_Regulation_Programme\n1;2026-09-15;IRN\n2;2026-09-20;IRN\n3;2026-01-01;IRN\n4;2026-09-10;RUS"),
    ];
    const w = designationWaves(rows, "2026-09-29");
    expect(w.map((x) => `${x.programme}:${x.count}:${x.day}`)).toEqual(["IRN:2:2026-09-20", "RUS:1:2026-09-10"]);
  });
});

describe("leverage map is curated, sourced and never a warning", () => {
  it("every entry has a source, a note and an in-range bar, and names a curated actor", () => {
    for (const [id, e] of Object.entries(LEVERAGE)) {
      expect(CURATED_ACTOR_IDS).toContain(id);
      expect(e.asOf).toMatch(/^\d{4}-\d{2}$/);
      for (const it of [...e.threatens, ...e.weHold]) {
        expect(it.source.length).toBeGreaterThan(3);
        expect(it.note.length).toBeGreaterThan(5);
        expect(it.scale).toBeGreaterThanOrEqual(0);
        expect(it.scale).toBeLessThanOrEqual(100);
      }
    }
  });
});
