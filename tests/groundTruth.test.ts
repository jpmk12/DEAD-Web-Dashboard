import { describe, it, expect } from "vitest";
import { countryDisasters } from "@/lib/groundTruth";
import type { DisasterEvent } from "@/lib/types";

const mk = (p: Partial<DisasterEvent>): DisasterEvent => ({
  id: "x", type: "flood", title: "Event", severity: "green", country: "", aor: "UNKNOWN",
  lat: null, lon: null, time: "2026-06-17T00:00:00Z", magnitude: null, tsunami: false,
  summary: "", source: "GDACS", link: "https://x", nearLocations: [], hadrScore: 0, ...p,
});

const SYRIA: [number, number] = [35.0, 38.0]; // matches lib/countryCentroids

describe("countryDisasters", () => {
  it("includes in-country (name match) and excludes far events", () => {
    const events = [
      mk({ id: "in", country: "Syria", severity: "green", lat: 34, lon: 38 }),
      mk({ id: "far", country: "Spain", severity: "red", lat: 40, lon: -3 }),
    ];
    const rows = countryDisasters(events, "Syria", SYRIA);
    expect(rows.map((r) => r.title)).toEqual(["Event"]);
    expect(rows[0].km).toBeNull(); // in-country
  });

  it("includes nearby events within ~500km with a distance", () => {
    const near = mk({ id: "near", country: "Lebanon", lat: 34.5, lon: 36.0, severity: "orange" });
    const rows = countryDisasters([near], "Syria", SYRIA);
    expect(rows.length).toBe(1);
    expect(rows[0].km).not.toBeNull();
    expect(rows[0].km!).toBeLessThanOrEqual(500);
  });

  it("sorts in-country before nearby, regardless of severity", () => {
    const events = [
      mk({ id: "near-red", country: "Lebanon", lat: 34.5, lon: 36.0, severity: "red" }),
      mk({ id: "in-green", country: "Syria", lat: 34, lon: 38, severity: "green", title: "InCountry" }),
    ];
    const rows = countryDisasters(events, "Syria", SYRIA);
    expect(rows[0].title).toBe("InCountry"); // in-country wins over a red nearby one
  });

  it("returns [] when nothing matches and caps at 6", () => {
    expect(countryDisasters([mk({ country: "Spain", lat: 40, lon: -3 })], "Syria", SYRIA)).toEqual([]);
    const many = Array.from({ length: 9 }, (_, i) => mk({ id: `s${i}`, country: "Syria", lat: 34, lon: 38 }));
    expect(countryDisasters(many, "Syria", SYRIA).length).toBe(6);
  });

  it("skips distance filtering gracefully when centroid is null", () => {
    const rows = countryDisasters([mk({ country: "Syria", lat: 34, lon: 38 })], "Syria", null);
    expect(rows.length).toBe(1); // still matched by name
  });
});
