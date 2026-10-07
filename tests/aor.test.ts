import { describe, expect, it } from "vitest";
import { aorFromCoords, aorFromCountry, classifyAor } from "../lib/aor";

// The Weather-tab bug of 2026-10-07: Erbil (36.2°N, Iraq) rendered under
// USEUCOM because the coordinate band puts everything above 36°N between the
// Atlantic and Iran in EUCOM, and US fields with no coordinates on record
// rendered under "—". Classification is COUNTRY-first now; coordinates settle
// only the cases with no country; 0/0 is "no coordinates", never the Gulf of
// Guinea.

describe("aorFromCountry", () => {
  it("matches a whole country name, any case", () => {
    expect(aorFromCountry("Iraq")).toBe("CENTCOM");
    expect(aorFromCountry("united states")).toBe("NORTHCOM");
    expect(aorFromCountry("Germany")).toBe("EUCOM");
    expect(aorFromCountry("South Korea")).toBe("INDOPACOM");
  });
  it("is exact — a label that merely contains a country token is not a country", () => {
    expect(aorFromCountry("Robins AFB, Georgia")).toBe("UNKNOWN");
    expect(aorFromCountry("")).toBe("UNKNOWN");
    expect(aorFromCountry(null)).toBe("UNKNOWN");
  });
});

describe("classifyAor", () => {
  it("puts Erbil in CENTCOM by its country even though its latitude reads EUCOM", () => {
    expect(aorFromCoords(36.19, 43.96)).toBe("EUCOM"); // the band that caused the bug
    expect(classifyAor({ lat: 36.19, lon: 43.96, name: "Iraq" })).toBe("CENTCOM");
  });
  it("falls back to coordinates when there is no country", () => {
    expect(classifyAor({ lat: 34.67, lon: -99.33 })).toBe("NORTHCOM"); // Altus
    expect(classifyAor({ lat: 36.19, lon: 43.96 })).toBe("EUCOM");
  });
  it("treats 0/0 as no coordinates and does not call it AFRICOM", () => {
    expect(classifyAor({ lat: 0, lon: 0 })).toBe("UNKNOWN");
    expect(classifyAor({ lat: 0, lon: 0, name: "United States" })).toBe("NORTHCOM");
  });
  it("uses the substring match only as the last resort for free text", () => {
    expect(classifyAor({ name: "Robins AFB, Georgia" })).toBe("EUCOM"); // free text — the Caucasus token; coordinates or a country would win
    expect(classifyAor({ lat: 32.64, lon: -83.59, name: "Robins AFB, Georgia" })).toBe("NORTHCOM");
  });
});
