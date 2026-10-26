import { describe, it, expect } from "vitest";
import { parseRadarOutages, parseRadarAnomalies, radarOutageLevel, radarReadsFor, RADAR_LEVEL_ORDINAL } from "../lib/radarSignals";
import { functionalRows, type FcInput } from "../lib/functionalCommands";

// The host is unreachable from the sandbox; these bodies follow the published
// API reference for /radar/annotations/outages and /radar/traffic_anomalies.
const NOW = Date.parse("2026-10-26T12:00:00Z");
const OUTAGES = {
  success: true, result: {
    annotations: [
      { id: "1001", dataSource: "ALL", description: "Nationwide internet shutdown in Iran amid protests", eventType: "OUTAGE", scope: "Country", startDate: "2026-10-24T18:00:00Z", endDate: null, locations: ["IR"], locationsDetails: [{ code: "IR", name: "Iran" }], asns: [], asnsDetails: [], outage: { outageCause: "GOVERNMENT_DIRECTED", outageType: "NATIONWIDE" }, linkedUrl: "https://blog.cloudflare.com/iran-shutdown" },
      { id: "1002", dataSource: "ALL", description: "Regional outage in Sudan — Khartoum", eventType: "OUTAGE", startDate: "2026-10-25T06:00:00Z", endDate: null, locations: ["SD"], locationsDetails: [{ code: "SD", name: "Sudan" }], asns: [], outage: { outageCause: "POWER_OUTAGE", outageType: "REGIONAL" }, linkedUrl: "http://insecure.example/x" },
      { id: "1003", dataSource: "ALL", description: "Cable cut affecting Yemen", eventType: "OUTAGE", startDate: "2026-10-20T00:00:00Z", endDate: "2026-10-22T00:00:00Z", locations: ["YE"], locationsDetails: [{ code: "YE", name: "Yemen" }], asns: [], outage: { outageCause: "CABLE_CUT", outageType: "NATIONWIDE" } },
      { id: "1004", dataSource: "ALL", description: "AS outage", eventType: "OUTAGE", startDate: "2026-10-25T00:00:00Z", endDate: null, locations: [], asns: [12345], outage: { outageCause: "UNKNOWN", outageType: "NETWORK" } },
      { id: "", description: "no id", startDate: "2026-10-25T00:00:00Z" },
      { id: "1006", description: "no start" },
    ],
  },
};
const ANOMALIES = {
  success: true, result: {
    trafficAnomalies: [
      { uuid: "a1", type: "LOCATION", status: "VERIFIED", startDate: "2026-10-25T20:00:00Z", endDate: null, locationDetails: { code: "JO", name: "Jordan" } },
      { uuid: "a2", type: "LOCATION", status: "UNVERIFIED", startDate: "2026-10-25T21:00:00Z", endDate: null, locationDetails: { code: "IQ", name: "Iraq" } },
      { uuid: "a3", type: "AS", status: "VERIFIED", startDate: "2026-10-25T21:00:00Z", endDate: null, asnDetails: { asn: 48832 } },
      { uuid: "a4", type: "BOGUS", status: "VERIFIED", startDate: "2026-10-25T21:00:00Z" },
    ],
  },
};

describe("parseRadarOutages / parseRadarAnomalies", () => {
  it("reads the annotation envelope, keeps only https links, drops rows with no id or start", () => {
    const xs = parseRadarOutages(OUTAGES);
    expect(xs.map((x) => x.id)).toEqual(["1002", "1004", "1001", "1003"]);   // newest first
    const ir = xs.find((x) => x.id === "1001")!;
    expect(ir).toMatchObject({ scope: "NATIONWIDE", cause: "GOVERNMENT_DIRECTED", endMs: null, url: "https://blog.cloudflare.com/iran-shutdown" });
    expect(ir.countries).toEqual([{ code: "IR", name: "Iran" }]);
    expect(xs.find((x) => x.id === "1002")!.url).toBeNull();
    expect(xs.find((x) => x.id === "1004")!.asns).toEqual([12345]);
    expect(parseRadarOutages({ result: {} })).toEqual([]);
    expect(parseRadarOutages(null)).toEqual([]);
  });
  it("reads anomalies, keeping the type vocabulary strict", () => {
    const xs = parseRadarAnomalies(ANOMALIES);
    expect(xs.map((x) => x.id).sort()).toEqual(["a1", "a2", "a3"]);
    expect(xs.find((x) => x.id === "a1")).toMatchObject({ type: "LOCATION", status: "VERIFIED", country: { code: "JO", name: "Jordan" } });
    expect(xs.find((x) => x.id === "a3")).toMatchObject({ type: "AS", asn: 48832, country: null });
  });
});

describe("radarOutageLevel / radarReadsFor — the level is earned", () => {
  const outages = parseRadarOutages(OUTAGES);
  const anomalies = parseRadarAnomalies(ANOMALIES);
  it("an ongoing NATIONWIDE outage from a hostile or governmental cause is RED; other ongoing is AMBER; ended is a NOTE", () => {
    expect(radarOutageLevel(outages.find((x) => x.id === "1001")!, NOW)).toBe("red");
    expect(radarOutageLevel(outages.find((x) => x.id === "1002")!, NOW)).toBe("amber");
    expect(radarOutageLevel(outages.find((x) => x.id === "1003")!, NOW)).toBe("note");
    expect(RADAR_LEVEL_ORDINAL.red).toBeGreaterThan(RADAR_LEVEL_ORDINAL.amber);
  });
  it("per-country reads name the cause and the since/ended day; a verified anomaly is amber, an unverified one never colours", () => {
    const reads = radarReadsFor(outages, anomalies, ["IR", "SD", "YE", "JO", "IQ", "DE"], NOW);
    const by = Object.fromEntries(reads.map((r) => [r.code, r]));
    expect(reads[0].code).toBe("IR");
    expect(by.IR.level).toBe("red");
    expect(by.IR.why).toBe("nationwide outage · government directed · since 2026-10-24");
    expect(by.IR.url).toBe("https://blog.cloudflare.com/iran-shutdown");
    expect(by.SD.level).toBe("amber");
    expect(by.YE.level).toBe("note");
    expect(by.YE.why).toBe("nationwide outage · cable cut · ended 2026-10-22");
    expect(by.JO.level).toBe("amber");
    expect(by.JO.why).toMatch(/^verified traffic anomaly/);
    expect(by.IQ.level).toBe("note");
    expect(by.IQ.why).toMatch(/^unverified traffic anomaly/);
    expect(by.DE).toBeUndefined();   // nothing → absent; the caller decides green vs UNKNOWN
  });
  it("a window excludes outages that ended before it", () => {
    const old = parseRadarOutages({ result: { annotations: [{ id: "9", description: "old", startDate: "2026-09-01T00:00:00Z", endDate: "2026-09-02T00:00:00Z", locations: ["IR"], outage: { outageType: "NATIONWIDE", outageCause: "MILITARY_ACTION" } }] } });
    expect(radarReadsFor(old, [], ["IR"], NOW)).toEqual([]);
  });
});

describe("USCYBERCOM Outages cell reads both sources", () => {
  const base: FcInput = { spectrum: null, demand: null, crew: null, straits: null, sitreps: null, ownFields: [], alerts: [] };
  const cell = (i: FcInput) => functionalRows(i)[2].cells.find((c) => c.key === "outages")!;
  it("green only when a source answered; Radar not configured is named, never read as no outage", () => {
    const both = cell({ ...base, outages: { ioda: true, radar: { configured: true, live: true, reason: null } } });
    expect(both.led).toBe("g");
    expect(both.text).toBe("no nationwide outage alert in a tracked country (IODA + Cloudflare Radar)");
    const noRadar = cell({ ...base, outages: { ioda: true, radar: { configured: false, live: false, reason: "CLOUDFLARE_RADAR_TOKEN not set" } } });
    expect(noRadar.led).toBe("g");
    expect(noRadar.detail.join(" ")).toMatch(/Cloudflare Radar not configured/);
    const neither = cell({ ...base, outages: { ioda: false, radar: { configured: true, live: false, reason: "HTTP 403" } } });
    expect(neither.led).toBe("u");
    expect(neither.text).toMatch(/neither outage source answered/);
  });
  it("a Radar alert is red on the cell like an IODA one", () => {
    const c = cell({ ...base, alerts: [{ id: "outage-cf-Iran", severity: "red", kind: "spectrum", title: "Nationwide outage — Iran", sub: "Cloudflare Radar: nationwide outage · government directed · since 2026-10-24", aor: "CENTCOM" }], outages: { ioda: true, radar: { configured: true, live: true, reason: null } } });
    expect(c.led).toBe("r");
    expect(c.text).toBe("Nationwide outage — Iran");
  });
});
