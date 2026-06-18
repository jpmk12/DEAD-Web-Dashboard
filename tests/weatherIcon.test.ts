import { describe, it, expect } from "vitest";
import { conditionIconId, wmoIconId } from "@/lib/weatherIcon";

describe("conditionIconId (NWS shortForecast → glyph)", () => {
  it("storm wins even when the text also mentions showers", () => {
    expect(conditionIconId("Chance Showers And Thunderstorms")).toBe("storm");
    expect(conditionIconId("Severe Thunderstorms")).toBe("storm");
  });
  it("snow / wintry", () => {
    expect(conditionIconId("Snow Showers")).toBe("snow");
    expect(conditionIconId("Wintry Mix")).toBe("snow");
    expect(conditionIconId("Freezing Rain")).toBe("snow");
  });
  it("rain", () => {
    expect(conditionIconId("Rain Likely")).toBe("rain");
    expect(conditionIconId("Slight Chance Light Drizzle")).toBe("rain");
  });
  it("fog / haze", () => {
    expect(conditionIconId("Patchy Fog")).toBe("fog");
    expect(conditionIconId("Haze")).toBe("fog");
  });
  it("partly/mostly mixes map to sun-cloud, day vs night", () => {
    expect(conditionIconId("Mostly Sunny", true)).toBe("cloudsun");
    expect(conditionIconId("Partly Cloudy", false)).toBe("cloudmoon");
  });
  it("plain cloudy / overcast", () => {
    expect(conditionIconId("Mostly Cloudy")).toBe("cloud");
    expect(conditionIconId("Overcast")).toBe("cloud");
  });
  it("clear/sunny respects day vs night", () => {
    expect(conditionIconId("Sunny", true)).toBe("sun");
    expect(conditionIconId("Clear", false)).toBe("moon");
  });
  it("empty / unknown falls back to a mild glyph (never a false 'clear')", () => {
    expect(conditionIconId("", true)).toBe("cloudsun");
    expect(conditionIconId("Smoke and volcanic ash", true)).toBe("fog");
  });
});

describe("wmoIconId (Open-Meteo WMO code → glyph)", () => {
  it("maps the code ranges", () => {
    expect(wmoIconId(0, true)).toBe("sun");
    expect(wmoIconId(0, false)).toBe("moon");
    expect(wmoIconId(2, true)).toBe("cloudsun");
    expect(wmoIconId(3)).toBe("cloud");
    expect(wmoIconId(48)).toBe("fog");
    expect(wmoIconId(63)).toBe("rain");
    expect(wmoIconId(75)).toBe("snow");
    expect(wmoIconId(82)).toBe("rain");
    expect(wmoIconId(86)).toBe("snow");
    expect(wmoIconId(95)).toBe("storm");
    expect(wmoIconId(99)).toBe("storm");
  });
});
