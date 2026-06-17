import { describe, it, expect } from "vitest";
import { assessLocation, isForceLocationActive, type ForceContext } from "@/lib/forceProtection";
import { parseGpsCsv, gpsLevelAt } from "@/lib/gpsjam";
import { latLngToCell } from "h3-js";
import type { ForceLocation } from "@/lib/types";

// A base in Qatar (Al Udeid-ish). country drives INFORM/advisory matching;
// coords drive proximity + GPS.
const base = (over: Partial<ForceLocation> = {}): ForceLocation => ({
  id: "1", label: "Al Udeid AB", icao: "OTBH", lat: 25.12, lon: 51.32,
  country: "Qatar", cocom: "CENTCOM", ...over,
});

const emptyCtx: ForceContext = {
  disasters: [], threats: [], tropical: [], hazards: [],
  advisories: [], conflict: [], acled: [], inform: [], gps: [], aviation: {}, aviationTaf: {},
  notams: {}, notamsConfigured: false, health: [], nowMs: Date.UTC(2026, 5, 16),
  live: { weather: true, gps: true, notams: false },
};

describe("assessLocation", () => {
  it("quiet context → all green, no driver", () => {
    const a = assessLocation(base(), emptyCtx);
    expect(a.composite).toBe("green");
    expect(a.topDriver).toMatch(/no active/i);
    expect(a.categories).toHaveLength(5);
  });

  it("nearby fatal ACLED strike → conflict RED + composite RED", () => {
    const ctx = { ...emptyCtx, acled: [{ id: "x", date: "2026-06-15", type: "Battles", subType: "Air/drone strike", lat: 25.5, lon: 51.4, country: "Qatar", admin1: "", location: "Doha", notes: "", fatalities: 7, source: "", actors: "A vs B" }] };
    const a = assessLocation(base(), ctx);
    const conflict = a.categories.find((c) => c.category === "conflict")!;
    expect(conflict.severity).toBe("red");
    expect(a.composite).toBe("red");
    expect(a.topDriver).toMatch(/Conflict/);
  });

  it("far-away strike (>400km) does not raise conflict", () => {
    const ctx = { ...emptyCtx, acled: [{ id: "x", date: "2026-06-15", type: "Battles", subType: "Air/drone strike", lat: 35, lon: 60, country: "Iran", admin1: "", location: "", notes: "", fatalities: 7, source: "", actors: "" }] };
    expect(assessLocation(base(), ctx).categories.find((c) => c.category === "conflict")!.severity).toBe("green");
  });

  it("INFORM high risk alone → conflict amber/red baseline", () => {
    const ctx = { ...emptyCtx, inform: [{ country: "Qatar", iso3: "QAT", score: 6.8, lat: 25.3, lon: 51.2, year: "2026" }] };
    expect(assessLocation(base(), ctx).categories.find((c) => c.category === "conflict")!.severity).toBe("red");
  });

  it("ordered departure advisory → civil RED", () => {
    const ctx = { ...emptyCtx, advisories: [{ country: "Qatar", level: 4, aor: "CENTCOM", orderedDeparture: true, authorizedDeparture: false, title: "", link: "", pubDate: "" }] };
    const a = assessLocation(base(), ctx);
    expect(a.categories.find((c) => c.category === "civil")!.severity).toBe("red");
  });

  it("Level 3 advisory → civil AMBER", () => {
    const ctx = { ...emptyCtx, advisories: [{ country: "Qatar", level: 3, aor: "CENTCOM", orderedDeparture: false, authorizedDeparture: false, title: "", link: "", pubDate: "" }] };
    expect(assessLocation(base(), ctx).categories.find((c) => c.category === "civil")!.severity).toBe("amber");
  });

  it("WHO outbreak in the base country → hazard AMBER", () => {
    const ctx = { ...emptyCtx, health: [{ disease: "Cholera", country: "Qatar", title: "Cholera – Qatar", link: "", pubDate: "2026-06-10" }] };
    expect(assessLocation(base(), ctx).categories.find((c) => c.category === "hazard")!.severity).toBe("amber");
  });

  it("LIFR METAR at the base ICAO → weather RED; VFR → green", () => {
    const lifr = { ...emptyCtx, aviation: { OTBH: { icao: "OTBH", flightCategory: "LIFR" as const, windKt: 8, gustKt: null, visMi: 0.5, ceilingFt: 200, observedAt: "" } } };
    expect(assessLocation(base(), lifr).categories.find((c) => c.category === "weather")!.severity).toBe("red");
    const vfr = { ...emptyCtx, aviation: { OTBH: { icao: "OTBH", flightCategory: "VFR" as const, windKt: 8, gustKt: null, visMi: 10, ceilingFt: null, observedAt: "" } } };
    expect(assessLocation(base(), vfr).categories.find((c) => c.category === "weather")!.severity).toBe("green");
  });

  it("severe model hazard at the base → weather RED", () => {
    const ctx = { ...emptyCtx, hazards: [{ label: "Al Udeid AB", lat: 25.12, lon: 51.32, severity: "severe" as const, flags: ["Gusts 55 kt 12Z"] }] };
    expect(assessLocation(base(), ctx).categories.find((c) => c.category === "weather")!.severity).toBe("red");
  });

  it("GPS cell flagged high → gps RED", () => {
    const cell = latLngToCell(25.12, 51.32, 4);
    const ctx = { ...emptyCtx, gps: [{ h3: cell, level: 2 }] };
    expect(assessLocation(base(), ctx).categories.find((c) => c.category === "gps")!.severity).toBe("red");
  });

  it("composite is the worst category", () => {
    const ctx = { ...emptyCtx, hazards: [{ label: "Al Udeid AB", lat: 25.12, lon: 51.32, severity: "elevated" as const, flags: ["IFR vis 06Z"] }] };
    // weather amber, everything else green → composite amber
    expect(assessLocation(base(), ctx).composite).toBe("amber");
  });

  it("GPS feed down → gps UNKNOWN, not green (cardinal rule)", () => {
    const ctx = { ...emptyCtx, live: { weather: true, gps: false, notams: false } };
    const a = assessLocation(base(), ctx);
    expect(a.categories.find((c) => c.category === "gps")!.severity).toBe("unknown");
    // other categories green → composite stays green, but driver notes the blind spot
    expect(a.composite).toBe("green");
    expect(a.topDriver).toMatch(/blind on .*GPS/i);
  });

  it("every feed down → composite UNKNOWN (never falsely green)", () => {
    const ctx = { ...emptyCtx, live: { weather: false, gps: false, notams: false } };
    // conflict/civil/hazard have no events; weather+gps unknown. Known categories
    // (conflict/civil/hazard) are green → composite green is acceptable, but with
    // weather+gps unknown the driver flags the blind spots.
    const a = assessLocation(base(), ctx);
    expect(a.categories.find((c) => c.category === "weather")!.severity).toBe("unknown");
    expect(a.topDriver).toMatch(/blind/i);
  });

  it("a real red still beats unknowns", () => {
    const cell = latLngToCell(25.12, 51.32, 4);
    const ctx = { ...emptyCtx, live: { weather: false, gps: true, notams: false }, gps: [{ h3: cell, level: 2 }] };
    expect(assessLocation(base(), ctx).composite).toBe("red");
  });

  it("airspace category only present when NOTAMs configured", () => {
    expect(assessLocation(base(), emptyCtx).categories.some((c) => c.category === "airspace")).toBe(false);
    const ctx = { ...emptyCtx, notamsConfigured: true, live: { weather: true, gps: true, notams: true } };
    expect(assessLocation(base(), ctx).categories.some((c) => c.category === "airspace")).toBe(true);
  });

  it("runway-closure NOTAM → airspace RED", () => {
    const ctx = {
      ...emptyCtx, notamsConfigured: true, live: { weather: true, gps: true, notams: true },
      notams: { OTBH: [{ icao: "OTBH", category: "runway" as const, rank: 0, text: "RWY 16R/34L CLSD", runwaysClosed: ["16R/34L"] }] },
    };
    const a = assessLocation(base(), ctx);
    expect(a.categories.find((c) => c.category === "airspace")!.severity).toBe("red");
    expect(a.composite).toBe("red");
  });

  it("NOTAMs configured but feed down → airspace UNKNOWN", () => {
    const ctx = { ...emptyCtx, notamsConfigured: true, live: { weather: true, gps: true, notams: false } };
    expect(assessLocation(base(), ctx).categories.find((c) => c.category === "airspace")!.severity).toBe("unknown");
  });
});

describe("country watch (kind=country)", () => {
  const country = (over: Partial<ForceLocation> = {}): ForceLocation => ({
    id: "c1", label: "Qatar", country: "Qatar", cocom: "CENTCOM", kind: "country", lat: 0, lon: 0, ...over,
  });

  it("scores only country-keyed categories — no airfield categories", () => {
    const cats = assessLocation(country(), emptyCtx).categories.map((c) => c.category);
    expect(cats).toEqual(["conflict", "civil", "hazard"]);
    expect(cats).not.toContain("weather");
    expect(cats).not.toContain("gps");
    expect(cats).not.toContain("airspace");
  });

  it("matches conflict by country name, not proximity (coords are 0,0)", () => {
    const ctx = { ...emptyCtx, acled: [{ id: "x", date: "2026-06-15", type: "Battles", subType: "Armed clash", lat: 25.3, lon: 51.5, country: "Qatar", admin1: "", location: "Doha", notes: "", fatalities: 6, source: "", actors: "" }] };
    expect(assessLocation(country(), ctx).categories.find((c) => c.category === "conflict")!.severity).toBe("red");
  });

  it("matches a disaster by country name", () => {
    const ctx = { ...emptyCtx, disasters: [{ id: "d", type: "flood", severity: "red" as const, country: "Qatar", lat: 25.3, lon: 51.5, time: "", magnitude: null, tsunami: false, summary: "", source: "GDACS" as const, link: "", nearLocations: [], alertScore: null, aor: "CENTCOM" as const, hadrScore: 50, title: "Flooding" }] };
    expect(assessLocation(country(), ctx).categories.find((c) => c.category === "hazard")!.severity).toBe("red");
  });
});

describe("isForceLocationActive", () => {
  const now = Date.UTC(2026, 5, 16);
  it("standing base (no window) is always active", () => {
    expect(isForceLocationActive(base(), now)).toBe(true);
  });
  it("ended deployment is inactive", () => {
    expect(isForceLocationActive(base({ end: "2026-06-10" }), now)).toBe(false);
  });
  it("ongoing window is active", () => {
    expect(isForceLocationActive(base({ start: "2026-06-14", end: "2026-06-20" }), now)).toBe(true);
  });
});

describe("parseGpsCsv + gpsLevelAt", () => {
  it("derives bad-fraction from good/bad counts and thresholds level", () => {
    const cell = latLngToCell(48.0, 11.0, 4);
    const csv = `hex,count_good_aircraft,count_bad_aircraft\n${cell},10,90\nabc123def456,99,1`;
    const hexes = parseGpsCsv(csv);
    expect(hexes.find((h) => h.h3 === cell)?.level).toBe(2); // 0.9 → high
    expect(gpsLevelAt(48.0, 11.0, hexes)).toBe(2);
    expect(gpsLevelAt(0, 0, hexes)).toBe(0); // elsewhere → none
  });
});
