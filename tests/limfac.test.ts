import { describe, it, expect } from "vitest";
import { deriveMissionImpact, type ManualLimfac } from "../lib/limfac";
import type { SitrepPayload } from "../lib/sitrep";

const NOW = Date.UTC(2026, 6, 14, 14, 32);
const iso = (ms: number) => new Date(ms).toISOString();
const H = 3600_000;

function payload(over: Partial<SitrepPayload> = {}): SitrepPayload {
  const base: SitrepPayload = {
    base: { icao: "KWRI", label: "JB MDL", lat: 40, lon: -74.6, country: "United States", place: "NJ", artcc: "ZNY" },
    generatedAt: iso(NOW),
    status: { wx: "g", ops: "g", threat: "g", infra: "g" },
    weather: {
      live: true, now: { icao: "KWRI", flightCategory: "VFR", windKt: 10, gustKt: null, visMi: 10, ceilingFt: null } as SitrepPayload["weather"]["now"],
      metarRaw: "KWRI ...", tafWorst: null, tafSegments: [], alerts: [], current: null, outlook: [], windDirDeg: 240, windVariable: false,
    },
    astro: { sunriseZ: null, sunsetZ: null, civilDawnZ: null, civilDuskZ: null, moon: { illumPct: 0, phaseName: "new", waxing: true } },
    ops: {
      configured: true, live: true, notamCount: 0, groups: [], limiting: false, fieldClosed: false,
      capability: null, center: null, runwayWinds: [], fuel: { live: true, items: [] },
    },
    history: [],
    infra: {
      internet: { live: true, entity: "New Jersey", led: "g", series: [] },
      water: { live: true, gauges: [] },
      nas: { live: true, updated: null, counts: { groundStops: 0, groundDelays: 0, closures: 0, delays: 0 }, nearby: [] },
      powerNews: [], waterNews: [], commsNews: [],
    },
    threats: { fp: { composite: "green", topDriver: "clear", axes: [] }, disasters: [], news: [], newsScanned: 0 },
    ...over,
  } as SitrepPayload;
  return base;
}

const notam = (category: string, text: string, amber: boolean, start?: number, end?: number) => ({
  category, rank: 1, text, amber,
  ...(start !== undefined ? { start: iso(start) } : {}),
  ...(end !== undefined ? { end: iso(end) } : {}),
});
const group = (key: string, label: string, items: ReturnType<typeof notam>[]) => ({ key, label, items } as SitrepPayload["ops"]["groups"][number]);

describe("deriveMissionImpact — capability", () => {
  it("all clear → FMC across functions, no LIMFACs, no CCIR", () => {
    const m = deriveMissionImpact(payload());
    expect(m.state).toBe("fmc");
    expect(m.limfacs).toHaveLength(0);
    expect(m.ccir).toHaveLength(0);
  });

  it("field closed → Launch/Recovery NMC + CCIR + overall NMC", () => {
    const p = payload();
    p.ops.fieldClosed = true;
    p.ops.groups = [group("runway", "Runway / surface", [notam("services", "AD CLSD EXC EMERG", true, NOW, NOW + 3 * H)])];
    const m = deriveMissionImpact(p);
    expect(m.state).toBe("nmc");
    expect(m.functions.find((f) => f.key === "launch_recovery")!.capability).toBe("nmc");
    expect(m.ccir.some((c) => c.key === "field_closed")).toBe(true);
  });

  it("NAVAID out × forecast IFR → All-Weather NMC (derived) + no-approach CCIR", () => {
    const p = payload();
    p.weather.tafWorst = { worst: "IFR", fromISO: iso(NOW + 3 * H) } as SitrepPayload["weather"]["tafWorst"];
    p.ops.groups = [group("navaid", "NAVAID / approach", [notam("navaid", "ILS RWY 24 U/S", false, NOW + 2 * H, NOW + 11 * H)])];
    const m = deriveMissionImpact(p);
    const awn = m.functions.find((f) => f.key === "all_weather_night")!;
    expect(awn.capability).toBe("nmc");
    expect(awn.derived).toBe(true);
    expect(m.ccir.some((c) => c.key === "no_approach")).toBe(true);
    expect(m.state).toBe("nmc");
  });

  it("NAVAID out but VFR forecast → All-Weather only PMC, no CCIR", () => {
    const p = payload();
    p.ops.groups = [group("navaid", "NAVAID / approach", [notam("navaid", "ILS RWY 24 U/S", false, NOW, NOW + 6 * H)])];
    const m = deriveMissionImpact(p);
    expect(m.functions.find((f) => f.key === "all_weather_night")!.capability).toBe("pmc");
    expect(m.ccir.some((c) => c.key === "no_approach")).toBe(false);
    expect(m.state).toBe("pmc");
  });

  it("taxiway closure → Throughput PMC; runway closure → single-runway CCIR", () => {
    const p = payload();
    p.ops.groups = [group("runway", "Runway / surface", [
      notam("taxiway", "TWY A CLSD BTN TWY B AND APRON 1", true, NOW - H, NOW + 2 * H),
      notam("runway", "RWY 06/24 CLSD", true, NOW + 1 * H, NOW + 8 * H),
    ])];
    const m = deriveMissionImpact(p);
    expect(m.functions.find((f) => f.key === "throughput")!.capability).toBe("pmc");
    expect(m.functions.find((f) => f.key === "launch_recovery")!.capability).toBe("pmc");
    expect(m.ccir.some((c) => c.key === "single_runway")).toBe(true);
  });
});

describe("deriveMissionImpact — UNKNOWN discipline", () => {
  it("DAIP down → runway/approach/throughput UNKNOWN, never FMC", () => {
    const p = payload();
    p.ops.configured = false;
    p.ops.live = false;
    const m = deriveMissionImpact(p);
    for (const k of ["launch_recovery", "all_weather_night", "throughput"]) {
      expect(m.functions.find((f) => f.key === k)!.capability).toBe("unknown");
    }
  });

  it("fuel feed unreachable → Fuel UNKNOWN; FP unavailable → UNKNOWN", () => {
    const p = payload();
    p.ops.fuel = { live: false, items: [] };
    p.threats.fp = null;
    const m = deriveMissionImpact(p);
    expect(m.functions.find((f) => f.key === "fuel_servicing")!.capability).toBe("unknown");
    expect(m.functions.find((f) => f.key === "force_protection")!.capability).toBe("unknown");
  });
});

describe("deriveMissionImpact — manual LIMFACs", () => {
  const manual = (over: Partial<ManualLimfac> = {}): ManualLimfac => ({
    id: "m-1", icao: "KWRI", fn: "arff", capability: "pmc",
    driver: "ARFF Cat 7 → Cat 5", impact: "Recovery limited to C-130 class",
    status: "new", createdAt: iso(NOW), toISO: iso(NOW + 3 * H), ...over,
  });

  it("merges a manual ARFF LIMFAC and worsens that function", () => {
    const m = deriveMissionImpact(payload(), [manual()]);
    const arff = m.functions.find((f) => f.key === "arff")!;
    expect(arff.capability).toBe("pmc");
    expect(m.limfacs.some((l) => l.source === "manual" && l.id === "m-1")).toBe(true);
    expect(m.state).toBe("pmc");
  });

  it("CCIR-flagged manual entry surfaces as a CCIR line", () => {
    const m = deriveMissionImpact(payload(), [manual({ ccir: true })]);
    expect(m.ccir.some((c) => c.key === "manual_m-1")).toBe(true);
  });

  it("resolved manual entries are ignored", () => {
    const m = deriveMissionImpact(payload(), [manual({ status: "resolved" })]);
    expect(m.limfacs).toHaveLength(0);
    expect(m.state).toBe("fmc");
  });

  it("ranks NMC before PMC in the register", () => {
    const p = payload();
    p.ops.fieldClosed = true;
    p.ops.groups = [group("runway", "Runway / surface", [notam("services", "AD CLSD", true, NOW, NOW + 2 * H)])];
    const m = deriveMissionImpact(p, [manual()]);
    expect(m.limfacs[0].capability).toBe("nmc");
  });
});
