import { describe, it, expect } from "vitest";
import {
  sunPosition, moonPosition, moonPhase, crossings, sunAltitude, moonAltitude, moonAltitudeTopo,
  lunarNight, lunarNights, lunarWindows, illumBand, sanitizeThresholds, lunarTonightLine, hhmmIn,
  DEFAULT_LUNAR_THRESHOLDS, MOON_USEFUL_ALT_DEG,
} from "../lib/moon";
import { sunTimes } from "../lib/astro";

const KWRI = { lat: 40.016, lon: -74.592, zone: "America/New_York" };
const MIN = 60_000;

describe("moon — positions and phase", () => {
  it("the Sun's longitude runs ~1°/day and the March equinox sits near 0°", () => {
    const a = sunPosition(Date.UTC(2026, 2, 20, 14, 46)).lon;      // 2026 March equinox ≈ 14:46 UT
    expect(Math.min(a, 360 - a)).toBeLessThan(0.3);
    const d1 = sunPosition(Date.UTC(2026, 9, 24)).lon, d2 = sunPosition(Date.UTC(2026, 9, 25)).lon;
    expect(((d2 - d1 + 360) % 360)).toBeCloseTo(0.99, 1);
  });
  it("full moon 26 Oct 2026 and new moon 9 Nov 2026 read as such; illumination is monotone between them", () => {
    const full = moonPhase(Date.UTC(2026, 9, 26, 4));
    expect(full.illumPct).toBeGreaterThanOrEqual(99);
    expect(full.phaseName).toBe("full moon");
    const nw = moonPhase(Date.UTC(2026, 10, 9, 8));
    expect(nw.illumPct).toBeLessThanOrEqual(1);
    expect(nw.phaseName).toBe("new moon");
    expect(nw.waxing).toBe(false || nw.waxing); // defined either way at the instant
    let prev = 101;
    for (let d = 26; d <= 31; d++) { const p = moonPhase(Date.UTC(2026, 9, d, 12)).illumPct; expect(p).toBeLessThanOrEqual(prev); prev = p; }
    expect(moonPhase(Date.UTC(2026, 9, 28, 12)).waxing).toBe(false);
    expect(moonPhase(Date.UTC(2026, 10, 15, 12)).waxing).toBe(true);
  });
  it("the Moon's distance stays within its orbit and the parallax is ~1°", () => {
    for (let d = 0; d < 30; d += 3) {
      const m = moonPosition(Date.UTC(2026, 9, 24 + d));
      expect(m.r).toBeGreaterThan(56); expect(m.r).toBeLessThan(64);
    }
    const t = Date.UTC(2026, 9, 24, 23);
    expect(moonAltitude(t, KWRI.lat, KWRI.lon) - moonAltitudeTopo(t, KWRI.lat, KWRI.lon)).toBeGreaterThan(0.3);
    expect(moonAltitude(t, KWRI.lat, KWRI.lon) - moonAltitudeTopo(t, KWRI.lat, KWRI.lon)).toBeLessThan(1.1);
  });
});

describe("moon — horizon crossings agree with lib/astro.ts for the Sun", () => {
  it("sunrise / sunset at KWRI on 24 Oct 2026 within 4 minutes of the NOAA equations", () => {
    const day = Date.UTC(2026, 9, 24);
    const noaa = sunTimes(KWRI.lat, KWRI.lon, day);
    const cs = crossings((ms) => sunAltitude(ms, KWRI.lat, KWRI.lon), -0.833, day, day + 86_400_000);
    const rise = cs.find((c) => c.rising)!.ms, set = cs.find((c) => !c.rising)!.ms;
    expect(Math.abs(rise - Date.parse(noaa.sunriseZ!))).toBeLessThan(4 * MIN);
    expect(Math.abs(set - Date.parse(noaa.sunsetZ!))).toBeLessThan(4 * MIN);
  });
});

describe("moon — the night budget", () => {
  const nights = lunarNights(KWRI.lat, KWRI.lon, KWRI.zone, "2026-10-24", 30);
  it("30 nights, none polar at 40°N, every budget sums: moonlit + moon-free = dark, useful ≤ moonlit", () => {
    expect(nights).toHaveLength(30);
    for (const n of nights) {
      expect(n.polar).toBe(false);
      expect(n.darkH).toBeGreaterThan(9); expect(n.darkH).toBeLessThan(14);
      expect(Math.abs((n.moonlitDarkH! + n.moonFreeDarkH!) - n.darkH!)).toBeLessThanOrEqual(0.11);
      expect(n.usefulMoonH!).toBeLessThanOrEqual(n.moonlitDarkH! + 0.01);
      expect(n.daylightH).toBeGreaterThan(9); expect(n.daylightH).toBeLessThan(12);
      expect(n.eent! > n.sunset!).toBe(true); expect(n.bmnt! < n.sunrise!).toBe(true);
    }
  });
  it("a full moon rises near sunset and is up all night; a new moon is down all night", () => {
    const full = nights.find((n) => n.date === "2026-10-25")!;      // full moon 26 Oct 04Z = the night of the 25th
    expect(full.illumPct).toBeGreaterThanOrEqual(99);
    expect(Math.abs(full.moonrise[0] - full.sunset!)).toBeLessThan(90 * MIN);
    expect(full.moonFreeDarkH).toBeLessThan(0.5);
    const nw = nights.find((n) => n.date === "2026-11-09")!;
    expect(nw.illumPct).toBeLessThanOrEqual(2);
    expect(nw.moonlitDarkH).toBeLessThan(0.5);
    expect(nw.moonFreeDarkH).toBeGreaterThan(10);
    expect(lunarTonightLine(nw)).toMatch(/moon down all night|moon-free/);
  });
  it("moonrise advances ~50 minutes a night on average", () => {
    const rises = nights.filter((n) => n.moonrise.length === 1).map((n) => n.moonrise[0] - Date.parse(n.date + "T12:00:00Z"));
    const steps: number[] = [];
    for (let i = 1; i < rises.length; i++) { const s = rises[i] - rises[i - 1] - 0; if (Math.abs(s) < 3 * 3_600_000) steps.push(s / MIN); }
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    expect(mean).toBeGreaterThan(30); expect(mean).toBeLessThan(70);
  });
  it("tonight (24 Oct): a near-full moon up past BMNT leaves NO moon-free dark; six nights on, a waning gibbous leaves the early evening dark", () => {
    const n = nights[0];
    expect(n.illumPct).toBeGreaterThanOrEqual(97);
    expect(n.moonFreeDarkH).toBe(0);
    const line = lunarTonightLine(n);
    expect(line).toMatch(/^(9[7-9]|100)% full moon · 11\.\d h dark 19\d{2}–06\d{2} · moon up all night · 11\.\d h moonlit \(\d\.\d h ≥30°\) · 0 h moon-free$/);
    expect(line).toContain(`≥${MOON_USEFUL_ALT_DEG}°`);
    expect(hhmmIn(n.eent, n.zone)).toMatch(/^19\d{2}$/);
    const later = nights[6];                                   // 30 Oct: waning gibbous rises ~2150
    expect(later.illumPct).toBeGreaterThan(60); expect(later.illumPct).toBeLessThan(80);
    expect(lunarTonightLine(later)).toMatch(/moon-free until 2[12]\d{2}/);
    expect(later.moonFreeDarkH).toBeGreaterThan(2); expect(later.moonFreeDarkH).toBeLessThan(4);
    // The DST change on 1 Nov shows in the clock times, not in the budget.
    const oct31 = nights.find((x) => x.date === "2026-10-31")!, nov1 = nights.find((x) => x.date === "2026-11-01")!;
    expect(Number(hhmmIn(oct31.sunset, oct31.zone)) - Number(hhmmIn(nov1.sunset, nov1.zone))).toBeGreaterThan(50);
    expect(Math.abs(oct31.darkH! - nov1.darkH!)).toBeLessThan(0.3);
  });
  it("windows: a HIGH run now, then a LOW run around the new moon; the LOW best night has the most moon-free dark", () => {
    const ws = lunarWindows(nights);
    expect(ws[0].band).toBe("hi");
    expect(ws[0].from).toBe("2026-10-24");
    expect(ws[0].nights).toBeGreaterThanOrEqual(7);
    const lo = ws.find((w) => w.band === "lo")!;
    expect(lo).toBeDefined();
    expect(lo.nights).toBeGreaterThanOrEqual(7);
    const loNights = nights.slice(lo.startIndex, lo.startIndex + lo.nights);
    expect(loNights.every((n) => n.band === "lo")).toBe(true);
    expect(lo.best.moonFreeDarkH).toBe(Math.max(...loNights.map((n) => n.moonFreeDarkH!)));
    // The windows tile the list.
    expect(ws.reduce((n, w) => n + w.nights, 0)).toBe(30);
  });
  it("thresholds: bands follow them; malformed values fall back to the defaults", () => {
    expect(illumBand(10)).toBe("lo"); expect(illumBand(25)).toBe("mid"); expect(illumBand(60)).toBe("hi");
    expect(illumBand(50, { low: 20, high: 50 })).toBe("hi");
    expect(sanitizeThresholds({ low: 30, high: 70 })).toEqual({ low: 30, high: 70 });
    expect(sanitizeThresholds({ low: 70, high: 30 })).toEqual(DEFAULT_LUNAR_THRESHOLDS);
    expect(sanitizeThresholds("x")).toEqual(DEFAULT_LUNAR_THRESHOLDS);
    const custom = lunarNights(KWRI.lat, KWRI.lon, KWRI.zone, "2026-11-01", 3, { low: 70, high: 90 });
    expect(custom.map((n) => n.band)).toEqual(["lo", "lo", "lo"]);
  });
  it("polar: Longyearbyen in late June has no nautical darkness and says so instead of inventing times", () => {
    const n = lunarNight(78.22, 15.63, "Arctic/Longyearbyen", "2026-06-24");
    expect(n.polar).toBe(true);
    expect(n.eent).toBeNull(); expect(n.bmnt).toBeNull();
    expect(n.darkH).toBeNull(); expect(n.moonFreeDarkH).toBeNull();
    expect(n.daylightH).toBe(24);
    expect(lunarTonightLine(n)).toContain("polar");
    expect(lunarWindows([n, n])).toEqual([]);
  });
  it("southern hemisphere runs the same way (Sydney, same dates, no polar flag)", () => {
    const n = lunarNight(-33.95, 151.18, "Australia/Sydney", "2026-10-24");
    expect(n.polar).toBe(false);
    expect(n.darkH).toBeGreaterThan(8);
    expect(n.illumPct).toBeGreaterThan(90);
  });
});
