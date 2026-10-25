import { describe, it, expect } from "vitest";
import { deriveMissionImpact, fallbackCommanderRead, type ManualLimfac } from "../lib/limfac";
import type { SitrepPayload } from "../lib/sitrep";

const NOW = Date.UTC(2026, 6, 14, 14, 32);
const iso = (ms: number) => new Date(ms).toISOString();
const H = 3600_000;

function payload(over: Partial<SitrepPayload> = {}): SitrepPayload {
  const base: SitrepPayload = {
    base: { icao: "KWRI", label: "JB MDL", lat: 40, lon: -74.6, country: "United States", place: "NJ", artcc: "ZNY" },
    generatedAt: iso(NOW),
    status: { wx: "g", ops: "g", threat: "g", infra: "g", spectrum: "g" },
    spectrum: {
      pnt: { live: true, date: "2026-07-14", cellLevel: 0, raim: [] },
      spaceWx: { live: true, now: { date: "2026-07-14", R: 0, S: 0, G: 0 }, outlook: [], impacts: [], polar: false, satcom: "" },
      edge: { declared: false, live: true, vendors: [], hits: [] },
    },
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

  it("spectrum: a HIGH GPS-interference cell at the field caps C2/Comms at PMC with a CCIR; a moderate one only watches", () => {
    const hi = payload({ status: { wx: "g", ops: "g", threat: "g", infra: "g", spectrum: "r" }, spectrum: { pnt: { live: true, date: "d", cellLevel: 2, raim: [] }, spaceWx: { live: true, now: null, outlook: [], impacts: [], polar: false, satcom: "" }, edge: { declared: false, live: false, vendors: [], hits: [] } } });
    const m = deriveMissionImpact(hi);
    const c2 = m.functions.find((f) => f.key === "c2_comms")!;
    expect(c2.capability).toBe("pmc");
    expect(m.ccir.some((c) => c.key === "spectrum")).toBe(true);
    expect(m.limfacs.some((l) => /GPS-interference/.test(l.driver))).toBe(true);
    const mod = payload({ status: { wx: "g", ops: "g", threat: "g", infra: "g", spectrum: "a" }, spectrum: { pnt: { live: true, date: "d", cellLevel: 1, raim: [] }, spaceWx: { live: true, now: null, outlook: [], impacts: [], polar: false, satcom: "" }, edge: { declared: false, live: false, vendors: [], hits: [] } } });
    expect(deriveMissionImpact(mod).functions.find((f) => f.key === "c2_comms")!.capability).toBe("fmc");
  });

  it("spectrum: every sensor dead and connectivity dead → C2/Comms UNKNOWN, never FMC", () => {
    const dead = payload({
      status: { wx: "g", ops: "g", threat: "g", infra: "u", spectrum: "u" },
      infra: { internet: { live: false, entity: null, led: "u", series: [] }, water: null, nas: null, powerNews: [], waterNews: [], commsNews: [] },
      spectrum: { pnt: { live: false, date: "", cellLevel: 0, raim: [] }, spaceWx: { live: false, now: null, outlook: [], impacts: [], polar: false, satcom: "" }, edge: { declared: false, live: false, vendors: [], hits: [] } },
    });
    expect(deriveMissionImpact(dead).functions.find((f) => f.key === "c2_comms")!.capability).toBe("unknown");
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

  it("taxiway closure → Throughput PMC; a runway closure IN EFFECT at a multi-runway field → single-runway CCIR", () => {
    const p = payload();
    p.ops.runwayCount = 2;
    p.ops.groups = [group("runway", "Runway / surface", [
      notam("taxiway", "TWY A CLSD BTN TWY B AND APRON 1", true, NOW - H, NOW + 2 * H),
      notam("runway", "RWY 06/24 CLSD", true, NOW - 1 * H, NOW + 8 * H),
    ])];
    const m = deriveMissionImpact(p);
    expect(m.functions.find((f) => f.key === "throughput")!.capability).toBe("pmc");
    expect(m.functions.find((f) => f.key === "launch_recovery")!.capability).toBe("pmc");
    expect(m.ccir.some((c) => c.key === "single_runway")).toBe(true);
  });

  it("a runway closure LATER in the horizon is FMC now, named on the driver — never today's capability", () => {
    const p = payload();
    p.ops.runwayCount = 2;
    p.ops.groups = [group("runway", "Runway / surface", [notam("runway", "RWY 06/24 CLSD", true, NOW + 1 * H, NOW + 8 * H)])];
    const m = deriveMissionImpact(p);
    const lr = m.functions.find((f) => f.key === "launch_recovery")!;
    expect(lr.capability).toBe("fmc");
    expect(lr.driver).toContain("closure scheduled");
    expect(m.ccir).toHaveLength(0);
    expect(m.state).toBe("fmc");
  });

  it("the SOLE runway closed for its window → Launch/Recovery NMC + CCIR; outside the window FMC with the schedule named", () => {
    // OJAQ's A0467/26: one runway, closed SUN TUE WED 1400-1800 / MON 1400-1700.
    const REAL = "A0467/26 RWY CLSD DUE TO CONST WORK EXC EMERG AND SPECIAL FLT. SUN TUE WED 1400 - 1800, MON 1400 - 1700, 20 SEP 14:00 2026 UNTIL 18 NOV 18:00 2026.";
    const SUN_1500 = Date.UTC(2026, 9, 25, 15, 0);
    const SUN_0900 = Date.UTC(2026, 9, 25, 9, 0);
    const mk = (nowMs: number) => {
      const p = payload({ generatedAt: iso(nowMs) });
      p.ops.runwayCount = 1;
      p.ops.groups = [group("runway", "Runway / surface", [{
        category: "runway", rank: 0, text: REAL, amber: true, runwaysClosed: ["ALL"],
        start: iso(Date.UTC(2026, 8, 20, 14, 0)), end: iso(Date.UTC(2026, 10, 18, 18, 0)),
      } as ReturnType<typeof notam>])];
      return deriveMissionImpact(p);
    };
    const inWindow = mk(SUN_1500);
    expect(inWindow.functions.find((f) => f.key === "launch_recovery")!.capability).toBe("nmc");
    expect(inWindow.ccir.some((c) => c.key === "runway_closed")).toBe(true);
    expect(inWindow.state).toBe("nmc");
    const morning = mk(SUN_0900);
    const lr = morning.functions.find((f) => f.key === "launch_recovery")!;
    expect(lr.capability).toBe("fmc");
    expect(lr.driver).toContain("RWY closure scheduled");
    expect(morning.ccir).toHaveLength(0);
  });

  it("the airfield closed NOW is NMC; a field closure scheduled later is FMC with the window named", () => {
    const p = payload();
    p.ops.closure = { now: false, next: "Mon 21:00Z–04:00Z", indeterminate: false };
    const m = deriveMissionImpact(p);
    const lr = m.functions.find((f) => f.key === "launch_recovery")!;
    expect(lr.capability).toBe("fmc");
    expect(lr.driver).toContain("airfield closure scheduled Mon 21:00Z–04:00Z");
    const q = payload();
    q.ops.closure = { now: false, next: null, indeterminate: true };
    expect(deriveMissionImpact(q).functions.find((f) => f.key === "launch_recovery")!.capability).toBe("pmc");
  });

  it("a closed taxiway is PMC (throughput) and never NMC — even when it names a runway and an ILS and the TAF is IFR", () => {
    const p = payload();
    p.weather.tafWorst = { worst: "IFR", fromISO: iso(NOW + 3 * H) } as SitrepPayload["weather"]["tafWorst"];
    // The categoriser used to file this under approach (the ILS token) and the
    // label used to read "ILS RWY 24"; under forecast IFR the airfield derived
    // NMC "no usable precision approach" from a shut taxiway.
    p.ops.groups = [group("navaid", "NAVAID / approach", [
      notam("approach", "TWY A CLSD BTN TWY B AND ILS HOLD LINE RWY 24", false, NOW - H, NOW + 10 * H),
    ])];
    const m = deriveMissionImpact(p);
    expect(m.functions.find((f) => f.key === "throughput")!.capability).toBe("pmc");
    expect(m.functions.find((f) => f.key === "launch_recovery")!.capability).toBe("fmc");
    expect(m.functions.find((f) => f.key === "all_weather_night")!.capability).toBe("fmc");
    expect(m.ccir).toHaveLength(0);
    expect(m.state).toBe("pmc");
    const lf = m.limfacs.find((l) => l.fn === "throughput")!;
    expect(lf.driver).toBe("TWY A closed");
  });

  it("a taxiway closure placed by a runway does not read as a runway closure", () => {
    const p = payload();
    p.ops.groups = [group("runway", "Runway / surface", [
      notam("runway", "TWY A CLSD BTN TWY B AND RWY 06/24", false, NOW - H, NOW + 4 * H),
    ])];
    const m = deriveMissionImpact(p);
    expect(m.functions.find((f) => f.key === "launch_recovery")!.capability).toBe("fmc");
    expect(m.ccir.some((c) => c.key === "single_runway")).toBe(false);
    expect(m.functions.find((f) => f.key === "throughput")!.capability).toBe("pmc");
  });

  it("an advisory NAVAID NOTAM (unmonitored / RAIM prediction) is not an outage — no NMC under IFR", () => {
    const p = payload();
    p.weather.tafWorst = { worst: "IFR", fromISO: iso(NOW + 3 * H) } as SitrepPayload["weather"]["tafWorst"];
    p.ops.groups = [group("navaid", "NAVAID / approach", [
      notam("approach", "ILS RWY 24 GS UNMONITORED", false),
      notam("gps_raim", "GPS RAIM OUTAGE PREDICTED 1200-1400", false),
    ])];
    const m = deriveMissionImpact(p);
    expect(m.functions.find((f) => f.key === "all_weather_night")!.capability).toBe("fmc");
    expect(m.state).toBe("fmc");
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

  it("flags a manual LIMFAC whose end window has passed as stale", () => {
    const past = deriveMissionImpact(payload(), [manual({ toISO: iso(NOW - 2 * H) })]);
    expect(past.limfacs[0].stale).toBe(true);
    const future = deriveMissionImpact(payload(), [manual({ toISO: iso(NOW + 2 * H) })]);
    expect(future.limfacs[0].stale).toBe(false);
    const openEnded = deriveMissionImpact(payload(), [manual({ toISO: null })]);
    expect(openEnded.limfacs[0].stale).toBe(false);
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

describe("fallbackCommanderRead — deterministic non-AI read", () => {
  const manual = (over: Partial<ManualLimfac> = {}): ManualLimfac => ({
    id: "m-1", icao: "KWRI", fn: "arff", capability: "pmc",
    driver: "ARFF Cat 7 → Cat 5", impact: "Recovery limited to C-130 class",
    status: "new", createdAt: iso(NOW), toISO: iso(NOW + 3 * H), ...over,
  });

  it("FMC airfield → a plain green BLUF, no asks/watch", () => {
    const r = fallbackCommanderRead(deriveMissionImpact(payload()), "KWRI");
    expect(r.bluf).toHaveLength(3);
    expect(r.bluf[0]).toContain("KWRI");
    expect(r.bluf[0]).toContain("Fully Mission Capable");
    expect(r.bluf[0]).toContain("no limiting factors");
    expect(r.asks).toHaveLength(0);
    expect(r.watch).toHaveLength(0);
  });

  it("surfaces a limiting LIMFAC's driver/impact, ask, and CCIR watch", () => {
    const mi = deriveMissionImpact(payload(), [manual({ ask: "Approve ARFF contract truck by 1800Z", ccir: true })]);
    const r = fallbackCommanderRead(mi, "KWRI");
    expect(r.bluf[0]).toContain("Partially Mission Capable");
    expect(r.bluf[1]).toContain("ARFF Cat 7");
    expect(r.asks).toContain("Approve ARFF contract truck by 1800Z");
    expect(r.watch.length).toBeGreaterThan(0);
  });
});
