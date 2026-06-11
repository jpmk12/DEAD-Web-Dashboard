import { describe, it, expect } from "vitest";
import { dedupe, haversineKm, computeHadrScore } from "@/lib/disasters";
import type { DisasterEvent } from "@/lib/types";

const ev = (over: Partial<DisasterEvent>): DisasterEvent => ({
  id: Math.random().toString(36).slice(2),
  type: "earthquake",
  title: "test",
  severity: "orange",
  country: "",
  lat: 0,
  lon: 0,
  time: "",
  magnitude: null,
  tsunami: false,
  summary: "",
  source: "TEST",
  link: "",
  nearLocations: [],
  aor: "INDOPACOM",
  hadrScore: 0,
  ...over,
});

describe("haversineKm", () => {
  it("computes a known great-circle distance (±1%)", () => {
    // JFK -> LHR ≈ 5 555 km
    const d = haversineKm(40.6413, -73.7781, 51.47, -0.4543);
    expect(d).toBeGreaterThan(5500);
    expect(d).toBeLessThan(5610);
  });
  it("is zero for identical points", () => {
    expect(haversineKm(35.68, 139.69, 35.68, 139.69)).toBe(0);
  });
});

describe("dedupe", () => {
  it("collapses same-type events within 25 km, first (highest-severity) wins", () => {
    const a = ev({ id: "keep", severity: "red", lat: 35.0, lon: 139.0 });
    const b = ev({ id: "drop", severity: "orange", lat: 35.1, lon: 139.1 }); // ~14 km away
    const out = dedupe([a, b]);
    expect(out.map((e) => e.id)).toEqual(["keep"]);
  });

  it("keeps same-type events farther than 25 km apart", () => {
    const a = ev({ lat: 35.0, lon: 139.0 });
    const b = ev({ lat: 35.5, lon: 139.0 }); // ~56 km
    expect(dedupe([a, b])).toHaveLength(2);
  });

  it("keeps co-located events of different types (quake + tsunami)", () => {
    const a = ev({ type: "earthquake", lat: 35, lon: 139 });
    const b = ev({ type: "tsunami", lat: 35, lon: 139 });
    expect(dedupe([a, b])).toHaveLength(2);
  });

  it("never collapses events with missing coordinates", () => {
    const a = ev({ lat: null, lon: null });
    const b = ev({ lat: null, lon: null });
    expect(dedupe([a, b])).toHaveLength(2);
  });
});

describe("computeHadrScore", () => {
  it("scores a red INDOPACOM earthquake above a green NORTHCOM drought", () => {
    const hot = computeHadrScore({ type: "earthquake", severity: "red", aor: "INDOPACOM" });
    const cold = computeHadrScore({ type: "drought", severity: "green", aor: "NORTHCOM" });
    expect(hot).toBeGreaterThan(cold);
  });
  it("stays within 0-100", () => {
    const s = computeHadrScore({ type: "earthquake", severity: "red", aor: "INDOPACOM", alertScore: 99 });
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});
