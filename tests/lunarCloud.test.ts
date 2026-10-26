import { describe, it, expect } from "vitest";
import { skyCover, parseHourlyCloud, localIsoToMs, nightCloud, nightCloudClause } from "../lib/lunarCloud";
import { lunarNight, zoneForLongitude, lunarTonightLine, hhmmZ } from "../lib/moon";
import { zoneDayStartMs } from "../lib/effectiveZone";

const KWRI = { lat: 40.016, lon: -74.592, zone: "America/New_York" };

describe("skyCover — the aviation ladder", () => {
  it("bands by percent", () => {
    expect(skyCover(0)).toBe("CLR");
    expect(skyCover(20)).toBe("FEW");
    expect(skyCover(40)).toBe("SCT");
    expect(skyCover(70)).toBe("BKN");
    expect(skyCover(95)).toBe("OVC");
  });
});

describe("parseHourlyCloud", () => {
  it("reads Open-Meteo hourly cloud_cover, clamps, and keeps a missing value null", () => {
    const rows = parseHourlyCloud({ hourly: { time: ["2026-10-26T00:00", "2026-10-26T01:00", "2026-10-26T02:00"], cloud_cover: [12, null, 140] } });
    expect(rows).toEqual([{ time: "2026-10-26T00:00", pct: 12 }, { time: "2026-10-26T01:00", pct: null }, { time: "2026-10-26T02:00", pct: 100 }]);
    expect(parseHourlyCloud({})).toEqual([]);
  });
});

describe("nightCloud — the mean over the DARK hours only", () => {
  const night = lunarNight(KWRI.lat, KWRI.lon, KWRI.zone, "2026-10-26");
  // Build 48 hourly samples from local midnight 26 Oct: 100 % inside the dark interval, 0 % outside.
  const start = zoneDayStartMs("2026-10-26", KWRI.zone);
  const hourly = Array.from({ length: 48 }, (_, i) => {
    const ms = start + i * 3_600_000;
    const iso = new Intl.DateTimeFormat("sv-SE", { timeZone: KWRI.zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms)).replace(" ", "T");
    const inDark = ms + 3_600_000 > night.eent! && ms < night.bmnt!;
    return { time: iso, pct: inDark ? 100 : 0 };
  });
  it("sees only the dark hours", () => {
    const c = nightCloud(night, hourly, KWRI.zone)!;
    expect(c).not.toBeNull();
    expect(c.meanPct).toBe(100);
    expect(c.cover).toBe("OVC");
    expect(c.overcastH).toBe(c.samples);
    expect(c.clearH).toBe(0);
    // ~11 h of darkness in late October at 40°N → 11–12 overlapping samples.
    expect(c.samples).toBeGreaterThanOrEqual(10);
    expect(c.samples).toBeLessThanOrEqual(13);
  });
  it("is null — UNKNOWN, never clear — when the forecast does not cover the night", () => {
    expect(nightCloud(night, [], KWRI.zone)).toBeNull();
    expect(nightCloud(night, [{ time: "2026-11-20T02:00", pct: 0 }], KWRI.zone)).toBeNull();
  });
  it("is null on a polar night", () => {
    const polar = lunarNight(78.2, 15.6, "Arctic/Longyearbyen", "2026-06-21");
    expect(polar.polar).toBe(true);
    expect(nightCloud(polar, hourly, "Arctic/Longyearbyen")).toBeNull();
  });
  it("clause names the cover and the read; no forecast says so", () => {
    expect(nightCloudClause(null)).toMatch(/no forecast/);
    expect(nightCloudClause(nightCloud(night, hourly, KWRI.zone))).toMatch(/OVC/);
    expect(nightCloudClause(nightCloud(night, hourly, KWRI.zone))).toMatch(/attenuated/);
  });
});

describe("localIsoToMs", () => {
  it("places a local hour in its zone", () => {
    expect(localIsoToMs("2026-10-26T18:00", KWRI.zone)).toBe(zoneDayStartMs("2026-10-26", KWRI.zone) + 18 * 3_600_000);
    expect(localIsoToMs("garbage", KWRI.zone)).toBeNull();
  });
});

describe("zoneForLongitude + the Zulu line (airfield cards)", () => {
  it("maps longitude to a valid fixed-offset IANA zone with the inverted Etc sign", () => {
    expect(zoneForLongitude(139.7)).toBe("Etc/GMT-9");
    expect(zoneForLongitude(-74.6)).toBe("Etc/GMT+5");
    expect(zoneForLongitude(0)).toBe("Etc/GMT");
    expect(zoneForLongitude(179)).toBe("Etc/GMT-12");
    for (const lon of [139.7, -74.6, 0, 179, -180]) expect(() => new Intl.DateTimeFormat("en-US", { timeZone: zoneForLongitude(lon) })).not.toThrow();
  });
  it("a Japanese field's night lands on the right night (not polar) under its longitude zone", () => {
    const n = lunarNight(35.7, 139.3, zoneForLongitude(139.3), "2026-10-26");
    expect(n.polar).toBe(false);
    expect(n.darkH).toBeGreaterThan(9);
    // EENT in Zulu for Tokyo late October ≈ 0800–0900Z.
    const z = hhmmZ(n.eent);
    expect(z).toMatch(/^0[789]\d\dZ$/);
  });
  it("lunarTonightLine takes a formatter so the card can print Zulu", () => {
    const n = lunarNight(KWRI.lat, KWRI.lon, KWRI.zone, "2026-10-26");
    const line = lunarTonightLine(n, hhmmZ);
    expect(line).toMatch(/\d{4}Z–\d{4}Z/);
    expect(line).toMatch(/h dark/);
  });
});
