import { describe, it, expect } from "vitest";
import { dmsCheck } from "../lib/ukmtoParse";
import { pirepFieldReport } from "../lib/icingSignals";

describe("dmsCheck — the packed DMS spelling against the decimals on the same row", () => {
  it("agrees, disagrees and cannot read, with samples; rows lacking a side are not counted", () => {
    const c = dmsCheck([
      { locationLatitude: 26.4, locationLongitude: 56.4167, locationLatitudeDDDMMSS: "262400N", locationLongitudeDDDMMSS: "0562500E" },
      { locationLatitude: 12.5, locationLongitude: 43.5, locationLatitudeDDDMMSS: "123000N", locationLongitudeDDDMMSS: "0443000E" },
      { locationLatitude: 13, locationLongitude: 45, locationLatitudeDDDMMSS: "thirteen", locationLongitudeDDDMMSS: "x" },
      { locationLatitude: 13, locationLongitude: 45 },
      { locationLatitude: 0, locationLongitude: 0, locationLatitudeDDDMMSS: "000000N", locationLongitudeDDDMMSS: "0000000E" },
    ]);
    expect(c).toMatchObject({ pairs: 3, agree: 1, disagreeCount: 1, unparsedCount: 1 });
    expect(c.disagree[0]).toMatch(/123000N 0443000E \| decimals 12.5000,43.5000 \| read 12.5000,44.5000/);
    expect(c.unparsed[0]).toMatch(/^thirteen x/);
  });
});

describe("pirepFieldReport — what the PIREP rows actually carry", () => {
  it("counts keys, icing from the field vs the raw /IC group, turbulence keys and raw /TB", () => {
    const r = pirepFieldReport([
      { obsTime: 1764150000, lat: 39.8, lon: -104.7, icgInt1: "MOD", icgType1: "RIME", rawOb: "DEN UA /OV DEN /TM 1800 /FL080 /TP B737 /IC MOD RIME" },
      { obsTime: 1764150000, lat: 39.8, lon: -104.7, icgInt1: "", tbInt1: "LGT-MOD", rawOb: "DEN UA /OV DEN /FL120 /TB LGT-MOD /IC LGT" },
      { obsTime: 1764150000, lat: 39.8, lon: -104.7, icgInt1: "LGT", rawOb: "DEN UA /FL050 /IC MOD" },
      { obsTime: 1764150000, lat: 39.8, lon: -104.7, rawOb: "DEN UA /FL300 /SK SKC" },
    ]);
    expect(r.rows).toBe(4);
    expect(r.keys).toMatchObject({ obsTime: 4, icgInt1: 2, tbInt1: 1, icgType1: 1 });
    expect(r.icing).toMatchObject({ field: 2, rawOnly: 1 });
    expect(r.icing.disagree[0]).toMatch(/field LGT vs raw MOD/);
    expect(r.icing.firstRow).toMatch(/"icgInt1":"MOD"/);
    expect(r.turbulence).toMatchObject({ keys: ["tbInt1"], field: 1, raw: 1 });
    expect(r.turbulence.firstRow).toMatch(/tbInt1/);
  });
  it("a GeoJSON collection reads its properties; garbage reads zero rows", () => {
    expect(pirepFieldReport({ features: [{ properties: { icgInt1: "SEV", rawOb: "x" } }] }).icing.field).toBe(1);
    expect(pirepFieldReport("nope").rows).toBe(0);
  });
});

import { parsePireps, pirepTurbNear } from "../lib/icingSignals";
import { readTurbulence } from "../lib/turbulence";

// Rows shaped exactly as the production diag returned them (KDEN, 2026-11-26).
const NOW = 1795699560_000 + 10 * 60_000;
const row = (over: Record<string, unknown>) => ({
  receiptTime: "2026-11-26T13:30:03.557Z", obsTime: 1795699560, qcField: 0, icaoId: "", acType: "B737",
  lat: 39.75, lon: -104.75, fltLvl: 80, fltLvlType: "OTHER", clouds: null,
  icgBas1: null, icgTop1: null, icgInt1: "", icgType1: "", icgBas2: null, icgTop2: null, icgInt2: "", icgType2: "",
  tbBas1: null, tbTop1: null, tbInt1: "", tbType1: "", tbFreq1: "", tbBas2: null, tbTop2: null, tbInt2: "", tbType2: "", tbFreq2: "",
  pirepType: "PIREP", rawOb: "DEN UA /OV DEN/TM 1326/FL080/TP B737", ...over,
});

describe("PIREPs as the production body carries them", () => {
  it("icing reads the WORSE of the two layers, with that layer's base as its altitude", () => {
    const { pireps } = parsePireps([row({ icgInt1: "LGT", icgBas1: 60, icgInt2: "MOD", icgType2: "RIME", icgBas2: 90 })]);
    expect(pireps[0]).toMatchObject({ intensity: "MOD", type: "RIME", altFt: 9000 });
    expect(parsePireps([row({ icgInt2: "NEGclr", icgBas2: 350 })]).pireps[0].intensity).toBe("NEG");
  });
  it("turbulence: the field first, the raw /TB group as the fallback", () => {
    const [a, b] = parsePireps([
      row({ tbInt1: "LGT-MOD", tbType1: "CHOP", tbFreq1: "OCNL" }),
      row({ fltLvl: 120, rawOb: "000 UBCO90 KWBC 261330 ASE UA /OV DBL090030/TM 1326/FL120/TP B737/TB OCNL LGT-OCNL MOD CHOP/RM ZDVWC-05" }),
    ]).pireps;
    expect(a.turb).toMatchObject({ intensity: "MOD", type: "CHOP", freq: "OCNL", altFt: 8000 });
    expect(b.turb).toMatchObject({ intensity: "MOD", type: "CHOP", altFt: 12000 });
  });
  it("near the field: NEG and cruise-level reports never count", () => {
    const { pireps } = parsePireps([row({ tbInt1: "NEG" }), row({ tbInt1: "MOD", fltLvl: 374 }), row({ tbInt1: "SEV", fltLvl: 100 })]);
    const near = pirepTurbNear(pireps, { lat: 39.86, lon: -104.67 }, 5434, NOW);
    expect(near.map((n) => n.intensity)).toEqual(["SEV"]);
  });
  it("the turbulence read: a severe PIREP in the band is RED, moderate AMBER, and none is not smooth air", () => {
    const base = { nowMs: NOW, field: { lat: 39.86, lon: -104.67 }, icao: "KDEN", elevFt: 5434, metar: { windSpeedKt: 8, windGustKt: null, raw: "KDEN 261353Z 18008KT" }, taf: null, hazards: null, sigmets: null };
    const sev = readTurbulence({ ...base, pireps: { live: true, items: parsePireps([row({ tbInt1: "SEV", tbType1: "CAT", fltLvl: 110 })]).pireps } });
    expect(sev.level).toBe("r");
    expect(sev.drivers[0]).toMatchObject({ source: "PIREP", tone: "r" });
    expect(sev.drivers[0].text).toMatch(/SEVERE turbulence \(cat\) at 11,000 ft/);
    const mod = readTurbulence({ ...base, pireps: { live: true, items: parsePireps([row({ tbInt1: "MOD" })]).pireps } });
    expect(mod.level).toBe("a");
    const none = readTurbulence({ ...base, pireps: { live: true, items: [] } });
    expect(none.level).toBe("g");
    expect(none.summary).toMatch(/none is not smooth air/);
    expect(readTurbulence({ ...base }).sources.pirep).toBeNull(); // an older caller says nothing about PIREPs
  });
});
