import { describe, it, expect } from "vitest";
import { bestEnd, runwayEnds, crosswindOutlook, windLabel } from "../lib/crosswind";
import type { TafPeriod } from "../lib/types";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const H = 3_600_000;
// Two runways: 06/24 and 18/36.
const RWYS = [
  { leIdent: "06", heIdent: "24", leHeadingDegT: 60, heHeadingDegT: 240 },
  { leIdent: "18", heIdent: "36", leHeadingDegT: 180, heHeadingDegT: 360 },
];
const tafP = (fromH: number, toH: number, dir: number | null, kt: number, gust: number | null, change = "", variable = false): TafPeriod => ({
  from: new Date(NOW + fromH * H).toISOString(), to: new Date(NOW + toH * H).toISOString(), changeType: change, flightCategory: "VFR", summary: "",
  windDir: dir, windVariable: variable, windSpeedKt: kt, windGustKt: gust, wxRaw: "",
});

describe("bestEnd", () => {
  it("picks the runway with the least crosswind, not the first listed", () => {
    // Wind 180 at 25: runway 18 is straight in, 06/24 is a 21-kt crosswind.
    const b = bestEnd(runwayEnds(RWYS), 180, 25, null)!;
    expect(b.ident).toBe("18");
    expect(b.crossKt).toBe(0);
  });
  it("prefers an end with a headwind", () => {
    const b = bestEnd(runwayEnds([RWYS[0]]), 240, 20, null)!;
    expect(b.ident).toBe("24");
    expect(b.headKt).toBe(20);
  });
  it("no wind direction, no answer", () => {
    expect(bestEnd(runwayEnds(RWYS), null, 10, null)).toBeNull();
  });
});

describe("crosswindOutlook", () => {
  it("reads TAF periods on the best runway and names the peak", () => {
    const o = crosswindOutlook({
      nowMs: NOW, runways: [RWYS[0]], metar: { windDir: 240, windVariable: false, windSpeedKt: 10, windGustKt: null },
      taf: [tafP(0, 6, 240, 10, null), tafP(6, 24, 330, 22, 34), tafP(8, 12, 330, 25, 40, "TEMPO")], model: null, contamination: [],
    });
    expect(o.source).toBe("taf");
    expect(o.rows).toHaveLength(3);
    expect(o.peak?.change).toBe("TEMPO");
    expect(o.level).toBe("r"); // 40-kt gust at 90° → gust crosswind 40 ≥ 35
    expect(o.summary).toMatch(/Peak crosswind .* \(TEMPO\)/);
  });
  it("a variable wind is listed, never computed", () => {
    const o = crosswindOutlook({ nowMs: NOW, runways: RWYS, metar: null, taf: [tafP(0, 24, null, 5, null, "", true)], model: null, contamination: [] });
    expect(o.rows[0].variable).toBe(true);
    expect(o.rows[0].best).toBeNull();
    expect(o.rows[0].wind).toBe("VRB/05");
    expect(o.level).toBe("g");
  });
  it("crosswind on a contaminated runway is amber even below the dry bands", () => {
    const o = crosswindOutlook({
      nowMs: NOW, runways: [RWYS[0]], metar: null, taf: [tafP(0, 6, 330, 16, null)], model: null,
      contamination: [{ fromMs: NOW + 2 * H, toMs: NOW + 4 * H, what: "freezing rain / drizzle (TAF)" }],
    });
    expect(o.rows[0].contaminated).toMatch(/freezing/);
    expect(o.level).toBe("a");
    expect(o.summary).toMatch(/contaminated runway/);
  });
  it("falls back to the model when the TAF carries no wind, merging hours", () => {
    const model = Array.from({ length: 6 }, (_, i) => ({ t: NOW + i * H, windDir: 240, windKt: 10, gustKt: null }));
    const o = crosswindOutlook({ nowMs: NOW, runways: [RWYS[0]], metar: null, taf: [], model, contamination: [] });
    expect(o.source).toBe("model");
    expect(o.rows).toHaveLength(1);
    expect(o.rows[0].toMs).toBe(NOW + 6 * H);
  });
  it("no runway headings is UNKNOWN, never green", () => {
    const o = crosswindOutlook({ nowMs: NOW, runways: [], metar: null, taf: [tafP(0, 6, 330, 16, null)], model: null, contamination: [] });
    expect(o.level).toBe("u");
    expect(o.summary).toMatch(/UNKNOWN/);
  });
  it("labels winds", () => {
    expect(windLabel(240, false, 18, 28)).toBe("240/18G28");
    expect(windLabel(null, true, 4, null)).toBe("VRB/04");
    expect(windLabel(0, false, 0, null)).toBe("calm");
  });
});
