import { describe, it, expect } from "vitest";
import {
  parseIodaEntities, parseIodaSignals, internetLed,
  parseUsgsGauges, parseFaaNas, nasLed, splitInfraNews, infraLed,
} from "../lib/infraSignals";

// ─── IODA — entities sample is the REAL prod capture (2026-07-06) ───────────

const IODA_ENTITIES = {
  type: "entities.lookup",
  requestParameters: { search: "new jersey", entityType: "region" },
  error: null,
  data: [
    { code: "4453", name: "New Jersey", type: "region", subnames: [], attrs: { fqid: "geo.netacuity.NA.US.4453", country_code: "US" } },
  ],
};

describe("parseIodaEntities", () => {
  it("returns the region code from the live lookup shape", () => {
    expect(parseIodaEntities(IODA_ENTITIES, "New Jersey")).toEqual({ code: "4453", name: "New Jersey" });
  });
  it("prefers the exact name match over the first row", () => {
    const multi = { data: [{ code: "1", name: "Jersey" }, { code: "2", name: "New Jersey" }] };
    expect(parseIodaEntities(multi, "new jersey")?.code).toBe("2");
    expect(parseIodaEntities(multi)?.code).toBe("1");
  });
  it("handles empty/malformed responses", () => {
    expect(parseIodaEntities({ data: [] })).toBeNull();
    expect(parseIodaEntities(null)).toBeNull();
  });
});

describe("parseIodaSignals", () => {
  const series = (datasource: string, values: (number | null)[]) => ({ datasource, values, step: 300 });

  it("flattens array-of-arrays, skips model variants, computes drop", () => {
    const steady = Array(40).fill(100);
    const dropped = [...Array(30).fill(100), ...Array(10).fill(10)]; // 90% down at the end
    const j = { data: [[series("bgp", steady), series("gtr", dropped), series("gtr-sarima", steady)]] };
    const out = parseIodaSignals(j);
    expect(out.map((s) => s.datasource)).toEqual(["bgp", "gtr"]); // sarima skipped
    expect(out[0].dropPct).toBe(0);
    expect(out[1].dropPct).toBeGreaterThanOrEqual(85);
    expect(out[0].label).toBe("BGP routes");
  });

  it("tolerates trailing nulls (ingest lag) and sparse series", () => {
    const j = { data: [[series("ping-slash24", [...Array(20).fill(50), null, null, null])]] };
    const out = parseIodaSignals(j);
    expect(out[0].dropPct).toBe(0);
    const sparse = parseIodaSignals({ data: [[series("bgp", [null, 5, null])]] });
    expect(sparse[0].dropPct).toBeNull(); // too few points → no claim
  });

  it("returns [] on malformed input", () => {
    expect(parseIodaSignals(null)).toEqual([]);
    expect(parseIodaSignals({ data: "x" })).toEqual([]);
  });
});

describe("internetLed", () => {
  const s = (datasource: string, dropPct: number | null) => ({ datasource, label: datasource, latest: 1, baseline: 1, dropPct });
  it("needs corroboration for red, single-source majority drop is amber", () => {
    expect(internetLed([s("bgp", 85), s("gtr", 85)])).toBe("r");
    expect(internetLed([s("bgp", 96)])).toBe("r");
    expect(internetLed([s("bgp", 85), s("gtr", 5)])).toBe("a");
    expect(internetLed([s("bgp", 10), s("gtr", 5)])).toBe("g");
    expect(internetLed([s("bgp", null)])).toBe("u");
    expect(internetLed([])).toBe("u");
  });
});

// ─── USGS WaterML (envelope shape from the live capture) ────────────────────

const USGS = {
  name: "ns1:timeSeriesResponseType",
  value: {
    queryInfo: { queryURL: "http://waterservices.usgs.gov/nwis/iv/..." },
    timeSeries: [
      {
        sourceInfo: { siteName: "Rancocas Creek at Pemberton NJ" },
        variable: { noDataValue: -999999 },
        values: [{ value: [{ value: "3.42", dateTime: "2026-07-05T22:00:00.000-04:00" }] }],
      },
      {
        sourceInfo: { siteName: "Dead Gauge Creek" },
        variable: { noDataValue: -999999 },
        values: [{ value: [{ value: "-999999", dateTime: "2026-07-05T22:00:00.000-04:00" }] }],
      },
    ],
  },
};

describe("parseUsgsGauges", () => {
  it("extracts site + stage and nulls the noDataValue sentinel", () => {
    const out = parseUsgsGauges(USGS);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ site: "Rancocas Creek at Pemberton NJ", stageFt: 3.42, time: "2026-07-05T22:00:00.000-04:00" });
    expect(out[1].stageFt).toBeNull();
  });
  it("returns [] on malformed input", () => {
    expect(parseUsgsGauges(null)).toEqual([]);
    expect(parseUsgsGauges({ value: {} })).toEqual([]);
  });
});

// ─── FAA NAS XML — head of the REAL prod capture + representative sections ──

const FAA_XML =
  `<AIRPORT_STATUS_INFORMATION><Update_Time>Mon Jul 6 02:16:29 2026 GMT</Update_Time>` +
  `<Dtd_File>http://www.fly.faa.gov/AirportStatus.dtd</Dtd_File>` +
  `<Delay_type><Name>Ground Stop Programs</Name><Ground_Stop_List>` +
  `<Program><ARPT>IAD</ARPT><Reason>thunderstorms</Reason><End_Time>11:00 pm EDT</End_Time></Program>` +
  `<Program><ARPT>LGA</ARPT><Reason>thunderstorms</Reason><End_Time>11:00 pm EDT</End_Time></Program>` +
  `</Ground_Stop_List></Delay_type>` +
  `<Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List>` +
  `<Ground_Delay><ARPT>PHL</ARPT><Reason>weather</Reason><Avg>1 hour and 2 minutes</Avg><Max>2 hours</Max></Ground_Delay>` +
  `</Ground_Delay_List></Delay_type>` +
  `<Delay_type><Name>Airport Closures</Name><Airport_Closure_List>` +
  `<Airport><ARPT>TEB</ARPT><Reason>flooding</Reason><Reopen>Jul 06 at 14:00 UTC.</Reopen></Airport>` +
  `</Airport_Closure_List></Delay_type>` +
  `<Delay_type><Name>General Arrival/Departure Delay Info</Name><Arrival_Departure_Delay_List>` +
  `<Delay><ARPT>EWR</ARPT><Reason>weather</Reason><Arrival_Departure Type="Departure"><Min>31 minutes</Min><Max>45 minutes</Max></Arrival_Departure></Delay>` +
  `</Arrival_Departure_Delay_List></Delay_type>` +
  `</AIRPORT_STATUS_INFORMATION>`;

describe("parseFaaNas", () => {
  it("parses all four program classes from the live XML shape", () => {
    const out = parseFaaNas(FAA_XML);
    expect(out.updated).toBe("Mon Jul 6 02:16:29 2026 GMT");
    expect(out.programs).toHaveLength(5);
    const byKind = (k: string) => out.programs.filter((p) => p.kind === k);
    expect(byKind("groundStop").map((p) => p.airport)).toEqual(["IAD", "LGA"]);
    expect(byKind("groundStop")[0].detail).toBe("until 11:00 pm EDT");
    expect(byKind("groundDelay")[0]).toMatchObject({ airport: "PHL", detail: "avg 1 hour and 2 minutes · max 2 hours" });
    expect(byKind("closure")[0]).toMatchObject({ airport: "TEB", reason: "flooding" });
    expect(byKind("delay")[0].detail).toBe("Departure 31 minutes–45 minutes");
  });
  it("is fail-safe on junk", () => {
    expect(parseFaaNas("")).toEqual({ updated: null, programs: [] });
    expect(parseFaaNas("<html>rate limited</html>").programs).toEqual([]);
  });
});

describe("nasLed", () => {
  const p = (kind: "groundStop" | "groundDelay" | "closure" | "delay", airport: string) =>
    ({ kind, airport, reason: "", detail: "", km: 50 });
  it("nearby closure/ground stop → amber; own field closure → red; dead feed → unknown", () => {
    expect(nasLed(true, [p("closure", "TEB")], "KWRI")).toBe("a");
    expect(nasLed(true, [p("groundStop", "PHL")], "KWRI")).toBe("a");
    expect(nasLed(true, [p("closure", "WRI")], "KWRI")).toBe("r");
    expect(nasLed(true, [p("groundDelay", "PHL")], "KWRI")).toBe("g");
    expect(nasLed(true, [], "KWRI")).toBe("g");
    expect(nasLed(false, [], "KWRI")).toBe("u");
  });
});

describe("splitInfraNews + infraLed", () => {
  it("buckets impact news by utility class", () => {
    const news = [
      { title: "a", matched: ["power outage"] },
      { title: "b", matched: ["boil water", "closure"] },
      { title: "c", matched: ["fiber cut"] },
      { title: "d", matched: ["protest"] },
    ];
    const s = splitInfraNews(news);
    expect(s.power).toHaveLength(1);
    expect(s.water).toHaveLength(1);
    expect(s.comms).toHaveLength(1);
  });

  it("rolls up worst sensor; news can only raise green to amber; all-dead → unknown", () => {
    expect(infraLed("g", "g", 0, 0)).toBe("g");
    expect(infraLed("g", "g", 1, 0)).toBe("a");
    expect(infraLed("r", "g", 0, 0)).toBe("r");
    expect(infraLed("u", "a", 0, 0)).toBe("a");
    expect(infraLed("u", null, 2, 0)).toBe("u");  // no sensor → UNKNOWN even with news
    expect(infraLed("u", "u", 0, 0)).toBe("u");
    expect(infraLed("a", null, 0, 5)).toBe("a");
  });
});
