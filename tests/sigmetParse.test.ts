import { describe, it, expect } from "vitest";
import { parseSigmets, parseSigmetRow, sigmetTime, sigmetHazard, sigmetLine } from "@/lib/sigmetParse";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const s = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("international SIGMETs (AWC isigmet JSON)", () => {
  const rows = [
    { icaoId: "KKCI", firId: "KZWY", firName: "KZWY NEW YORK OCEANIC", seriesId: "ALFA 3", hazard: "TS", qualifier: "EMBD",
      base: null, top: 45000, validTimeFrom: s("2026-11-05T10:00:00Z"), validTimeTo: s("2026-11-05T14:00:00Z"),
      coords: [{ lat: 36, lon: -60 }, { lat: 38, lon: -58 }, { lat: 35, lon: -55 }, { lat: 36, lon: -60 }],
      dir: "NE", spd: 15, rawSigmet: "KZWY SIGMET ALFA 3 VALID 051000/051400 KKCI- EMBD TS OBS TOP FL450 MOV NE 15KT" },
    { icaoId: "RJTD", firId: "RJJJ", seriesId: "V1", hazard: "VA", validTimeFrom: "2026-11-05T09:00:00Z", validTimeTo: "2026-11-05T15:00:00Z",
      coords: [[131.0, 31.5], [131.5, 32.0], [132.0, 31.0]], rawSigmet: "RJJJ SIGMET V1 VA ERUPTION MT SAKURAJIMA VA CLD OBS FL020/120" },
    { firId: "OIIX", hazard: "TURB", validTimeFrom: s("2026-11-05T00:00:00Z"), validTimeTo: s("2026-11-05T06:00:00Z"), coords: [{ lat: 30, lon: 50 }, { lat: 31, lon: 52 }, { lat: 29, lon: 53 }] },
    { firId: "HECC", hazard: "TS", validTimeFrom: s("2026-11-05T10:00:00Z"), validTimeTo: s("2026-11-05T16:00:00Z"), coords: [] },
  ];
  const p = parseSigmets(rows, "international", NOW);
  it("keeps in-force SIGMETs, drops the expired, counts the one with no geometry", () => {
    expect(p.rows).toBe(4);
    expect(p.expired).toBe(1);
    expect(p.sigmets).toHaveLength(3);
    expect(p.noGeometry).toBe(1);
  });
  it("reads {lat,lon} objects and [lon,lat] pairs; drops a closing repeat", () => {
    const ts = p.sigmets.find((x) => x.hazard === "convection")!;
    expect(ts.points).toEqual([[36, -60], [38, -58], [35, -55]]);
    const va = p.sigmets.find((x) => x.hazard === "volcanic ash")!;
    expect(va.points[0]).toEqual([31.5, 131]);
    expect(va.tone).toBe("red");
    expect(ts.tone).toBe("amber");
  });
  it("names levels and movement", () => {
    const ts = p.sigmets.find((x) => x.hazard === "convection")!;
    expect(ts.topFt).toBe(45000);
    expect(sigmetLine(ts)).toBe("CONVECTION (EMBD) · ?–FL450 · moving NE 15 kt");
  });
});

describe("domestic SIGMETs (AWC airsigmet)", () => {
  it("drops AIRMETs and reads the domestic spellings", () => {
    const p = parseSigmets([
      { airSigmetType: "AIRMET", hazard: "IFR", validTimeTo: s("2026-11-05T18:00:00Z"), coords: [{ lat: 40, lon: -100 }, { lat: 41, lon: -99 }, { lat: 40, lon: -98 }] },
      { airSigmetType: "SIGMET", hazard: "CONVECTIVE", severity: "SEV", altitudeLow1: 0, altitudeHi1: 450, validTimeFrom: "2026-11-05 11:55:00", validTimeTo: "2026-11-05 13:55:00",
        coords: [{ lat: 33, lon: -97 }, { lat: 34, lon: -95 }, { lat: 32, lon: -94 }], rawAirSigmet: "CONVECTIVE SIGMET 12C" },
    ], "domestic", NOW);
    expect(p.airmets).toBe(1);
    expect(p.sigmets).toHaveLength(1);
    expect(p.sigmets[0].hazard).toBe("convection");
    expect(p.sigmets[0].topFt).toBe(45000);
    expect(p.sigmets[0].fromISO).toBe("2026-11-05T11:55:00.000Z"); // zone-less stamps are UTC
  });
});

describe("GeoJSON shape and times", () => {
  it("reads a GeoJSON feature", () => {
    const x = parseSigmetRow({ type: "Feature", properties: { hazard: "TC", firName: "VHHK", validTimeTo: s("2026-11-05T18:00:00Z") },
      geometry: { type: "Polygon", coordinates: [[[114, 20], [116, 20], [116, 22], [114, 20]]] } }, "international", NOW)!;
    expect(x.hazard).toBe("tropical cyclone");
    expect(x.points).toHaveLength(3);
  });
  it("time spellings", () => {
    expect(sigmetTime(1762344000)).toBe("2025-11-05T12:00:00.000Z");
    expect(sigmetTime(1762344000000)).toBe("2025-11-05T12:00:00.000Z");
    expect(sigmetTime("junk")).toBeNull();
  });
  it("hazard by code then by text", () => {
    expect(sigmetHazard("RDOACT", "")).toBe("radioactive");
    expect(sigmetHazard(null, "... SEV ICE FCST ...")).toBe("icing");
    expect(sigmetHazard("XYZ", "")).toBe("other");
  });
  it("body shapes", () => {
    expect(parseSigmets({ features: [] }, "international", NOW).rows).toBe(0);
    expect(parseSigmets({ data: [{ hazard: "TS", coords: [] }] }, "international", NOW).rows).toBe(1);
  });
});
