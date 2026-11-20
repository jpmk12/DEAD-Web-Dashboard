import { describe, it, expect } from "vitest";
import { parseTafHazards, decodeIcingGroup, placeDayHour, icingGroupLabel } from "../lib/tafGroups";
import { readIcing, sigmetIcing, firFamily } from "../lib/icingSignals";
import type { Sigmet } from "../lib/sigmetParse";

const ISSUED = "2026-11-18T05:00:00Z";
const NOW = Date.parse("2026-11-18T06:30:00Z");
const H = 3_600_000;
const at = (iso: string) => Date.parse(iso);
const MIL = "TAF ETAD 180500Z 1806/1912 24012G20KT 9999 -SHRA BKN025 OVC040 620304 QNH2992INS " +
  "BECMG 1810/1811 27015G25KT 8000 -SHRASN BKN015 OVC030 650206 510004 QNH2985INS " +
  "TEMPO 1812/1818 4800 SHSN BKN008 680105 " +
  "BECMG 1902/1903 VRB06KT 9999 NSW SCT040 QNH2990INS TX04/1813Z TN M02/1906Z";

describe("decodeIcingGroup", () => {
  it("reads type, base and thickness", () => {
    expect(decodeIcingGroup("620304")).toMatchObject({ intensity: "light", type: "rime in cloud", baseFtAgl: 3000, topFtAgl: 7000 });
    expect(decodeIcingGroup("680105")).toMatchObject({ intensity: "severe", type: "rime in cloud", baseFtAgl: 1000, topFtAgl: 6000 });
    expect(decodeIcingGroup("640200")).toMatchObject({ intensity: "moderate", type: "mixed", topFtAgl: null });
    expect(decodeIcingGroup("9999")).toBeNull();
    expect(decodeIcingGroup("180500")).toBeNull(); // not a 6-group
  });
  it("labels a layer", () => {
    expect(icingGroupLabel(decodeIcingGroup("650206")!)).toBe("moderate rime in cloud icing 2,000 ft–8,000 ft AGL");
    expect(icingGroupLabel(decodeIcingGroup("640200")!)).toMatch(/thickness not stated/);
  });
});

describe("placeDayHour", () => {
  it("rolls into the next month near the end of one", () => {
    expect(placeDayHour(1, 6, 0, at("2026-11-30T23:00:00Z"))).toBe(at("2026-12-01T06:00:00Z"));
    expect(placeDayHour(30, 24, 0, at("2026-11-30T12:00:00Z"))).toBe(at("2026-12-01T00:00:00Z"));
  });
  it("refuses a day the month does not have", () => {
    expect(placeDayHour(31, 0, 0, at("2026-11-15T00:00:00Z"))).not.toBe(at("2026-11-31T00:00:00Z"));
  });
});

describe("parseTafHazards", () => {
  it("places each group in the period it is written in", () => {
    const hz = parseTafHazards(MIL, ISSUED, NOW);
    expect(hz.ok).toBe(true);
    expect(hz.military).toBe(true);
    expect(hz.groups).toHaveLength(3);
    const [base, becmg, tempo] = hz.groups;
    expect(base).toMatchObject({ code: "620304", change: "", fromMs: at("2026-11-18T06:00:00Z"), toMs: at("2026-11-18T10:00:00Z") });
    // BECMG runs from the start of its window to the next prevailing change.
    expect(becmg).toMatchObject({ code: "650206", change: "BECMG", fromMs: at("2026-11-18T10:00:00Z"), toMs: at("2026-11-19T02:00:00Z") });
    expect(tempo).toMatchObject({ code: "680105", change: "TEMPO", fromMs: at("2026-11-18T12:00:00Z"), toMs: at("2026-11-18T18:00:00Z") });
  });
  it("reads FM and PROB TEMPO groups", () => {
    const raw = "TAF AMD ETAR 181200Z 1812/1918 22010KT 9999 BKN030 QNH2990INS FM181800 25015KT 6000 -RA OVC020 640304 PROB30 TEMPO 1900/1906 3000 FZRA 670003";
    const hz = parseTafHazards(raw, null, at("2026-11-18T12:30:00Z"));
    expect(hz.groups.map((g) => [g.code, g.change])).toEqual([["640304", "FM"], ["670003", "PROB30 TEMPO"]]);
    expect(hz.groups[0].fromMs).toBe(at("2026-11-18T18:00:00Z"));
    expect(hz.groups[0].toMs).toBe(at("2026-11-19T18:00:00Z"));
  });
  it("a civil TAF is not military and carries no groups", () => {
    const hz = parseTafHazards("TAF EDDF 180500Z 1806/1912 25010KT 9999 BKN030 TEMPO 1806/1810 4000 RA", ISSUED, NOW);
    expect(hz.ok).toBe(true);
    expect(hz.military).toBe(false);
    expect(hz.groups).toEqual([]);
  });
  it("ignores RMK and an unreadable header", () => {
    expect(parseTafHazards("TAF ETAD 180500Z 1806/1912 9999 SKC QNH2992INS RMK 620304", ISSUED, NOW).groups).toEqual([]);
    expect(parseTafHazards("garbage", ISSUED, NOW).ok).toBe(false);
    expect(parseTafHazards("", ISSUED, NOW).ok).toBe(false);
  });
});

describe("readIcing with a military TAF", () => {
  const base = { nowMs: NOW, field: { lat: 49.97, lon: 6.69 }, metar: { tempC: 3, dewpointC: 1, clouds: [], wxRaw: "" }, taf: [], profile: null, sigmets: null, pireps: null };
  it("a moderate / severe group is amber (a forecast, never red) and severe leads", () => {
    const r = readIcing({ ...base, tafRaw: MIL, tafIssued: ISSUED });
    expect(r.militaryTaf).toBe(true);
    expect(r.level).toBe("a");
    expect(r.tafGroups.map((g) => g.intensity)).toEqual(["severe", "moderate", "light"]);
    expect(r.summary).toMatch(/TAF TEMPO forecasts SEVERE rime in cloud icing 1,000 ft–6,000 ft AGL 1200Z–1800Z/);
    expect(r.drivers.find((d) => /light rime/.test(d.text))?.tone).toBe("i");
  });
  it("a military TAF with no icing group says so on a quiet read", () => {
    const r = readIcing({ ...base, tafRaw: "TAF ETAD 180500Z 1806/1912 24008KT 9999 SCT040 QNH2992INS", tafIssued: ISSUED });
    expect(r.level).toBe("g");
    expect(r.summary).toMatch(/military TAF forecasts no icing group/);
  });
  it("a layer above the approach band is left out", () => {
    const r = readIcing({ ...base, tafRaw: "TAF ETAD 180500Z 1806/1912 24008KT 9999 BKN120 641203 QNH2992INS", tafIssued: ISSUED });
    expect(r.tafGroups).toEqual([]);
  });
});

describe("SIGMET with no readable area", () => {
  const sig = (o: Partial<Sigmet>): Sigmet => ({
    id: "x", kind: "international", hazard: "icing", fir: "EDGG LANGEN", series: null, qualifier: "SEV", baseFt: 4000, topFt: 12000,
    fromISO: new Date(NOW - H).toISOString(), toISO: new Date(NOW + 3 * H).toISOString(), points: [], areaFrom: null, movement: null,
    raw: "EDGG SIGMET 2 VALID ... SEV ICE FCST ENTIRE FIR", tone: "amber", ...o,
  } as Sigmet);
  it("is named — never placed, never coloured — for a field in the same region", () => {
    expect(firFamily("ETAD")).toEqual(["ET", "ED"]);
    const s = sigmetIcing([sig({})], { lat: 49.97, lon: 6.69 }, 1200, NOW, 12, "ETAD");
    expect(s).toHaveLength(1);
    expect(s[0].unplaced).toBe(true);
    expect(s[0].line).toMatch(/EDGG FIR .*ENTIRE FIR/);
    const r = readIcing({ nowMs: NOW, field: { lat: 49.97, lon: 6.69 }, icao: "ETAD", metar: { tempC: 3, dewpointC: 1, clouds: [], wxRaw: "" }, taf: [], profile: null, sigmets: { live: true, items: [sig({})] }, pireps: null });
    expect(r.level).toBe("g");
    expect(r.drivers[0].tone).toBe("i");
  });
  it("is ignored for a field in another region, and for U.S. fields", () => {
    expect(sigmetIcing([sig({})], { lat: 31.8, lon: 36.8 }, 1700, NOW, 12, "OJAQ")).toEqual([]);
    expect(firFamily("KWRI")).toEqual([]);
  });
});

describe("ETAD's real TAF (production diag 2026-11-20)", () => {
  const RAW = "TAF AMD ETAD 201040Z 2010/2111 24012G25KT 9000 -RA OVC007 620409 510006 QNH2948INS TEMPO 2010/2018 6000 RA BKN010 BECMG 2017/2018 31010G20KT 9000 -RA SCT007 BKN010 OVC015 620507 QNH2963INS BECMG 2021/2022 31010G15KT 9999 NSW SCT040 QNH2985INS BECMG 2102/2103 28006KT 3200 BR BKN006 QNH2999INS TX08/2013Z TN00/2103Z";
  const ISS = "2026-11-20T10:40:00.000Z";
  const T = Date.parse("2026-11-20T11:00:00Z");
  it("reads both icing groups and the turbulence group in their periods", () => {
    const hz = parseTafHazards(RAW, ISS, T);
    expect(hz.military).toBe(true);
    expect(hz.groups.map((g) => [g.code, g.change, new Date(g.fromMs).toISOString(), new Date(g.toMs).toISOString()])).toEqual([
      ["620409", "", "2026-11-20T10:00:00.000Z", "2026-11-20T17:00:00.000Z"],
      ["620507", "BECMG", "2026-11-20T17:00:00.000Z", "2026-11-20T21:00:00.000Z"],
    ]);
    expect(hz.turbulence.map((g) => [g.code, g.intensity])).toEqual([["510006", "light"]]);
  });
  it("light icing only is a note: green, the TAF named as such, never contradicted", () => {
    const r = readIcing({ nowMs: T, field: { lat: 49.97, lon: 6.69 }, icao: "ETAD", metar: { tempC: 6, dewpointC: 5, clouds: [], wxRaw: "-RA" }, taf: [], profile: null, sigmets: null, pireps: null, tafRaw: RAW, tafIssued: ISS });
    expect(r.level).toBe("g");
    expect(r.summary).toMatch(/^No moderate or severe icing forecast, warned or likely inside 12 h · TAF forecasts light rime in cloud icing/);
    expect(r.summary).not.toMatch(/No icing expected/);
  });
});
