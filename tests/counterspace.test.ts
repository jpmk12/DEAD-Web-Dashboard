import { describe, it, expect } from "vitest";
import {
  semiMajorAxisKm, altitudeKm, regimeOf, raanRateDegPerDay, parseGpRows, detectManoeuvres, coPlanar, worthSweeping,
  rangeSweep, twoBodyPropagator, readCounterspace, fleetActorIn, hasCorroborator, sanitizeAssets, assetFor,
  counterspaceState, DEFAULT_ASSETS_OF_INTEREST, INSPECTOR_FLEET, type ElementSet,
} from "../lib/counterspace";
import { cyberTargetOf, cyberPostureRead } from "../lib/cyberSignals";
import { cyberState } from "../lib/spectrumRules";
import { sanitizeSpectrum, DEFAULT_SPECTRUM } from "../lib/missionProfile";
import { spectrumIndicators, COUNTERSPACE_ID } from "../lib/warningTaxonomy";
import { sensorKeyDef } from "../lib/sensorKeys";

// A sun-synchronous-ish LEO set, the ICEYE-X36 regime (~560 km, 97.6°).
const base = (over: Partial<ElementSet> = {}): ElementSet => ({
  noradId: 1, name: "TEST", epoch: "2026-10-01T00:00:00.000Z",
  inclination: 97.6, raan: 120, eccentricity: 0.0012, argPerigee: 90, meanAnomaly: 0, meanMotion: 15.15, ...over,
});

describe("orbital maths", () => {
  it("semi-major axis and regime from mean motion", () => {
    // n = 15.15 rev/day → a ≈ 6899 km (≈ 521 km up); the ISS at 15.5 sits ~100 km lower.
    expect(semiMajorAxisKm(15.15)).toBeCloseTo(6899, 0);
    expect(altitudeKm({ meanMotion: 15.15 })).toBeCloseTo(521, 0);
    expect(altitudeKm({ meanMotion: 15.5 })).toBeLessThan(altitudeKm({ meanMotion: 15.15 }));
    expect(regimeOf({ meanMotion: 15.15, eccentricity: 0.001 })).toBe("leo");
    expect(regimeOf({ meanMotion: 1.0027, eccentricity: 0.0002 })).toBe("geo");
    expect(regimeOf({ meanMotion: 2.0, eccentricity: 0.001 })).toBe("meo");
    expect(regimeOf({ meanMotion: 2.0, eccentricity: 0.7 })).toBe("heo");
  });
  it("J2 node regression is ~+1°/day for a sun-synchronous orbit and westward for a prograde one", () => {
    expect(raanRateDegPerDay(base())).toBeCloseTo(0.985, 1);
    expect(raanRateDegPerDay(base({ inclination: 51.6, meanMotion: 15.5 }))).toBeLessThan(-4);
  });
  it("parses Space-Track GP rows and drops rows missing orbital fields", () => {
    const rows = [
      { NORAD_CAT_ID: "53323", OBJECT_NAME: "COSMOS 2558", EPOCH: "2026-10-01T00:00:00", MEAN_MOTION: "15.15", INCLINATION: "97.6", RA_OF_ASC_NODE: "120", ECCENTRICITY: "0.0012", ARG_OF_PERICENTER: "90", MEAN_ANOMALY: "0", TLE_LINE1: "1 …", TLE_LINE2: "2 …" },
      { NORAD_CAT_ID: "99999", OBJECT_NAME: "BROKEN", EPOCH: "2026-10-01T00:00:00" },
    ];
    const sets = parseGpRows(rows);
    expect(sets.length).toBe(1);
    expect(sets[0]).toMatchObject({ noradId: 53323, name: "COSMOS 2558", inclination: 97.6, line1: "1 …" });
    expect(sets[0].epoch).toBe("2026-10-01T00:00:00.000Z");
    expect(parseGpRows({ data: rows }).length).toBe(1);
    expect(parseGpRows("nope")).toEqual([]);
  });
});

describe("manoeuvre detection — a plane change is not drag", () => {
  const day = (d: number) => new Date(Date.parse("2026-10-01T00:00:00Z") + d * 86_400_000).toISOString();
  it("station-keeping noise and slow decay with the node regressing as J2 predicts → nothing", () => {
    const sets: ElementSet[] = [];
    for (let d = 0; d < 10; d++) {
      sets.push(base({ epoch: day(d), meanMotion: 15.15 + d * 0.00005, raan: 120 + raanRateDegPerDay(base()) * d + (d % 2 ? 0.01 : -0.01), inclination: 97.6 + (d % 3 ? 0.005 : 0) }));
    }
    expect(detectManoeuvres(sets)).toEqual([]);
  });
  it("a 10 km raise is an altitude manoeuvre; a 0.3° inclination change is a plane change", () => {
    const a0 = base({ epoch: day(0) });
    const raised = base({ epoch: day(1), meanMotion: 15.15 - 0.033, raan: 120 + raanRateDegPerDay(a0) }); // ~+10 km
    const m1 = detectManoeuvres([a0, raised]);
    expect(m1.length).toBe(1);
    expect(m1[0].kind).toBe("altitude");
    expect(m1[0].dAKm).toBeGreaterThan(8);
    const tilted = base({ epoch: day(1), inclination: 97.9, raan: 120 + raanRateDegPerDay(a0) });
    const m2 = detectManoeuvres([a0, tilted]);
    expect(m2.length).toBe(1);
    expect(m2[0].kind).toBe("plane");
  });
  it("a node shift beyond J2 is a plane change; order of input does not matter", () => {
    const a0 = base({ epoch: day(0) });
    const shifted = base({ epoch: day(2), raan: 120 + raanRateDegPerDay(a0) * 2 + 1.5 });
    const m = detectManoeuvres([shifted, a0]);
    expect(m.length).toBe(1);
    expect(m[0].kind).toBe("plane");
    expect(m[0].dRaanResidualDeg).toBeCloseTo(1.5, 1);
  });
  it("GEO east–west keeping (a couple of km) is not a manoeuvre", () => {
    const g0 = base({ epoch: day(0), inclination: 0.05, meanMotion: 1.00271, eccentricity: 0.0002 });
    const g1 = base({ epoch: day(3), inclination: 0.06, meanMotion: 1.00271 + 0.00004, eccentricity: 0.0002, raan: 120 + raanRateDegPerDay(g0) * 3 });
    expect(detectManoeuvres([g0, g1])).toEqual([]);
  });
});

describe("co-planarity and range", () => {
  const target = base({ noradId: 2, name: "ICEYE-X36" });
  it("the May step: same plane and altitude band → co-planar; a different plane → not", () => {
    const chaser = base({ noradId: 3, name: "COSMOS 2612", raan: 121.2, inclination: 97.4, meanMotion: 15.17, meanAnomaly: 30 });
    const r = coPlanar(chaser, target);
    expect(r.match).toBe(true);
    expect(r.dRaanDeg).toBeCloseTo(1.2, 2);
    expect(coPlanar(base({ raan: 200 }), target).match).toBe(false);
    expect(coPlanar(base({ inclination: 53 }), target).match).toBe(false);
    expect(worthSweeping(chaser, target)).toBe(true);
    expect(worthSweeping(base({ meanMotion: 1.0027 }), target)).toBe(false);
  });
  it("the two-body sweep finds the closest point of a co-orbital chaser and never for a crossing plane", () => {
    const start = Date.parse(target.epoch);
    // Same orbit, 2° of mean anomaly behind → a few hundred km of along-track separation.
    const trailing = base({ noradId: 3, name: "COSMOS 2612", meanAnomaly: -2 });
    const r = rangeSweep(trailing, target, twoBodyPropagator, start, 2, 60);
    expect(r).not.toBeNull();
    expect(r!.minRangeKm).toBeGreaterThan(200);
    expect(r!.minRangeKm).toBeLessThan(260);
    expect(r!.hoursWithin50).toBe(0);
    // 0.04° behind → inside 5 km, every sample.
    const close = base({ noradId: 4, meanAnomaly: -0.04 });
    const c = rangeSweep(close, target, twoBodyPropagator, start, 2, 60)!;
    expect(c.minRangeKm).toBeLessThan(5);
    expect(c.hoursWithin5).toBeCloseTo(2, 0);
    // A propagator that mostly fails yields no read.
    expect(rangeSweep(close, target, () => null, start, 2, 60)).toBeNull();
  });
});

describe("the grammar — phrases, never names", () => {
  it("grades the Kosmos 2612 reporting as a proximity act, an ASAT test above it, a what-if as analysis", () => {
    const r = readCounterspace("Russian satellite plays 'cat-and-mouse' with a commercial US spacecraft likely used by Ukraine");
    expect(r?.cls).toBe("rpo");
    expect(r?.modality).toBe("act");
    expect(readCounterspace("Russia conducted an anti-satellite test, destroying a defunct satellite")?.cls).toBe("asat");
    expect(readCounterspace("How a Russian inspector satellite could threaten GPS")?.modality).toBe("analysis");
    expect(readCounterspace("Kosmos 2612 was launched in April with five other spacecraft")).toBeNull();
  });
  it("attributes a fleet mention to its actor and sees a corroborator", () => {
    expect(fleetActorIn("Kosmos 2612 came within 500 metres of ICEYE-X36, LeoLabs said")).toBe("RUS");
    expect(fleetActorIn("Shijian-21 towed a dead BeiDou satellite")).toBe("CHN");
    expect(fleetActorIn("A Starlink satellite re-entered")).toBeNull();
    expect(hasCorroborator("per LeoLabs tracking data")).toBe(true);
    expect(hasCorroborator("a Telegram channel claimed")).toBe(false);
  });
});

describe("the declared assets", () => {
  it("seeds when absent, keeps an explicit empty list, matches by prefix or id", () => {
    expect(sanitizeAssets(undefined).length).toBe(DEFAULT_ASSETS_OF_INTEREST.length);
    expect(sanitizeAssets([])).toEqual([]);
    const list = sanitizeAssets([{ name: "iceye-x", cls: "isr-commercial", label: "ICEYE" }, { name: "x" }, { name: "USA 326", noradId: 12345, cls: "nonsense" }]);
    expect(list.length).toBe(2);
    expect(list[1]).toMatchObject({ name: "USA 326", noradId: 12345, cls: "other" });
    expect(assetFor("ICEYE-X36", 60000, list)?.label).toBe("ICEYE");
    expect(assetFor("STARLINK-31234", 60001, list)).toBeNull();
    expect(assetFor("whatever", 12345, list)?.name).toBe("USA 326");
  });
  it("rides the Mission Profile spectrum block", () => {
    expect(DEFAULT_SPECTRUM.assetsOfInterest.length).toBeGreaterThan(5);
    expect(sanitizeSpectrum({ polarRoutes: false }).assetsOfInterest.length).toBe(DEFAULT_ASSETS_OF_INTEREST.length);
    expect(sanitizeSpectrum({ assetsOfInterest: [] }).assetsOfInterest).toEqual([]);
  });
  it("the fleet catalogue names the worked example and every entry has an actor", () => {
    expect(INSPECTOR_FLEET.some((f) => f.name === "COSMOS 2612")).toBe(true);
    expect(INSPECTOR_FLEET.every((f) => f.actor === "RUS" || f.actor === "CHN")).toBe(true);
  });
});

describe("counterspaceState — posture is the programme, warning is the change", () => {
  const quiet = { catalogueLive: true, manoeuvres14: 0, cadencePer14: 1, coPlanar: [], proximity: [], reported: [], official: 0 };
  const prox = (over: Partial<Parameters<typeof counterspaceState>[0]["proximity"][number]> = {}) => ({ inspector: "COSMOS 2612", asset: "ICEYE-X36", assetClass: "isr-commercial" as const, declared: true, minRangeKm: 0.5, hoursWithin50: 48, hoursWithin5: 40, atISO: "2026-10-17T03:00:00Z", ...over });
  it("nothing observed → null; fleet on station → dormant", () => {
    expect(counterspaceState({ ...quiet, catalogueLive: false })).toBeNull();
    expect(counterspaceState(quiet)?.state).toBe("dormant");
  });
  it("a manoeuvre or a plane match with a declared asset → watching", () => {
    expect(counterspaceState({ ...quiet, manoeuvres14: 1 })?.state).toBe("watching");
    const s = counterspaceState({ ...quiet, coPlanar: [{ inspector: "COSMOS 2612", asset: "ICEYE-X36", assetClass: "isr-commercial", declared: true, dRaanDeg: 1.2, dIncDeg: 0.1, dAltKm: 3 }] });
    expect(s?.state).toBe("watching");
    expect(s?.why).toContain("co-planar with ICEYE-X36");
  });
  it("an approach inside 50 km of a declared asset → active; sustained → shadowing; an official statement → confirmed", () => {
    const a = counterspaceState({ ...quiet, proximity: [prox({ minRangeKm: 30, hoursWithin50: 3 })] });
    expect(a?.state).toBe("active");
    const sh = counterspaceState({ ...quiet, proximity: [prox()] });
    expect(sh?.why).toContain("500 m");
    expect(sh?.why).toContain("shadowing");
    const c = counterspaceState({ ...quiet, proximity: [prox()], reported: [{ modality: "act", own: false, corroborated: true, cls: "rpo" }], official: 1 });
    expect(c?.state).toBe("confirmed");
  });
  it("an approach to an UNDECLARED asset caps at watching", () => {
    const s = counterspaceState({ ...quiet, proximity: [prox({ declared: false, asset: "STARLINK-31234", minRangeKm: 2 })] });
    expect(s?.state).toBe("watching");
    expect(s?.why).toContain("not a declared asset");
  });
  it("reporting alone: a wire act is active, own-source-only caps at watching, two corroborated wire acts confirm", () => {
    const r = { catalogueLive: false, manoeuvres14: 0, cadencePer14: null, coPlanar: [], proximity: [], official: 0 };
    expect(counterspaceState({ ...r, reported: [{ modality: "act", own: false, corroborated: false, cls: "rpo" }] })?.state).toBe("active");
    expect(counterspaceState({ ...r, reported: [{ modality: "act", own: true, corroborated: false, cls: "rpo" }] })?.state).toBe("watching");
    expect(counterspaceState({ ...r, reported: [{ modality: "act", own: false, corroborated: true, cls: "rpo" }, { modality: "act", own: false, corroborated: false, cls: "rpo" }] })?.state).toBe("confirmed");
  });
});

describe("cyber posture — against whom, and what it means", () => {
  const AOI = ["Poland", "Germany", "Lithuania"];
  const ALL = ["Poland", "Germany", "Lithuania", "Brazil", "Russia", "Ukraine"];
  it("reads the target class", () => {
    expect(cyberTargetOf("Russian hackers breached Polish rail systems", AOI, ALL, { actorCountries: ["Russia"] })).toBe("aoi");
    expect(cyberTargetOf("GRU-linked group hit U.S. logistics providers", AOI, ALL)).toBe("aoi");
    expect(cyberTargetOf("Ransomware gang hits Brazilian bank", AOI, ALL)).toBe("elsewhere");
    expect(cyberTargetOf("Sandworm deploys new wiper", AOI, ALL, { actorCountries: ["Russia"] })).toBe("unknown");
    expect(cyberTargetOf("Actors exploited Fortinet appliances", AOI, ALL, { vendors: ["Fortinet"] })).toBe("aoi");
  });
  it("preparation outranks demonstration; elsewhere is named, never ranked", () => {
    const prep = cyberPostureRead([
      { cls: "espionage", modality: "act", target: "aoi", phrase: "pre-positioning", ageDays: 3 },
      { cls: "ddos", modality: "act", target: "aoi", phrase: "ddos attack", ageDays: 1 },
      { cls: "ddos", modality: "act", target: "aoi", phrase: "ddos attack", ageDays: 2 },
      { cls: "ransom", modality: "act", target: "elsewhere", phrase: "ransomware attack", ageDays: 2 },
    ], true);
    expect(prep.posture).toBe("preparation");
    expect(prep.why).toContain("1 act elsewhere not counted");
    const demo = cyberPostureRead([
      { cls: "ddos", modality: "act", target: "aoi", phrase: "ddos attack", ageDays: 1 },
      { cls: "ddos", modality: "act", target: "unknown", phrase: "defaced websites", ageDays: 5 },
    ], true);
    expect(demo.posture).toBe("demonstration");
    const sus = cyberPostureRead([
      { cls: "espionage", modality: "act", target: "aoi", phrase: "cyber espionage", ageDays: 10 },
      { cls: "espionage", modality: "act", target: "unknown", phrase: "intrusion into", ageDays: 20 },
    ], true);
    expect(sus.posture).toBe("sustained pressure");
  });
  it("a threat is not posture; a dead feed is UNKNOWN, an empty live window is quiet-not-calm", () => {
    expect(cyberPostureRead([{ cls: "disruptive", modality: "threat", target: "aoi", phrase: "wiper attack", ageDays: 1 }], true).posture).toBe("quiet");
    expect(cyberPostureRead([], false).posture).toBe("unknown");
    expect(cyberPostureRead([], true).why).toContain("not evidence of calm");
  });
  it("the cyber ladder names acts outside the AOI without ranking them", () => {
    const s = cyberState({ outagesLive: true, outages: [], victimsLive: false, victims: 0, victimsBaseline: { mean: null, samples: 0 }, actsBy: [], advisories: 0, elsewhere: 2 });
    expect(s?.state).toBe("dormant");
    expect(s?.why).toContain("2 acts against targets outside the AOI not counted");
  });
});

describe("registration", () => {
  it("the counterspace indicator exists only for Russia / China boards; the sensor keys are registered", () => {
    expect(spectrumIndicators("p", "Iran", ["IRN"]).some((i) => i.id === COUNTERSPACE_ID)).toBe(false);
    const rus = spectrumIndicators("p", "Russia", ["RUS"]);
    const ind = rus.find((i) => i.id === COUNTERSPACE_ID);
    expect(ind).toBeTruthy();
    expect(ind!.falsifier).toContain("50 km");
    expect(sensorKeyDef("rpo:rus")?.policy).toBe("peak");
    expect(sensorKeyDef("prox:rus")?.policy).toBe("min");
  });
});
