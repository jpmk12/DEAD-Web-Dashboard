import { describe, it, expect } from "vitest";
import { parseRadarOutages, parseRadarAnomalies, radarOutageLevel, radarReadsFor, RADAR_LEVEL_ORDINAL, describeRadarError, normalizeRadarToken, describeTokenShape, firstNonAscii, isByteStringError } from "../lib/radarSignals";
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
  it("reads countries from every location shape the API has used (the first live rows parsed none)", () => {
    const row = (loc: Record<string, unknown>) => ({ result: { annotations: [{ id: "x", startDate: "2026-10-25T00:00:00Z", outage: { outageType: "NATIONWIDE" }, ...loc }] } });
    expect(parseRadarOutages(row({ locations: ["UA"] }))[0].countries).toEqual([{ code: "UA", name: "UA" }]);
    expect(parseRadarOutages(row({ locations: [{ code: "ua", name: "Ukraine" }] }))[0].countries).toEqual([{ code: "UA", name: "Ukraine" }]);
    expect(parseRadarOutages(row({ locationsDetails: [{ code: "RU", name: "Russia" }], locations: ["RU"] }))[0].countries).toEqual([{ code: "RU", name: "Russia" }]);
    expect(parseRadarOutages(row({ location: "ir" }))[0].countries).toEqual([{ code: "IR", name: "IR" }]);
    expect(parseRadarOutages(row({ locations: [] }))[0]).toMatchObject({ countries: [], countriesVia: null });
  });
  it("walks the newer containers the live rows carry beside empty locations — entities / origins / geoIds (2026-10-27)", () => {
    const row = (loc: Record<string, unknown>) => ({ result: { annotations: [{ id: "x", startDate: "2026-10-25T00:00:00Z", locations: [], locationsDetails: [], outage: { outageType: "REGIONAL" }, ...loc }] } });
    expect(parseRadarOutages(row({ entities: { asns: [], locations: ["UA"] } }))[0]).toMatchObject({ countries: [{ code: "UA", name: "UA" }], countriesVia: "named" });
    expect(parseRadarOutages(row({ origins: ["RU"], originsDetails: [{ code: "RU", name: "Russia" }] }))[0].countries).toEqual([{ code: "RU", name: "Russia" }]);
    expect(parseRadarOutages(row({ geoIds: ["UA-30", "UA-32"] }))[0].countries).toEqual([{ code: "UA", name: "UA" }]);
    expect(parseRadarOutages(row({ entities: { locations: [{ alpha2: "ua", name: "Ukraine" }] } }))[0].countries).toEqual([{ code: "UA", name: "Ukraine" }]);
    // Never from prose or ASN lists: a description and `asns` are not places.
    expect(parseRadarOutages(row({ description: "UA strikes on RU", asns: [12], entities: { asns: [12] } }))[0].countries).toEqual([]);
  });
  it("places a NETWORK annotation with no location at its networks' registration country, and says so", () => {
    const j = { result: { annotations: [{ id: "n", startDate: "2026-10-25T00:00:00Z", locations: [], locationsDetails: [], asns: [27364], asnsDetails: [{ asn: 27364, name: "Armstrong", location: { code: "US", name: "United States" } }], outage: { outageType: "NETWORK", outageCause: "UNKNOWN" } }] } };
    const o = parseRadarOutages(j)[0];
    expect(o).toMatchObject({ countries: [{ code: "US", name: "United States" }], countriesVia: "asn" });
    const read = radarReadsFor([o], [], ["US"], NOW)[0];
    expect(read.level).toBe("amber");
    expect(read.why).toMatch(/placed by the network's registration — the annotation names no country$/);
    // A named location wins over the placement.
    const named = parseRadarOutages({ result: { annotations: [{ ...j.result.annotations[0], locations: ["CA"] }] } })[0];
    expect(named).toMatchObject({ countries: [{ code: "CA", name: "CA" }], countriesVia: "named" });
  });
  it("reads anomalies, keeping the type vocabulary strict; an AS anomaly takes its network's country as a placement", () => {
    const xs = parseRadarAnomalies(ANOMALIES);
    expect(xs.map((x) => x.id).sort()).toEqual(["a1", "a2", "a3"]);
    expect(xs.find((x) => x.id === "a1")).toMatchObject({ type: "LOCATION", status: "VERIFIED", country: { code: "JO", name: "Jordan" }, countryVia: "location" });
    expect(xs.find((x) => x.id === "a3")).toMatchObject({ type: "AS", asn: 48832, country: null, countryVia: null });
    // The live shape (2026-10-27): locationDetails null, asnDetails.location carries the country.
    const eg = parseRadarAnomalies({ result: { trafficAnomalies: [{ uuid: "e", type: "AS", status: "VERIFIED", startDate: "2026-10-25T21:00:00Z", endDate: null, locationDetails: null, asnDetails: { asn: "8452", name: "TE-AS", location: { code: "EG", name: "Egypt" } } }] } })[0];
    expect(eg).toMatchObject({ asn: 8452, country: { code: "EG", name: "Egypt" }, countryVia: "asn" });
    // Listed on Egypt's read, never a level — one ISP is not the country's traffic.
    const read = radarReadsFor([], [eg], ["EG"], NOW)[0];
    expect(read.level).toBe("note");
    expect(read.anomalies).toHaveLength(1);
    expect(read.why).toBe("verified network anomaly (AS8452) · since 2026-10-25 · placed by the network's registration");
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

describe("describeRadarError — the error body names the class, the token never rides along", () => {
  it("a malformed Authorization header is HTTP 400 code 6003, and reads as the TOKEN, not the query", () => {
    const body = JSON.stringify({ success: false, errors: [{ code: 6003, message: "Invalid request headers", error_chain: [{ code: 6111, message: "Invalid format for Authorization header" }] }], messages: [], result: null });
    const e = describeRadarError(400, body);
    expect(e.cls).toBe("token");
    expect(e.detail).toBe("HTTP 400 — 6003 Invalid request headers › 6111 Invalid format for Authorization header");
    expect(e.hint).toMatch(/Custom API Token/);
    expect(e.hint).toMatch(/not the Global API Key/);
  });
  it("a refused parameter reads as the QUERY and keeps the message", () => {
    const e = describeRadarError(400, JSON.stringify({ success: false, errors: [{ code: 1000, message: "limit must be at most 100" }] }));
    expect(e.cls).toBe("query");
    expect(e.detail).toBe("HTTP 400 — 1000 limit must be at most 100");
  });
  it("401 / 403 / 9109 are the token; 429 is the rate; a bodiless 400 is named as such", () => {
    expect(describeRadarError(403, JSON.stringify({ errors: [{ code: 9109, message: "Invalid access token" }] })).cls).toBe("token");
    expect(describeRadarError(401, "").cls).toBe("token");
    expect(describeRadarError(429, "<html>").cls).toBe("rate");
    const bare = describeRadarError(400, null);
    expect(bare.cls).toBe("other");
    expect(bare.detail).toBe("HTTP 400");
    expect(bare.hint).toMatch(/no error body/);
  });
  it("a hostile body is capped and only codes + messages survive", () => {
    const e = describeRadarError(400, JSON.stringify({ errors: [{ code: 1, message: "x".repeat(2000), secret: "Bearer abc" }] }));
    expect(e.detail.length).toBeLessThanOrEqual(400);
    expect(e.detail).not.toMatch(/Bearer/);
  });
});

describe("normalizeRadarToken / describeTokenShape — paste defects stripped, shape named, characters never", () => {
  const tok = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_Ab";   // 40 chars, the API-token alphabet
  it("strips quotes, a Bearer prefix and whitespace; empty → null", () => {
    expect(normalizeRadarToken(`  "${tok}"  `)).toBe(tok);
    expect(normalizeRadarToken(`Bearer ${tok}`)).toBe(tok);
    expect(normalizeRadarToken(`'bearer ${tok}'`)).toBe(tok);
    expect(normalizeRadarToken(`${tok}\n`)).toBe(tok);
    expect(normalizeRadarToken("   ")).toBeNull();
    expect(normalizeRadarToken(undefined)).toBeNull();
  });
  it("names the shape and the defects, and the token's characters are not in the result", () => {
    const s = describeTokenShape(`"Bearer ${tok}"`)!;
    expect(s).toMatchObject({ length: 40, looksLike: "api-token" });
    expect(s.stripped).toEqual(expect.arrayContaining(["quotes", "bearer-prefix"]));
    expect(JSON.stringify(s)).not.toContain(tok.slice(0, 8));
    expect(describeTokenShape("0123456789abcdef0123456789abcdef01234")).toMatchObject({ looksLike: "global-api-key", charset: "hex" });
    expect(describeTokenShape("short")).toMatchObject({ looksLike: "unknown", charset: "token-alphabet" });
    // The token that verified `active` in production on 2026-10-27 is 53 chars — 40 is not the only length.
    expect(describeTokenShape("abcdefghij0123456789Xklmnopqrstuvwxyz_ABCDEFGHIJKLMN-")).toMatchObject({ length: 53, looksLike: "api-token" });
    expect(describeTokenShape("v1.0-abcdef0123456789abcdef0123456789abcdef01234567")!.looksLike).toBe("origin-ca-key");
    // The 2026-10-27 production value: 54 chars, a character outside the token alphabet → Cloudflare's 6111.
    expect(describeTokenShape("abc.def/ghi+jkl=mnopqrstuvwxyz0123456789ABCDEFGHIJKLMN")).toMatchObject({ length: 54, looksLike: "unknown", charset: "other", nonAscii: null });
  });
  it("a look-alike letter from another alphabet is named by position and script, never printed; invisibles are stripped", () => {
    // The second 2026-10-27 value: a Cyrillic Х (U+0425) at position 21 — Node's fetch refuses the header.
    const typed = "abcdefghij0123456789" + "Х" + "klmnopqrstuvwxyzABCDEFGHIJKLMNOP";
    const s = describeTokenShape(typed)!;
    expect(s.length).toBe(53);
    expect(s.charset).toBe("other");
    expect(s.nonAscii).toEqual({ position: 21, codePoint: 0x0425, script: "Cyrillic" });
    expect(JSON.stringify(s)).not.toContain("Х");
    expect(firstNonAscii("plainASCII_-09")).toBeNull();
    expect(firstNonAscii("abΧcd")!.script).toBe("Greek");
    expect(isByteStringError("Cannot convert argument to a ByteString because the character at index 27 has a value of 1061 which is greater than 255.")).toBe(true);
    expect(isByteStringError("fetch failed")).toBe(false);
    // A zero-width space and a BOM are invisible paste defects — stripped, and said so.
    const inv = describeTokenShape(`﻿${tok}​`)!;
    expect(inv).toMatchObject({ length: 40, looksLike: "api-token", charset: "token-alphabet", nonAscii: null });
    expect(inv.stripped).toContain("invisible");
    expect(normalizeRadarToken(` ${tok} `)).toBe(tok);
    expect(describeTokenShape("")).toBeNull();
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
