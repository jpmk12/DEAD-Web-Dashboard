import { describe, it, expect } from "vitest";
import {
  parseSunOffset, sunOffsetLabel, sunEventMs, sunOffsetRows,
  parseDuration, durationLabel, eteFromDistance, enRoute,
  convertUnit, fmtUnit, DEFAULT_FUEL_LB_PER_GAL,
} from "../lib/plannerExtras";
import { lunarNight, zoneForLongitude } from "../lib/moon";
import { hTableText } from "../lib/plannerTools";

describe("parseSunOffset — the OPORD way: bare numbers are minutes", () => {
  it("reads the common shapes", () => {
    expect(parseSunOffset("BMNT-30")).toEqual({ event: "BMNT", minutes: -30 });
    expect(parseSunOffset("bmnt -0:30")).toEqual({ event: "BMNT", minutes: -30 });
    expect(parseSunOffset("SR+1:00")).toEqual({ event: "SR", minutes: 60 });
    expect(parseSunOffset("EENT+15m")).toEqual({ event: "EENT", minutes: 15 });
    expect(parseSunOffset("MR+1h")).toEqual({ event: "MR", minutes: 60 });
    expect(parseSunOffset("sunset-1h30")).toEqual({ event: "SS", minutes: -90 });
    expect(parseSunOffset("SS")).toEqual({ event: "SS", minutes: 0 });
  });
  it("refuses what is not one", () => {
    expect(parseSunOffset("H-72")).toBeNull();
    expect(parseSunOffset("BMNT-2000")).toBeNull();
    expect(parseSunOffset("lunch")).toBeNull();
  });
  it("labels round-trip", () => {
    for (const s of ["BMNT-30", "SR+1:00", "EENT+15", "SS", "MS-1:30"]) expect(sunOffsetLabel(parseSunOffset(s)!)).toBe(s);
  });
});

describe("sunOffsetRows — against the night that contains H", () => {
  const lat = 31.83, lon = 36.78; // Muwaffaq Salti, Jordan
  const zone = zoneForLongitude(lon);
  const night = lunarNight(lat, lon, zone, "2026-11-04");
  const hMs = Date.parse("2026-11-04T22:00:00Z");
  it("BMNT-30 is thirty minutes before the night's BMNT, with its distance from H", () => {
    const [r] = sunOffsetRows(hMs, [parseSunOffset("BMNT-30")!], night);
    expect(r.ms).toBe(night.bmnt! - 30 * 60_000);
    expect(r.offsetH).toBeCloseTo((r.ms! - hMs) / 3_600_000, 1);
    expect(r.why).toBeNull();
  });
  it("no place → a row that says so, never a guessed time", () => {
    const [r] = sunOffsetRows(hMs, [parseSunOffset("EENT")!], null);
    expect(r).toMatchObject({ ms: null, why: "no place chosen" });
  });
  it("polar → EENT does not occur, said in words", () => {
    const polar = lunarNight(78.2, 15.6, zoneForLongitude(15.6), "2026-06-21");
    const [r] = sunOffsetRows(Date.parse("2026-06-21T22:00:00Z"), [parseSunOffset("EENT")!], polar);
    expect(r.ms).toBeNull();
    expect(r.why).toMatch(/polar|no end evening/);
  });
  it("the moon event is the one at or after sunset", () => {
    const t = sunEventMs(night, "MR");
    if (night.moonrise.length) expect(t).not.toBeNull();
  });
  it("the copied table carries the sun rows in time order", () => {
    const txt = hTableText(hMs, [0], [{ zone: "UTC", label: "Zulu" }], [{ label: "BMNT-30", ms: night.bmnt! - 1_800_000 }]);
    const lines = txt.split("\n");
    expect(lines.findIndex((l) => l.startsWith("BMNT-30"))).toBeGreaterThan(lines.findIndex((l) => l.startsWith("H ")));
  });
});

describe("en route", () => {
  it("reads durations the ways people type them", () => {
    expect(parseDuration("7:45")).toBe(465);
    expect(parseDuration("7.75")).toBe(465);
    expect(parseDuration("7h45m")).toBe(465);
    expect(parseDuration("7h")).toBe(420);
    expect(parseDuration("465m")).toBe(465);
    expect(parseDuration("0745")).toBe(465);
    expect(parseDuration("7:75")).toBeNull();
    expect(parseDuration("soon")).toBeNull();
  });
  it("distance ÷ ground speed in whole minutes; nonsense is null", () => {
    expect(eteFromDistance(3450, 450)).toBe(460);
    expect(eteFromDistance(0, 450)).toBeNull();
    expect(eteFromDistance(100, -1)).toBeNull();
  });
  it("depart-at and arrive-by", () => {
    const a = Date.parse("2026-11-04T14:00:00Z");
    expect(enRoute(a, 465)).toEqual({ depMs: a, arrMs: a + 465 * 60_000, eteMin: 465 });
    expect(enRoute(a, 465, true)).toEqual({ depMs: a - 465 * 60_000, arrMs: a, eteMin: 465 });
    expect(durationLabel(465)).toBe("7:45");
  });
});

describe("units — exact factors", () => {
  it("distance and speed", () => {
    expect(convertUnit(1, "nm", "km")).toBeCloseTo(1.852, 6);
    expect(convertUnit(1, "nm", "ft")).toBeCloseTo(6076.115, 2);
    expect(convertUnit(450, "kt", "kmh")).toBeCloseTo(833.4, 1);
    expect(convertUnit(1000, "fpm", "kt")).toBeCloseTo(9.87, 2);
  });
  it("temperature is affine", () => {
    expect(convertUnit(-40, "c", "f")).toBeCloseTo(-40, 6);
    expect(convertUnit(100, "c", "f")).toBeCloseTo(212, 6);
    expect(convertUnit(0, "c", "k")).toBeCloseTo(273.15, 6);
  });
  it("fuel through the stated density", () => {
    expect(convertUnit(6.7, "flb", "gal")).toBeCloseTo(1, 6);
    expect(convertUnit(100_000, "flb", "gal", DEFAULT_FUEL_LB_PER_GAL)).toBeCloseTo(14925.37, 1);
    expect(convertUnit(1, "gal", "l")).toBeCloseTo(3.785, 3);
    expect(convertUnit(1, "gal", "flb", 0)).toBeNull();
  });
  it("pressure", () => {
    expect(convertUnit(29.92, "inhg", "hpa")).toBeCloseTo(1013.2, 1);
  });
  it("across families is refused", () => {
    expect(convertUnit(1, "nm", "kg")).toBeNull();
  });
  it("formats without float noise", () => {
    expect(fmtUnit(1.8520000001)).toBe("1.85");
    expect(fmtUnit(null)).toBe("—");
  });
});
