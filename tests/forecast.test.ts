import { describe, it, expect } from "vitest";
import { summarizeDaily, forecastLine } from "@/lib/forecast";
import { isGeocodable } from "@/lib/geocode";

const daily = (over: Record<string, unknown> = {}) => ({
  temperature_2m_max: [78], temperature_2m_min: [54],
  precipitation_probability_max: [20], weather_code: [1], wind_gusts_10m_max: [12],
  ...over,
});

describe("summarizeDaily", () => {
  it("maps a calm day with no threat", () => {
    const f = summarizeDaily("Home", daily());
    expect(f).toMatchObject({ label: "Home", highF: 78, lowF: 54, precipChance: 20, condition: "mostly clear", threat: "" });
  });

  it("flags thunderstorms as a threat", () => {
    expect(summarizeDaily("X", daily({ weather_code: [95] })).threat).toContain("thunderstorms");
    expect(summarizeDaily("X", daily({ weather_code: [96] })).condition).toBe("thunderstorms w/ hail");
  });

  it("flags high winds, snow, freezing rain, heat, and hard freeze", () => {
    expect(summarizeDaily("X", daily({ wind_gusts_10m_max: [42] })).threat).toContain("high winds 42kt");
    expect(summarizeDaily("X", daily({ weather_code: [75] })).threat).toContain("snow");
    expect(summarizeDaily("X", daily({ weather_code: [67] })).threat).toContain("freezing rain");
    expect(summarizeDaily("X", daily({ temperature_2m_max: [101] })).threat).toContain("extreme heat");
    expect(summarizeDaily("X", daily({ temperature_2m_min: [15] })).threat).toContain("hard freeze");
  });

  it("rounds and tolerates missing fields", () => {
    const f = summarizeDaily("X", { temperature_2m_max: [77.6], weather_code: [0] });
    expect(f.highF).toBe(78);
    expect(f.lowF).toBeNull();
    expect(f.precipChance).toBeNull();
    expect(f.condition).toBe("clear");
  });
});

describe("forecastLine", () => {
  it("renders a clean line with temp, condition, rain", () => {
    expect(forecastLine(summarizeDaily("Home", daily())))
      .toBe("Home: 78°/54°F, mostly clear, 20% rain");
  });
  it("appends a threat marker when present", () => {
    expect(forecastLine(summarizeDaily("Pentagon", daily({ weather_code: [95] }))))
      .toContain("⚠ thunderstorms");
  });
});

describe("isGeocodable", () => {
  it("accepts real places", () => {
    expect(isGeocodable("The Pentagon, Arlington VA")).toBe(true);
    expect(isGeocodable("123 Main St, Denver CO")).toBe(true);
  });
  it("rejects virtual meetings and junk", () => {
    for (const v of ["Zoom", "Microsoft Teams Meeting", "Google Meet", "https://zoom.us/j/123", "tbd", "  ", "x"]) {
      expect(isGeocodable(v)).toBe(false);
    }
  });
});
