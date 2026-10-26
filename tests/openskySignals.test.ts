import { describe, it, expect } from "vitest";
import { parseOpenSkyStates, isMilitaryAircraft, bboxCredits, bboxKey, OPENSKY_DAILY_BUDGET } from "../lib/openskySignals";

describe("openskySignals — the fallback is a weaker instrument and says so", () => {
  it("parses state vectors, drops rows without a position, and attributes military only by ICAO range or callsign", () => {
    const json = { time: 1, states: [
      ["ae1234", "RCH123  ", "United States", 1, 1, 46.1, 26.2, 9000, false, 230, 90, 0, null, 9200, null, false, 0],
      ["4b1803", "SWR45  ", "Switzerland", 1, 1, 8.5, 47.4, 11000, false, 240, 180, 0, null, 11200, null, false, 0],
      ["3c6444", "REACH801", "Germany", 1, 1, 10.0, 50.0, 9000, false, 230, 90, 0, null, 9200, null, false, 0],
      ["abcdef", "", "United States", 1, 1, null, null, null, true, 0, 0, 0, null, null, null, false, 0],
      "not a row",
    ] };
    const xs = parseOpenSkyStates(json);
    expect(xs.length).toBe(3);
    expect(xs[0]).toMatchObject({ icao24: "ae1234", callsign: "RCH123", lat: 26.2, lon: 46.1, mil: true });
    expect(xs[1].mil).toBe(false);
    expect(xs[2].mil).toBe(true);                       // mobility callsign outside the US block
    expect(parseOpenSkyStates({ states: null })).toEqual([]);
    expect(parseOpenSkyStates(null)).toEqual([]);
  });
  it("isMilitaryAircraft: the US ICAO block or a known prefix; a civil airliner is never military", () => {
    expect(isMilitaryAircraft("AE4F21", "")).toBe(true);
    expect(isMilitaryAircraft("af0001", "")).toBe(true);
    expect(isMilitaryAircraft("4b1803", "RRR1234")).toBe(true);
    expect(isMilitaryAircraft("4b1803", "SWR45")).toBe(false);
    expect(isMilitaryAircraft("", "")).toBe(false);
  });
  it("bboxCredits follows OpenSky's area table and the budget stays well under the anonymous 400", () => {
    expect(bboxCredits({ latMin: 24, latMax: 28, lonMin: 50, lonMax: 56 })).toBe(1);     // 24 sq deg
    expect(bboxCredits({ latMin: 20, latMax: 30, lonMin: 40, lonMax: 49 })).toBe(2);     // 90
    expect(bboxCredits({ latMin: 20, latMax: 35, lonMin: 40, lonMax: 60 })).toBe(3);     // 300
    expect(bboxCredits({ latMin: 10, latMax: 40, lonMin: 30, lonMax: 70 })).toBe(4);     // 1200
    expect(OPENSKY_DAILY_BUDGET).toBeLessThan(400);
    expect(bboxKey({ latMin: 24.123, latMax: 28, lonMin: 50, lonMax: 56 })).toBe("24.12,28.00,50.00,56.00");
  });
});
