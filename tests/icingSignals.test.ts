import { describe, it, expect } from "vitest";
import {
  parseFieldProfile, levelPotential, modelWindows, modelSurfaceFreezing, wxCodes, cloudBaseTempC, metarCloudIcing,
  tafIcing, sigmetIcing, pirepIntensity, rawIcingGroup, parsePireps, pirepsNear, readIcing, type FieldProfile,
} from "../lib/icingSignals";
import type { Sigmet } from "../lib/sigmetParse";
import type { TafPeriod } from "../lib/types";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const FIELD = { lat: 40.0, lon: -74.6 };

// A profile: field at 40 m; a saturated layer at 925/850 hPa (≈ 2,500–5,000
// ft) at −3 / −8 °C for hours 0–5, dry afterwards.
function profileJson(hours = 10, wet = (i: number) => i < 6) {
  const time: string[] = [];
  const cols: Record<string, (number | null)[]> = {};
  const set = (k: string, v: number | null) => { (cols[k] ||= []).push(v); };
  for (let i = 0; i < hours; i++) {
    time.push(iso(NOW + i * H));
    set("temperature_2m", 3); set("freezing_level_height", 700); set("weather_code", i === 8 ? 66 : 3); set("precipitation", 0);
    set("wind_direction_10m", 240); set("wind_speed_10m", 12); set("wind_gusts_10m", 20);
    const lv: [number, number, number, number][] = [[1000, 120, 2, 80], [950, 560, 0, 88], [925, 780, -3, wet(i) ? 97 : 60], [900, 1000, -5, 70], [850, 1500, -8, wet(i) ? 96 : 50], [800, 2000, -11, 60], [700, 3050, -18, 40], [600, 4300, -26, 30], [975, 330, 1, 80]];
    for (const [p, h, t, rh] of lv) { set(`geopotential_height_${p}hPa`, h); set(`temperature_${p}hPa`, t); set(`relative_humidity_${p}hPa`, rh); }
  }
  return { elevation: 40, hourly: { time, ...cols } };
}

describe("model profile", () => {
  it("parses hours and levels, sorted by height", () => {
    const p = parseFieldProfile(profileJson());
    expect(p.live).toBe(true);
    expect(p.elevationM).toBe(40);
    expect(p.hours).toHaveLength(10);
    expect(p.hours[0].levels[0].hPa).toBe(1000);
    expect(p.hours[0].windKt).toBe(12);
  });
  it("a body with no hourly block is not live", () => {
    expect(parseFieldProfile({}).live).toBe(false);
  });
  it("classes potential by temperature and humidity", () => {
    expect(levelPotential(-3, 97)).toBe("likely");
    expect(levelPotential(-18, 97)).toBe("possible");
    expect(levelPotential(-5, 88)).toBe("possible");
    expect(levelPotential(-5, 70)).toBeNull();
    expect(levelPotential(2, 99)).toBeNull();
    expect(levelPotential(-25, 99)).toBeNull();
  });
  it("joins conducive hours into windows inside the approach band", () => {
    const p = parseFieldProfile(profileJson());
    const w = modelWindows(p, NOW);
    const likely = w.find((x) => x.potential === "likely")!;
    expect(likely.fromMs).toBe(NOW);
    expect(likely.toMs).toBe(NOW + 6 * H);
    expect(likely.baseFtAgl).toBeGreaterThan(2000);
    expect(likely.topFtAgl).toBeLessThanOrEqual(10_000);
    // 950 hPa at 0 °C, RH 88 → possible, so dry hours still carry a possible layer
    expect(w.some((x) => x.potential === "possible")).toBe(true);
  });
  it("finds model freezing precipitation codes", () => {
    const sf = modelSurfaceFreezing(parseFieldProfile(profileJson()), NOW)!;
    expect(sf.code).toBe(66);
    expect(sf.fromMs).toBe(NOW + 8 * H);
  });
});

describe("METAR and TAF", () => {
  it("reads freezing codes, never a plain RA", () => {
    expect(wxCodes("-FZRA BR").freezingPrecip).toBe(true);
    expect(wxCodes("FZDZ").freezingPrecip).toBe(true);
    expect(wxCodes("-RA BR").freezingPrecip).toBe(false);
    expect(wxCodes("FZFG").freezingFog).toBe(true);
    expect(wxCodes("-SN").snow).toBe(true);
    expect(wxCodes("-SHRA").snow).toBe(false);
    expect(wxCodes("PL").pellets).toBe(true);
  });
  it("estimates a cloud base temperature by the standard lapse rate", () => {
    expect(cloudBaseTempC(2, 2000)).toBeCloseTo(-2, 0);
    const hit = metarCloudIcing({ tempC: 2, clouds: [{ cover: "FEW", baseFt: 800 }, { cover: "OVC", baseFt: 2000 }] })!;
    expect(hit.baseFt).toBe(2000);
    expect(metarCloudIcing({ tempC: 15, clouds: [{ cover: "OVC", baseFt: 2000 }] })).toBeNull();
    expect(metarCloudIcing({ tempC: 2, clouds: [{ cover: "SCT", baseFt: 2000 }] })).toBeNull();
  });
  it("lists TAF freezing periods with their windows", () => {
    const taf: TafPeriod[] = [
      { from: new Date(NOW - H).toISOString(), to: new Date(NOW + 6 * H).toISOString(), changeType: "", flightCategory: "MVFR", summary: "", wxRaw: "-RA" },
      { from: new Date(NOW + 3 * H).toISOString(), to: new Date(NOW + 5 * H).toISOString(), changeType: "TEMPO", flightCategory: "IFR", summary: "", wxRaw: "-FZRA" },
    ];
    const w = tafIcing(taf, NOW);
    expect(w).toHaveLength(1);
    expect(w[0].change).toBe("TEMPO");
    expect(w[0].freezing).toBe(true);
  });
});

const sig = (over: Partial<Sigmet>): Sigmet => ({
  id: "x", kind: "domestic", hazard: "icing", fir: "KZNY", series: null, qualifier: null, baseFt: 3000, topFt: 16000,
  fromISO: new Date(NOW - H).toISOString(), toISO: new Date(NOW + 3 * H).toISOString(),
  points: [[39, -76], [41, -76], [41, -73], [39, -73]], areaFrom: "coords", movement: null, raw: "", tone: "amber", ...over,
});

describe("SIGMET and PIREP", () => {
  it("a SIGMET icing over the field in the band is in effect", () => {
    const s = sigmetIcing([sig({})], FIELD, 100, NOW);
    expect(s).toHaveLength(1);
    expect(s[0].covers).toBe(true);
    expect(s[0].inEffect).toBe(true);
  });
  it("skips a SIGMET above the band, far away, expired or not icing", () => {
    expect(sigmetIcing([sig({ baseFt: 18000 })], FIELD, 100, NOW)).toHaveLength(0);
    expect(sigmetIcing([sig({ points: [[10, 10], [11, 10], [11, 11]] })], FIELD, 100, NOW)).toHaveLength(0);
    expect(sigmetIcing([sig({ toISO: new Date(NOW - 1000).toISOString() })], FIELD, 100, NOW)).toHaveLength(0);
    expect(sigmetIcing([sig({ hazard: "turbulence" })], FIELD, 100, NOW)).toHaveLength(0);
  });
  it("reads PIREP intensity, worst word wins", () => {
    expect(pirepIntensity("LGT-MOD")).toBe("MOD");
    expect(pirepIntensity("SEV")).toBe("SEV");
    expect(pirepIntensity("NEG")).toBe("NEG");
    expect(pirepIntensity("")).toBeNull();
    expect(rawIcingGroup("UA /OV ABE /TM 1150 /FL080 /TP C130 /IC MOD RIME /RM")).toEqual({ intensity: "MOD", type: "RIME" });
  });
  it("parses AWC rows and keeps nearby, recent, in-band icing reports", () => {
    const body = [
      { obsTime: (NOW - 30 * 60_000) / 1000, lat: 40.2, lon: -74.4, fltLvl: "060", icgInt1: "MOD", icgType1: "RIME", acType: "C17", rawOb: "UA /FL060 /IC MOD RIME" },
      { obsTime: (NOW - 30 * 60_000) / 1000, lat: 40.2, lon: -74.4, fltLvl: "250", icgInt1: "SEV", rawOb: "UA /FL250 /IC SEV" },
      { obsTime: (NOW - 6 * H) / 1000, lat: 40.2, lon: -74.4, fltLvl: "060", icgInt1: "SEV", rawOb: "old" },
      { obsTime: (NOW - 10 * 60_000) / 1000, lat: 45, lon: -70, fltLvl: "050", icgInt1: "SEV", rawOb: "far" },
      { obsTime: (NOW - 10 * 60_000) / 1000, lat: 40.1, lon: -74.5, rawOb: "UA /OV X /FL040 /TB LGT" },
    ];
    const { pireps, rows } = parsePireps(body);
    expect(rows).toBe(5);
    const near = pirepsNear(pireps, FIELD, 100, NOW);
    expect(near).toHaveLength(2);
    expect(near[0].intensity).toBe("SEV");
    expect(near[0].inBand).toBe(false);
    expect(near[1]).toMatchObject({ intensity: "MOD", inBand: true, altFt: 6000 });
  });
});

describe("readIcing", () => {
  const profile: FieldProfile = parseFieldProfile(profileJson());
  const base = { nowMs: NOW, field: FIELD, taf: [], sigmets: { live: true, items: [] }, pireps: { live: true, items: [] } };

  it("observed freezing rain is red and a contamination window", () => {
    const r = readIcing({ ...base, metar: { tempC: 0, dewpointC: -1, clouds: [], wxRaw: "-FZRA" }, profile });
    expect(r.level).toBe("r");
    expect(r.drivers[0].source).toBe("METAR");
    expect(r.contaminationWindows.length).toBeGreaterThan(0);
  });
  it("a likely model layer within 12 h is amber, said as model", () => {
    const r = readIcing({ ...base, metar: { tempC: 8, dewpointC: 2, clouds: [], wxRaw: "" }, profile });
    expect(r.level).toBe("a");
    expect(r.summary).toMatch(/likely on approach/);
    expect(r.summary).toMatch(/model/);
  });
  it("only possible layers read green with a note", () => {
    const dry = parseFieldProfile(profileJson(10, () => false));
    const r = readIcing({ ...base, metar: { tempC: 8, dewpointC: 2, clouds: [], wxRaw: "" }, profile: { ...dry, hours: dry.hours.map((h) => ({ ...h, weatherCode: 3 })) } });
    expect(r.level).toBe("g");
    expect(r.summary).toMatch(/^No moderate or severe icing forecast, warned or likely inside 12 h · /);
  });
  it("a SIGMET icing in effect is red", () => {
    const r = readIcing({ ...base, metar: null, profile, sigmets: { live: true, items: [sig({})] } });
    expect(r.level).toBe("r");
    expect(r.drivers[0].source).toBe("SIGMET");
  });
  it("nothing answered is UNKNOWN, never green", () => {
    const r = readIcing({ ...base, metar: null, profile: null, sigmets: null, pireps: null });
    expect(r.level).toBe("u");
    expect(r.summary).toMatch(/UNKNOWN/);
  });
  it("reports the freezing level", () => {
    const r = readIcing({ ...base, metar: { tempC: 8, dewpointC: 2, clouds: [], wxRaw: "" }, profile });
    expect(r.freezingLevel?.msl).toBe(2300);
  });
});
