import { describe, it, expect } from "vitest";
import { parseSigmets, parseSigmetRow, sigmetTime, sigmetHazard, sigmetLine, textPolygon } from "@/lib/sigmetParse";

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

describe("the production rows (diag 2026-11-05)", () => {
  // Verbatim from /api/osint/sigmets?diag=1: the feed's coords carry only the
  // volcano; the ash cloud is the position list in the text.
  const fuego = {"icaoId":"MHTG","firId":"MHTG","firName":"MHCC CENTRAL AMERICAN","receiptTime":"2026-11-05T12:37:39.367Z","validTimeFrom":1793882100,"validTimeTo":1793903700,"seriesId":"3","hazard":"VA","qualifier":"FUEGO","base":0,"top":15000,"geom":"AREA","coords":[{"lon":-91.033,"lat":14.583}],"dir":null,"spd":null,"chng":null,"rawSigmet":"WVHO31 MHTG 051235\nMHTG SIGMET 3 VALID 051235/051835 MHTG-\nMHCC CENTRAL AMERICAN FIR VA FUEGO PSN N1428 W09052\nVA CLD OBS AT 1200Z SFC/FL150 N1435 W09102 -N1428 W09052\n-N1427 W09052 -N1428 W09104 -N1435 W09102 MOV NW 10KT \nFCST 1800Z VA CLD SFC/FL150 N1431 W09101\n-N1429 W09052 -N1427 W09052 -N1423 W09101="};
  const conv = {"icaoId":"KKCI","alphaChar":"C","seriesId":"18C","receiptTime":"2026-11-05T17:48:03.245Z","creationTime":"2026-11-05T17:55:00.000Z","validTimeFrom":1793901300,"validTimeTo":1793908500,"airSigmetType":"SIGMET","hazard":"CONVECTIVE","altitudeHi1":38000,"altitudeHi2":38000,"altitudeLow1":null,"altitudeLow2":null,"movementDir":250,"movementSpd":25,"rawAirSigmet":"CONVECTIVE SIGMET 18C","postProcessFlag":0,"severity":5,"coords":[{"lon":-98.795,"lat":38.534},{"lon":-95.617,"lat":37.149},{"lon":-97.774,"lat":34.209},{"lon":-102.123,"lat":36.208},{"lon":-100.536,"lat":37.855},{"lon":-98.795,"lat":38.534}]};
  const at = Date.parse("2026-11-05T13:00:00Z");

  it("reads the observed ash cloud from the text, not the forecast one", () => {
    const x = parseSigmetRow(fuego, "international", at)!;
    expect(x.areaFrom).toBe("text");
    expect(x.points).toHaveLength(4); // closing point dropped
    expect(x.points[0]).toEqual([14.583, -91.033]);
    expect(x.hazard).toBe("volcanic ash");
    expect(x.qualifier).toBe("FUEGO");
    expect(x.topFt).toBe(15000);
  });
  it("a lone position never starts a ring", () => {
    expect(textPolygon("VA FUEGO PSN N1428 W09052\nVA CLD OBS N1435 W09102")).toEqual([]);
    expect(textPolygon("WI S0530 E11930 - S0600 E12000 - S0630 E11900 - S0530 E11930")).toHaveLength(3);
  });
  it("keeps the feed's coordinates when they make an area, and a numeric severity is no qualifier", () => {
    const x = parseSigmetRow(conv, "domestic", at + 6 * 3_600_000)!;
    expect(x.areaFrom).toBe("coords");
    expect(x.points).toHaveLength(5);
    expect(x.qualifier).toBeNull();
    expect(x.topFt).toBe(38000);
    expect(sigmetLine(x)).toBe("CONVECTION · ?–FL380 · moving 250° 25 kt");
  });
});
