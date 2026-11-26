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
