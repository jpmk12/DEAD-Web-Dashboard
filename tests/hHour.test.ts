import { describe, it, expect } from "vitest";
import { lightAt, nearestLightEvent, nightDateFor, forecastHourAt, wmoWord, forecastLine, tafAt, windowsAt, scaleDayFor, summarize, type ConsiderationInput } from "../lib/hHour";
import { lunarNight } from "../lib/moon";
import { parseHourlyForecast } from "../lib/currentConditions";
import type { TafPeriod } from "../lib/types";
import type { ClosureWindow } from "../lib/sitrepSignals";

const KWRI = { lat: 40.016, lon: -74.592, zone: "America/New_York" };
const OJAQ = { lat: 31.826, lon: 36.782, zone: "Asia/Amman" };

describe("lightAt — sun state and the moon at one instant", () => {
  it("noon is day, local midnight is night, and the full moon of 26 Oct 2026 is up at night", () => {
    const noon = Date.UTC(2026, 9, 27, 17, 0);      // 13:00 EDT
    const mid = Date.UTC(2026, 9, 27, 5, 0);        // 01:00 EDT
    expect(lightAt(noon, KWRI.lat, KWRI.lon).sun).toBe("day");
    const n = lightAt(mid, KWRI.lat, KWRI.lon);
    expect(n.sun).toBe("night");
    expect(n.moonUp).toBe(true);
    expect(n.illumPct).toBeGreaterThan(95);
    expect(n.phaseName).toBe("full moon");
  });
  it("the twilight bands agree with the night's own EENT / BMNT", () => {
    const night = lunarNight(KWRI.lat, KWRI.lon, KWRI.zone, "2026-10-27");
    expect(lightAt(night.eent! - 10 * 60_000, KWRI.lat, KWRI.lon).sun).toBe("nautical");
    expect(lightAt(night.eent! + 10 * 60_000, KWRI.lat, KWRI.lon).sun).toBe("night");
    expect(lightAt(night.sunset! - 10 * 60_000, KWRI.lat, KWRI.lon).sun).toBe("day");
    expect(lightAt(night.sunset! + 10 * 60_000, KWRI.lat, KWRI.lon).sun).toBe("civil");
    expect(nearestLightEvent(night, night.bmnt! - 45 * 60_000)).toBe("0:45 before BMNT");
    expect(nearestLightEvent(night, night.sunset! + 20 * 60_000)).toBe("0:20 after sunset");   // nearer sunset than EENT
    expect(nearestLightEvent(night, night.eent! + 70 * 60_000)).toBe("1:10 after EENT");
    expect(nearestLightEvent(night, night.sunrise! + 12 * 3_600_000)).toBeNull();
  });
  it("nightDateFor: afternoon and evening belong to the date, the small hours to the day before", () => {
    expect(nightDateFor(Date.UTC(2026, 9, 27, 22, 0), KWRI.zone)).toBe("2026-10-27");   // 18:00 EDT
    expect(nightDateFor(Date.UTC(2026, 9, 28, 7, 0), KWRI.zone)).toBe("2026-10-27");    // 03:00 EDT the next morning
    expect(nightDateFor(Date.UTC(2026, 9, 28, 16, 30), KWRI.zone)).toBe("2026-10-28");  // 12:30 EDT
  });
});

describe("forecast hour", () => {
  const json = { hourly: { time: ["2026-10-30T05:00", "2026-10-30T06:00", "2026-10-30T07:00"], temperature_2m: [50, 52, null], wind_speed_10m: [8, 10, 12], wind_direction_10m: [270, 280, 290], wind_gusts_10m: [12, 30, 40], precipitation_probability: [10, 70, 0], weather_code: [3, 61, 95], cloud_cover: [90, 100, 80], visibility: [16093, 1609, 800] } };
  const hourly = parseHourlyForecast(json);
  it("parses every column and converts visibility to statute miles", () => {
    expect(hourly).toHaveLength(3);
    expect(hourly[0]).toEqual({ time: "2026-10-30T05:00", tempF: 50, windMph: 8, windDir: 270, gustMph: 12, precipPct: 10, weatherCode: 3, cloudPct: 90, visMi: 10 });
    expect(hourly[2].tempF).toBeNull();
    expect(hourly[2].visMi).toBe(0.5);
    expect(parseHourlyForecast({})).toEqual([]);
  });
  it("the sample stands for the hour beginning at its stamp", () => {
    const h = forecastHourAt(hourly, Date.UTC(2026, 9, 30, 10, 20), KWRI.zone);   // 06:20 EDT
    expect(h?.time).toBe("2026-10-30T06:00");
    expect(forecastHourAt(hourly, Date.UTC(2026, 9, 31, 10, 20), KWRI.zone)).toBeNull();
  });
  it("words and the line", () => {
    expect(wmoWord(0)).toBe("clear");
    expect(wmoWord(95)).toBe("thunderstorm");
    expect(wmoWord(null)).toBe("—");
    expect(forecastLine(hourly[1])).toBe("rain · 52°F · wind 280° 10 mph G30 · precip 70% · cloud 100% · vis 1 mi");
  });
});

describe("tafAt — the base period plus a worse TEMPO", () => {
  const p = (from: string, to: string, changeType: string, cat: TafPeriod["flightCategory"], summary: string): TafPeriod => ({ from, to, changeType, flightCategory: cat, summary });
  const periods = [
    p("2026-10-29T18:00:00Z", "2026-10-30T06:00:00Z", "", "VFR", "wind 270 at 10"),
    p("2026-10-30T06:00:00Z", "2026-10-30T18:00:00Z", "FM", "MVFR", "ceiling 2,000 ft"),
    p("2026-10-30T08:00:00Z", "2026-10-30T12:00:00Z", "TEMPO", "IFR", "vis 2 mi rain"),
  ];
  it("picks the covering base period, applies the overlapping TEMPO, and is null past validity", () => {
    expect(tafAt(periods, Date.UTC(2026, 9, 30, 2, 0))).toEqual({ cat: "VFR", summary: "wind 270 at 10", tempo: null });
    const t = tafAt(periods, Date.UTC(2026, 9, 30, 9, 0))!;
    expect(t.cat).toBe("IFR");
    expect(t.summary).toBe("ceiling 2,000 ft");
    expect(t.tempo?.changeType).toBe("TEMPO");
    expect(tafAt(periods, Date.UTC(2026, 9, 30, 15, 0))?.cat).toBe("MVFR");
    expect(tafAt(periods, Date.UTC(2026, 9, 31, 0, 0))).toBeNull();
  });
});

describe("windows and scale days", () => {
  const w = (label: string, fromMs: number, toMs: number, extra: Partial<ClosureWindow> = {}): ClosureWindow => ({ label, kind: "closure", fromMs, toMs, openEnded: false, beyondHorizon: false, text: "", ...extra });
  it("windowsAt keeps the covering ones and every indeterminate schedule", () => {
    const H = 1_000_000;
    const ws = [w("RWY 06/24", 0, 2_000_000), w("TWY A", 2_000_000, 3_000_000), w("ILS RWY 24", 0, 10, { kind: "us", indeterminate: true })];
    expect(windowsAt(ws, H).map((x) => x.label)).toEqual(["RWY 06/24", "ILS RWY 24"]);
  });
  it("scaleDayFor: today, a dated outlook row, an undated row by index, else null", () => {
    const now = Date.UTC(2026, 9, 27, 12, 0);
    const scales = { now: { date: "2026-10-27", R: 1, S: null, G: 0 }, outlook: [{ date: "", R: null, S: null, G: null, probs: { rMinor: 10, rMajor: 1, s: 1 } }, { date: "2026-10-29", R: null, S: null, G: 3 }, { date: "", R: null, S: null, G: null }] };
    expect(scaleDayFor(scales, now + 3_600_000, now)?.R).toBe(1);
    expect(scaleDayFor(scales, Date.UTC(2026, 9, 28, 1, 0), now)?.probs?.rMinor).toBe(10);
    expect(scaleDayFor(scales, Date.UTC(2026, 9, 29, 1, 0), now)?.G).toBe(3);
    expect(scaleDayFor(scales, Date.UTC(2026, 10, 5, 1, 0), now)).toBeNull();
    expect(scaleDayFor(null, now, now)).toBeNull();
  });
});

describe("summarize — ranked, and a dead source reads UNKNOWN", () => {
  const now = Date.UTC(2026, 9, 27, 12, 0);
  const H = Date.UTC(2026, 9, 30, 6, 0);
  const night = lunarNight(OJAQ.lat, OJAQ.lon, OJAQ.zone, "2026-10-29");
  const base: ConsiderationInput = {
    hMs: H, nowMs: now, placeLabel: "OJAQ", zone: OJAQ.zone,
    light: lightAt(H, OJAQ.lat, OJAQ.lon), night,
    forecast: { live: true, hour: { time: "2026-10-30T09:00", tempF: 61, windMph: 8, windDir: 90, gustMph: 12, precipPct: 5, weatherCode: 1, cloudPct: 10, visMi: 10 }, horizonDays: 7 },
    hazard: null, hazardWindowH: 30,
    airfield: { icao: "OJAQ", metarCat: "VFR", tafLive: true, taf: { cat: "VFR", summary: "wind 090 at 8", tempo: null }, tafValidToMs: H + 3_600_000, notamsLive: true, notamsConfigured: true, fieldClosed: false, windows: [] },
    posture: { composite: "amber", country: "Jordan", signal: "Active conflict reporting" },
    holidays: [], holidaysKnown: true,
    scaleDay: { date: "2026-10-30", R: 0, S: 0, G: 0 }, scalesLive: true,
  };
  it("a quiet picture reads green / info and names the light", () => {
    const s = summarize(base);
    expect(s.some((c) => c.tone === "r")).toBe(false);
    expect(s.find((c) => c.source === "DAIP")?.text).toMatch(/no closure or outage window at H/);
    expect(s.find((c) => c.source === "AWC TAF")?.tone).toBe("g");
    expect(s.find((c) => c.source === "Force posture")?.tone).toBe("a");
    expect(s.find((c) => /^H in /.test(c.text))).toBeDefined();
    expect(s[0].tone).toBe("a");   // ranked: amber before info before green
  });
  it("a runway closure at H, an IFR TAF and a thunderstorm are red and lead", () => {
    const s = summarize({ ...base,
      airfield: { ...base.airfield!, windows: [{ label: "RWY 06/24", kind: "closure", fromMs: H - 1, toMs: H + 1, openEnded: false, beyondHorizon: false, text: "" }], taf: { cat: "IFR", summary: "vis 1 mi", tempo: null } },
      forecast: { ...base.forecast, hour: { ...base.forecast.hour!, weatherCode: 95, gustMph: 40 } },
    });
    expect(s[0].tone).toBe("r");
    expect(s.filter((c) => c.tone === "r").map((c) => c.source)).toEqual(expect.arrayContaining(["DAIP", "AWC TAF", "Open-Meteo"]));
    expect(s.find((c) => c.source === "Open-Meteo")?.text).toMatch(/thunderstorm, gusts 40 mph/);
  });
  it("dead feeds read UNKNOWN, never clear; a far H is beyond the horizons", () => {
    const far = H + 20 * 86_400_000;
    const s = summarize({ ...base, hMs: far, forecast: { live: false, hour: null, horizonDays: 7 }, airfield: { ...base.airfield!, tafLive: false, taf: null, notamsLive: false }, scaleDay: null, scalesLive: false, holidaysKnown: false, posture: null, postureKnown: false });
    const u = s.filter((c) => c.tone === "u").map((c) => c.text);
    expect(u.some((t) => /DAIP unreachable/.test(t))).toBe(true);
    expect(u.some((t) => /TAF unreachable/.test(t))).toBe(true);
    expect(u.some((t) => /Open-Meteo unreachable/.test(t))).toBe(true);
    expect(u.some((t) => /SWPC unreachable/.test(t))).toBe(true);
    expect(u.some((t) => /holidays UNKNOWN/.test(t))).toBe(true);
    expect(u.some((t) => /posture UNKNOWN/.test(t))).toBe(true);
    const s2 = summarize({ ...base, hMs: far, forecast: { live: true, hour: null, horizonDays: 7 }, airfield: null, scaleDay: null });
    expect(s2.find((c) => c.source === "Open-Meteo")?.text).toMatch(/beyond the 7-day forecast/);
    expect(s2.find((c) => c.source === "SWPC")?.text).toMatch(/beyond the 3-day/);
  });
  it("a holiday on H day is amber; a TAF that ends before H says so", () => {
    const s = summarize({ ...base, holidays: [{ date: "2026-10-30", label: "Independence Day" }], airfield: { ...base.airfield!, taf: null, tafValidToMs: H - 6 * 3_600_000 } });
    expect(s.find((c) => c.source === "Nager.Date")?.tone).toBe("a");
    expect(s.find((c) => c.source === "AWC TAF")?.text).toMatch(/the TAF ends 6\.0 h before H/);
  });
});
