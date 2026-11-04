import { describe, it, expect } from "vitest";
import { pickHereAirfield, tripCountry, hereWhyLabel, type HereField } from "../lib/hereAirfield";

// The 2026-11-04 report: a TDY typed as "Jordan" geocodes to the country's
// centroid, which sits closer to Ben Gurion than to the hub at Aqaba.
const JORDAN_CENTROID = { lat: 31.17, lon: 36.94 };
const f = (icao: string, lat: number, lon: number, country: string, own: HereField["own"] = null, star = false): HereField =>
  ({ icao, label: icao, lat, lon, country, own, star });
const LLBG = f("LLBG", 32.01, 34.89, "Israel");
const OJAQ = f("OJAQ", 29.61, 35.02, "Jordan", "hub");
const OJMS = f("OJMS", 31.83, 36.78, "Jordan", "spoke");
const KWRI = f("KWRI", 40.02, -74.59, "United States", null, true);

describe("pickHereAirfield — role before distance", () => {
  it("the hub in the trip's country beats a nearer field across the border", () => {
    const p = pickHereAirfield(JORDAN_CENTROID, [LLBG, OJAQ, KWRI], "Jordan");
    expect(p?.icao).toBe("OJAQ");
    expect(p?.why).toBe("hub");
  });
  it("hub before spoke even when the spoke is nearer", () => {
    expect(pickHereAirfield(JORDAN_CENTROID, [OJMS, OJAQ, LLBG], "Jordan")?.icao).toBe("OJAQ");
  });
  it("with no own field, a tracked field in the trip's country beats a nearer foreign one", () => {
    const amman = f("OJAI", 31.72, 35.99, "Jordan");
    const p = pickHereAirfield({ lat: 31.9, lon: 35.3 }, [LLBG, amman], "Jordan");
    expect(p).toMatchObject({ icao: "OJAI", why: "country" });
  });
  it("with no country known it falls back to the nearest within range, said as such", () => {
    expect(pickHereAirfield(JORDAN_CENTROID, [LLBG], null)).toMatchObject({ icao: "LLBG", why: "nearest" });
  });
  it("nothing within range and nothing in the country reads null, never a field half a world away", () => {
    expect(pickHereAirfield(JORDAN_CENTROID, [KWRI], "Jordan")).toBeNull();
  });
  it("an own field outside both range and country is not picked", () => {
    const farHub = f("KDOV", 39.13, -75.47, "United States", "hub");
    expect(pickHereAirfield(JORDAN_CENTROID, [farHub, LLBG], "Jordan")?.icao).toBe("LLBG");
  });
});

describe("tripCountry", () => {
  it("reads a country label, the last comma part, or an ISO code", () => {
    expect(tripCountry("Jordan")).toBe("Jordan");
    expect(tripCountry("Amman, Jordan")).toBe("Jordan");
    expect(tripCountry("Stuttgart, DE")).toBe("Germany");
  });
  it("a city alone names no country", () => {
    expect(tripCountry("Amman", "")).toBeNull();
  });
  it("falls back to the raw location text", () => {
    expect(tripCountry("Amman", "Amman, Jordan")).toBe("Jordan");
  });
});

describe("hereWhyLabel", () => {
  it("names the reason", () => {
    expect(hereWhyLabel("hub", "Jordan")).toBe("your hub");
    expect(hereWhyLabel("country", "Jordan")).toBe("tracked field in Jordan");
    expect(hereWhyLabel("nearest", null)).toBe("nearest tracked field");
  });
});
