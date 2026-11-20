import { describe, it, expect } from "vitest";
import { parseTafHazards, decodeTurbGroup, decodeShearGroup, turbGroupLabel } from "../lib/tafGroups";
import { readTurbulence, metarWindShear } from "../lib/turbulence";
import type { Sigmet } from "../lib/sigmetParse";
import type { TafPeriod } from "../lib/types";

const ISSUED = "2026-11-18T05:00:00Z";
const NOW = Date.parse("2026-11-18T06:30:00Z");
const H = 3_600_000;
const FIELD = { lat: 49.97, lon: 6.69 };
const MIL = "TAF ETAD 180500Z 1806/1912 24015G25KT 9999 BKN030 520004 QNH2992INS " +
  "BECMG 1810/1811 27020G35KT 8000 BKN015 540106 QNH2985INS " +
  "TEMPO 1812/1818 580005 WS020/27045KT " +
  "BECMG 1902/1903 VRB06KT 9999 SCT040 QNH2990INS";

describe("turbulence and wind-shear groups", () => {
  it("decodes the military group", () => {
    expect(decodeTurbGroup("520004")).toMatchObject({ intensity: "moderate", where: "clear air", frequency: "occasional", baseFtAgl: 0, topFtAgl: 4000 });
    expect(decodeTurbGroup("580005")).toMatchObject({ intensity: "severe", where: "in cloud", frequency: "occasional", baseFtAgl: 0, topFtAgl: 5000 });
    expect(decodeTurbGroup("5X0100")).toMatchObject({ intensity: "extreme", topFtAgl: null });
    expect(decodeTurbGroup("620304")).toBeNull();
    expect(turbGroupLabel(decodeTurbGroup("540106")!)).toBe("moderate turbulence (occasional in cloud) 1,000 ft–7,000 ft AGL");
  });
  it("decodes a wind-shear group", () => {
    expect(decodeShearGroup("WS020/27045KT")).toEqual({ code: "WS020/27045KT", heightFtAgl: 2000, windDir: 270, windKt: 45 });
    expect(decodeShearGroup("WS020/27045")).toBeNull();
  });
  it("places them in the period they are written in", () => {
    const hz = parseTafHazards(MIL, ISSUED, NOW);
    expect(hz.turbulence.map((g) => [g.code, g.change])).toEqual([["520004", ""], ["540106", "BECMG"], ["580005", "TEMPO"]]);
    expect(hz.shear).toHaveLength(1);
    expect(hz.shear[0]).toMatchObject({ change: "TEMPO", fromMs: Date.parse("2026-11-18T12:00:00Z"), toMs: Date.parse("2026-11-18T18:00:00Z") });
    expect(hz.groups).toEqual([]);
  });
  it("a civil TAF's wind-shear group is read without calling it military", () => {
    const hz = parseTafHazards("TAF KJFK 180500Z 1806/1912 31020G32KT P6SM SCT040 WS015/32050KT", ISSUED, NOW);
    expect(hz.military).toBe(false);
    expect(hz.shear).toHaveLength(1);
  });
});

describe("metarWindShear", () => {
  it("reads a wind-shear report", () => {
    expect(metarWindShear("ETAD 180650Z 27025G40KT 9999 BKN020 05/01 Q1002 WS R23")).toBe("RWY 23");
    expect(metarWindShear("KXXX 180650Z 27025KT WS ALL RWY")).toBe("all runways");
    expect(metarWindShear("KXXX 180650Z 27005KT 10SM CLR")).toBeNull();
  });
});

describe("readTurbulence", () => {
  const base = { nowMs: NOW, field: FIELD, icao: "ETAD", elevFt: 1200, metar: { windSpeedKt: 12, windGustKt: null, raw: "ETAD 180650Z 24012KT" }, taf: [] as TafPeriod[], hazards: null, sigmets: null };
  it("a military TAF group is a forecast — amber, severe leads, never red", () => {
    const r = readTurbulence({ ...base, hazards: parseTafHazards(MIL, ISSUED, NOW) });
    expect(r.level).toBe("a");
    expect(r.summary).toMatch(/^TAF TEMPO forecasts SEVERE turbulence \(occasional in cloud\)/);
    expect(r.drivers.some((d) => /low-level wind shear at 2,000 ft AGL, wind 270\/45 kt/.test(d.text))).toBe(true);
  });
  it("wind shear reported in the METAR is observed — red", () => {
    const r = readTurbulence({ ...base, metar: { windSpeedKt: 25, windGustKt: 42, raw: "ETAD 180650Z 27025G42KT WS R23" } });
    expect(r.level).toBe("r");
    expect(r.drivers.some((d) => /17-kt gust spread/.test(d.text))).toBe(true);
  });
  it("a TAF gust spread is mechanical turbulence, amber", () => {
    const taf: TafPeriod[] = [{ from: new Date(NOW).toISOString(), to: new Date(NOW + 6 * H).toISOString(), changeType: "", flightCategory: "VFR", summary: "", windDir: 270, windSpeedKt: 20, windGustKt: 38 }];
    const r = readTurbulence({ ...base, taf });
    expect(r.level).toBe("a");
    expect(r.summary).toMatch(/20G38 kt .*18-kt gust spread/);
  });
  it("a SIGMET turbulence over the field in effect is warned — red", () => {
    const s = { id: "x", kind: "international", hazard: "turbulence", fir: "EDGG", series: null, qualifier: "SEV", baseFt: 0, topFt: 15000,
      fromISO: new Date(NOW - H).toISOString(), toISO: new Date(NOW + 3 * H).toISOString(),
      points: [[49, 5], [51, 5], [51, 8], [49, 8]], areaFrom: "coords", movement: null, raw: "", tone: "amber" } as unknown as Sigmet;
    const r = readTurbulence({ ...base, sigmets: { live: true, items: [s] } });
    expect(r.level).toBe("r");
    expect(r.summary).toMatch(/SIGMET turbulence \(SEV\) over the field/);
  });
  it("a civil TAF's silence is said, not read as smooth air", () => {
    const r = readTurbulence({ ...base, taf: [{ from: new Date(NOW).toISOString(), to: new Date(NOW + 6 * H).toISOString(), changeType: "", flightCategory: "VFR", summary: "", windSpeedKt: 8, windGustKt: null }], sigmets: { live: true, items: [] } });
    expect(r.level).toBe("g");
    expect(r.summary).toMatch(/civil TAF carries no turbulence forecast/);
  });
  it("nothing answered → UNKNOWN", () => {
    const r = readTurbulence({ ...base, metar: null });
    expect(r.level).toBe("u");
  });
});
