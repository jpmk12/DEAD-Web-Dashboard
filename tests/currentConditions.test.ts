import { describe, it, expect } from "vitest";
import { parseCurrent } from "@/lib/currentConditions";

const sample = {
  current: {
    temperature_2m: 85.6, relative_humidity_2m: 22, apparent_temperature: 83.9,
    is_day: 1, weather_code: 0, wind_speed_10m: 9.7, wind_direction_10m: 220, wind_gusts_10m: 18.3,
  },
  daily: {
    sunrise: ["2026-06-17T05:42"], sunset: ["2026-06-17T20:24"],
    temperature_2m_max: [88.1], temperature_2m_min: [57.6],
    precipitation_probability_max: [10], weather_code: [1],
  },
};

describe("parseCurrent", () => {
  it("parses + rounds the current block", () => {
    const c = parseCurrent(sample)!;
    expect(c.tempF).toBe(86);
    expect(c.feelsLikeF).toBe(84);
    expect(c.humidityPct).toBe(22);
    expect(c.windMph).toBe(10);
    expect(c.windDir).toBe(220);
    expect(c.gustMph).toBe(18);
    expect(c.isDay).toBe(true);
    expect(c.weatherCode).toBe(0);
  });

  it("parses today's daily fields", () => {
    const c = parseCurrent(sample)!;
    expect(c.highF).toBe(88);
    expect(c.lowF).toBe(58);
    expect(c.precipChancePct).toBe(10);
    expect(c.sunrise).toBe("2026-06-17T05:42");
    expect(c.sunset).toBe("2026-06-17T20:24");
  });

  it("falls back to daily weather_code when current lacks one; is_day defaults true", () => {
    const c = parseCurrent({ daily: { weather_code: [95] } })!;
    expect(c.weatherCode).toBe(95);
    expect(c.isDay).toBe(true);
    expect(c.tempF).toBeNull();
  });

  it("returns null when neither block is present", () => {
    expect(parseCurrent({})).toBeNull();
    expect(parseCurrent({ foo: 1 })).toBeNull();
  });
});

describe("parseCurrent daily outlook", () => {
  it("returns one DailyOutlook per daily.time entry (today first), capped at 7", () => {
    const c = parseCurrent({
      daily: {
        time: ["2026-10-06", "2026-10-07", "2026-10-08"],
        temperature_2m_max: [76.4, 79.1, 81.0], temperature_2m_min: [66.2, 63.0, 64.4],
        precipitation_probability_max: [30, 0, null], weather_code: [3, 0, 1],
      },
    })!;
    expect(c.daily).toHaveLength(3);
    expect(c.daily[0]).toEqual({ date: "2026-10-06", highF: 76, lowF: 66, precipPct: 30, weatherCode: 3 });
    expect(c.daily[2].precipPct).toBeNull();
    expect(c.highF).toBe(76);
  });
  it("is empty when Open-Meteo sent no daily block", () => {
    expect(parseCurrent({ current: { temperature_2m: 70 } })!.daily).toEqual([]);
  });
});
