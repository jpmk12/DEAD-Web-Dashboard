import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseAirspaceGroups } from "@/lib/airspace";
import {
  parseGpsPosition, parseGpsDisk, parseGpsPolygon, insidePolygon, levelFloorFt,
  parseGpsValidity, parseDailyWindow, gpsTiming, prnOutages, gpsNotamsForField,
  fieldGpsLine, prnLine, fuelNotamsForField, type GpsField,
} from "@/lib/gpsNotams";

// The real DAIP GPS_WAAS capture of 2026-06-17 (tests/fixtures/daip).
const fx = readFileSync(path.resolve(__dirname, "fixtures/daip/gps_waas.json"), "utf8").replace(/^﻿/, "");
const T = Date.parse("2026-06-17T16:00:00Z");     // outside EPG_AZ's DLY 0700-1100
const T_IN = Date.parse("2026-06-17T08:00:00Z");  // inside it
const all = (now: number) => parseAirspaceGroups(fx, now, 400).flatMap((g) => g.notams);

const HOLLOMAN: GpsField = { icao: "KHMN", lat: 32.852, lon: -106.106, codes: ["ZAB", "KZAB"] };
const WRIGHTSTOWN: GpsField = { icao: "KWRI", lat: 40.016, lon: -74.594, codes: ["ZNY", "KZNY"] };

describe("geometry readers", () => {
  it("reads DDMMSS positions, decimals included", () => {
    const p = parseGpsPosition("332710N1074618W")!;
    expect(p.lat).toBeCloseTo(33.4528, 3);
    expect(p.lon).toBeCloseTo(-107.7717, 3);
    const q = parseGpsPosition("383920.27N0752224.14W")!;
    expect(q.lat).toBeCloseTo(38.6556, 3);
    expect(parseGpsPosition("336010N1074618W")).toBeNull(); // 60 minutes
  });
  it("reads the test disk with every ring", () => {
    const d = parseGpsDisk("NAV GPS (EPG_AZ GPS 26-07) MAY NOT BE AVBL WI A  517NM RADIUS CENTERED AT 332710N1074618W (TCS280027) FL400-UNL,\n468NM RADIUS AT FL250, 392NM RADIUS AT 10000FT, 375NM RADIUS AT 4000FT\nAGL, 353NM RADIUS AT 50FT AGL. DLY 0700-1100.")!;
    expect(d.rings.map((r) => r.nm)).toEqual([517, 468, 392, 375, 353]);
    expect(d.rings.map((r) => r.floorFt)).toEqual([40000, 25000, 10000, 4000, 50]);
  });
  it("reads a one-ring disk to the surface", () => {
    const d = parseGpsDisk("GPS SIGNAL MAY NOT BE AVBL WI AN AREA DEFINED AS A 20NM RADIUS CENTERED AT 383920.27N0752224.14W SFC-10000FT AGL. IMPACTS ARRIVALS TO GED.")!;
    expect(d.rings).toHaveLength(1);
    expect(d.rings[0]).toMatchObject({ nm: 20, floorFt: 0 });
  });
  it("a radius disk is not a polygon; a point list is", () => {
    expect(parseGpsPolygon("DEFINED AS A 20NM RADIUS CENTERED AT 383920.27N0752224.14W")).toBeNull();
    const poly = parseGpsPolygon("WI AN AREA DEFINED AS 160038N0680019W TO 150018N0650022W TO 150030N0631533W TO 152014N0630037W TO 164558N0630011W AND BACK TO 160207N0680046W CREWS SHOULD")!;
    expect(poly).toHaveLength(6);
    expect(insidePolygon({ lat: 15.8, lon: -65.5 }, poly)).toBe(true);
    expect(insidePolygon({ lat: 18.44, lon: -66.0 }, poly)).toBe(false); // San Juan, north of the box
  });
  it("level floors", () => {
    expect(levelFloorFt("SFC-10000FT AGL")).toBe(0);
    expect(levelFloorFt("FL250")).toBe(25000);
    expect(levelFloorFt("4000FT AGL")).toBe(4000);
    expect(levelFloorFt("SEE TEXT")).toBeNull();
  });
});

describe("time", () => {
  it("reads the FAA domestic validity pair and B)/C)", () => {
    expect(parseGpsValidity("… DLY 0700-1100 2606150700-2606181100")).toEqual({ start: "2026-06-15T07:00:00.000Z", end: "2026-06-18T11:00:00.000Z" });
    expect(parseGpsValidity("… 2604241600-PERM").end).toBeUndefined();
    expect(parseGpsValidity("A) TJZS\nB) 2511101327\nC) PERM").start).toBe("2025-11-10T13:27:00.000Z");
  });
  it("a daily window decides in-effect inside the validity", () => {
    expect(parseDailyWindow("DLY 0700-1100.")).toMatchObject({ from: 420, to: 660 });
    const n = { id: "x", text: "DLY 0700-1100", rawtext: "DLY 0700-1100 2606150700-2606181100" };
    expect(gpsTiming(n, T_IN)).toBe("now");
    expect(gpsTiming(n, T)).toBe("later");
    expect(gpsTiming(n, Date.parse("2026-06-19T08:00:00Z"))).toBe("expired");
    const wrap = { id: "y", text: "DAILY 2100-0400", rawtext: "2606150000-2606300000" };
    expect(gpsTiming(wrap, Date.parse("2026-06-17T02:00:00Z"))).toBe("now");
  });
  it("the parser now expires domestic GPS NOTAMs past their validity", () => {
    const later = parseAirspaceGroups(fx, Date.parse("2026-07-01T00:00:00Z"), 400).flatMap((g) => g.notams);
    expect(later.some((n) => /EPG_AZ/.test(n.text))).toBe(false);
    expect(all(T).some((n) => /EPG_AZ/.test(n.text))).toBe(true);
  });
  it("keeps the wrapper location code", () => {
    expect(all(T).some((n) => n.loc === "KZAB")).toBe(true);
  });
});

describe("the field read", () => {
  it("Holloman sits inside the EPG test at approach level — amber only in the window", () => {
    const off = gpsNotamsForField(all(T), HOLLOMAN, T);
    const epg = off.items.find((i) => i.test === "EPG_AZ GPS 26-07")!;
    expect(epg.scope).toBe("approach");
    expect(epg.floorFt).toBe(50);
    expect(epg.timing).toBe("later");
    expect(epg.amber).toBe(false);
    const on = gpsNotamsForField(all(T_IN), HOLLOMAN, T_IN);
    expect(on.items[0].test).toBe("EPG_AZ GPS 26-07");
    expect(on.items[0].amber).toBe(true);
    expect(on.affecting).toBeGreaterThan(0);
    expect(fieldGpsLine(on.items[0])).toMatch(/inside the 353 NM ring down to 50 ft.*GPS approaches affected.*in effect now.*daily 0700–1100Z/);
  });
  it("one row per NOTAM, however many centres republished it", () => {
    const r = gpsNotamsForField(all(T_IN), HOLLOMAN, T_IN);
    const ids = r.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("a field outside every ring reads nothing from the tests", () => {
    const r = gpsNotamsForField(all(T_IN), WRIGHTSTOWN, T_IN);
    expect(r.items.filter((i) => i.scope === "approach")).toEqual([]);
    expect(r.affecting).toBe(0);
  });
  it("covered only high up is enroute, never amber", () => {
    // ~430 NM from the EPG centre: inside FL250 (468) but outside 10,000 ft (392).
    const far: GpsField = { icao: "KXXX", lat: 33.45, lon: -99.2, codes: [] };
    const epg = gpsNotamsForField(all(T_IN), far, T_IN).items.find((i) => i.test === "EPG_AZ GPS 26-07")!;
    expect(epg.scope).toBe("enroute");
    expect(epg.floorFt).toBe(25000);
    expect(epg.amber).toBe(false);
    expect(fieldGpsLine(epg)).toMatch(/FL250 and above only/);
  });
  it("a jamming area above FL300 names the field but does not touch the approach", () => {
    const sea: GpsField = { icao: "TEST", lat: 15.8, lon: -65.5, codes: [] };
    const a = gpsNotamsForField(all(T), sea, T).items.find((i) => i.scope === "area")!;
    expect(a.jamming).toBe(true);
    expect(a.floorFt).toBe(30000);
    expect(a.amber).toBe(false);
  });
  it("a geometry-less notice matches by the FIR it was published under", () => {
    const mx: GpsField = { icao: "MMMX", lat: 19.43, lon: -99.07, codes: ["MMFR"] };
    const f = gpsNotamsForField(all(T), mx, T).items.find((i) => i.scope === "fir")!;
    expect(f.id).toMatch(/B1076\/26/);
    expect(f.amber).toBe(true);
    // The same notice does not reach a field under another FIR.
    expect(gpsNotamsForField(all(T), { ...mx, codes: ["KZNY"] }, T).items.some((i) => i.scope === "fir")).toBe(false);
  });
  it("satellite outages are constellation-wide, never a field row", () => {
    const r = gpsNotamsForField(all(T), { icao: "KNMH", lat: 38.9, lon: -77.0, codes: ["KNMH"] }, T);
    expect(r.prns).toEqual([13, 20, 27]);
    expect(r.items.some((i) => /PRN/.test(i.text))).toBe(false);
    expect(prnLine(r.prns)).toMatch(/3 GPS satellites out of service \(PRN 13, 20, 27\).*RAIM prediction governs/);
    expect(prnOutages([], T)).toEqual([]);
    expect(prnLine([])).toBeNull();
  });
});

describe("fuel NOTAMs for a field", () => {
  it("matches the wrapper, the group or the ICAO as a word — not a substring", () => {
    const rows = [
      { text: "KADW JP8 NOT AVBL", loc: "KADW" },
      { text: "FUEL LTD AT KADWX", loc: "KZDC" },
      { text: "JASU INOP", group: "KADW" },
      { text: "OJAQ JET A1 NOT AVBL 1400-1800" },
      { text: "OJAQ JET A1 NOT AVBL 1400-1800" },
    ];
    expect(fuelNotamsForField(rows, "KADW")).toEqual(["KADW JP8 NOT AVBL", "JASU INOP"]);
    expect(fuelNotamsForField(rows, "OJAQ")).toEqual(["OJAQ JET A1 NOT AVBL 1400-1800"]);
    expect(fuelNotamsForField(rows, "")).toEqual([]);
  });
});
