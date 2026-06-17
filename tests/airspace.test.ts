import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseAirspaceGroups, type AirspaceGroup } from "@/lib/airspace";
import { firByCode, firsForCountry, resolveFirs, FIRS } from "@/lib/firData";

// Fixtures are real DAIP /mobile/query responses captured from the live portal
// (tests/fixtures/daip/*.json). Every query type shares one envelope, so these
// exercise the parser the FIR/GPS/Fuel layers all depend on. A fixed "now" keeps
// expiry-filtering deterministic regardless of when the suite runs — the capture
// was taken 2026-06-17, so use a clock shortly after.
const NOW = Date.parse("2026-06-17T16:00:00Z");
const fx = (name: string) =>
  readFileSync(path.resolve(__dirname, "fixtures/daip", name), "utf8").replace(/^﻿/, "");

describe("parseAirspaceGroups — GPS_WAAS fixture", () => {
  const groups = parseAirspaceGroups(fx("gps_waas.json"), NOW);

  it("keeps DAIP's two system groups", () => {
    const names = groups.map((g) => g.code).sort();
    expect(names).toContain("GPS NOTAMs");
    expect(names).toContain("WAAS NOTAMs");
  });

  it("categorizes the GPS group as gps_raim and carries raw text", () => {
    const all = groups.flatMap((g) => g.notams);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((n) => n.rawtext.length > 0)).toBe(true);
    // The "GPS NOTAMs" group is pure GPS outages → all gps_raim. (A couple of
    // WAAS NOTAMs reference RNAV/LPV approaches and rightly categorize as
    // "approach", so we don't assert gps_raim across every group.)
    const gps = groups.find((g) => g.code === "GPS NOTAMs");
    expect(gps).toBeDefined();
    expect(gps!.notams.every((n) => n.category === "gps_raim")).toBe(true);
    // gps_raim is still the dominant category overall.
    const raim = all.filter((n) => n.category === "gps_raim").length;
    expect(raim).toBeGreaterThan(all.length / 2);
  });

  it("each group reports a worst alert level and a matching count", () => {
    for (const g of groups) {
      expect(["Warning", "Caution", "Default"]).toContain(g.worst);
      expect(g.count).toBe(g.notams.length);
    }
  });
});

describe("parseAirspaceGroups — MOA fixture (FIR-grouped, like FIR_ARTCC)", () => {
  const groups = parseAirspaceGroups(fx("moa.json"), NOW);

  it("preserves per-FIR group identity", () => {
    expect(groups.length).toBeGreaterThan(1);
    // group codes are FIR/ICAO identifiers, e.g. EVRR (Riga FIR)
    expect(groups.some((g) => /^[A-Z]{4}$/.test(g.code))).toBe(true);
  });

  it("a known FIR group resolves to a friendly name", () => {
    const evrr = groups.find((g) => g.code === "EVRR");
    if (evrr) expect(evrr.name.toUpperCase()).toContain("RIGA");
  });
});

describe("parseAirspaceGroups — FUEL_NOTAMS empty fixture (count 0)", () => {
  it("returns no groups but does not throw (plumbing valid, just no data)", () => {
    const groups = parseAirspaceGroups(fx("fuel_notams.json"), NOW);
    expect(groups).toEqual([]);
  });
});

describe("parseAirspaceGroups — LOCATION fixture", () => {
  it("groups per ICAO and tags NOTAMs with their group", () => {
    const groups = parseAirspaceGroups(fx("location.json"), NOW);
    const kadw = groups.find((g) => g.code === "KADW");
    expect(kadw).toBeDefined();
    expect(kadw!.notams.every((n) => n.group === "KADW")).toBe(true);
  });
});

describe("parseAirspaceGroups — FIR_ARTCC fixture (Damascus OSTT, real capture)", () => {
  const groups = parseAirspaceGroups(fx("fir_ostt.json"), NOW);

  it("returns the FIR-level enroute group plus the airports inside the FIR", () => {
    const ostt = groups.find((g) => g.code === "OSTT");
    expect(ostt).toBeDefined();
    // OSTT's own enroute NOTAMs (airway closures, temp restricted areas, FIR status)
    expect(ostt!.notams.length).toBeGreaterThan(10);
    // airport ICAOs inside the Damascus FIR also come back as their own groups
    expect(groups.some((g) => g.code.startsWith("OS") && g.code !== "OSTT")).toBe(true);
  });

  it("the FIR group's NOTAMs carry raw ICAO text and a group tag", () => {
    const ostt = groups.find((g) => g.code === "OSTT")!;
    expect(ostt.notams.every((n) => n.group === "OSTT")).toBe(true);
    expect(ostt.notams.some((n) => /^[A-Z]\d{4}\/\d{2}/.test(n.rawtext))).toBe(true);
  });

  it("getFirNotams keeps only the FIR-level group (the centroid-resolvable one)", () => {
    // Mirror getFirNotams' selection: of all groups, only the queried FIR code
    // resolves to a centroid, so only it would be plotted.
    const plotted = groups.filter((g) => firByCode(g.code));
    expect(plotted.map((g) => g.code)).toEqual(["OSTT"]);
  });
});

describe("parseAirspaceGroups — empty / placeholder FIR", () => {
  it("drops a FIR whose only NOTAM is the 'no active NOTAMs' placeholder", () => {
    // DAIP returns an empty-text placeholder item for a FIR with no NOTAMs.
    const placeholder = JSON.stringify({
      type: "FIR_ARTCC", count: 0,
      group: [{ name: "ORBB", notams: [{ code: "ORBB", name: "ORBB BAGHDAD FIR (Either this location has no active NOTAMs ...)", list: [{ text: "", rawtext: "" }] }] }],
    });
    expect(parseAirspaceGroups(placeholder, NOW)).toEqual([]);
  });
});

describe("parseAirspaceGroups — robustness", () => {
  it("returns [] on malformed / non-DAIP JSON", () => {
    expect(parseAirspaceGroups("not json", NOW)).toEqual([]);
    expect(parseAirspaceGroups("{}", NOW)).toEqual([]);
    expect(parseAirspaceGroups('{"group":"nope"}', NOW)).toEqual([]);
  });

  it("drops fully-expired groups", () => {
    // Far-future clock: every captured NOTAM's C) end has passed.
    const groups = parseAirspaceGroups(fx("gps_waas.json"), Date.parse("2099-01-01T00:00:00Z"));
    const withEnd = (g: AirspaceGroup) => g.notams.some((n) => n.end);
    expect(groups.every((g) => !withEnd(g) || g.notams.every((n) => !n.end))).toBe(true);
  });
});

describe("firData", () => {
  it("maps conflict countries to their FIRs (case-insensitive)", () => {
    expect(firsForCountry("Syria").map((f) => f.code)).toContain("OSTT");
    expect(firsForCountry("iraq").map((f) => f.code)).toContain("ORBB");
    expect(firsForCountry("IRAN").map((f) => f.code)).toContain("OIIX");
  });

  it("returns multiple FIRs for multi-FIR countries", () => {
    expect(firsForCountry("ukraine").length).toBeGreaterThan(1);
  });

  it("looks up a FIR by code and carries a centroid", () => {
    const f = firByCode("ostt");
    expect(f?.name).toMatch(/Damascus/i);
    expect(Number.isFinite(f?.lat) && Number.isFinite(f?.lon)).toBe(true);
  });

  it("resolveFirs accepts mixed country names and FIR codes, de-duped", () => {
    const codes = resolveFirs(["Syria", "ORBB", "ukraine", "ORBB"]).map((f) => f.code);
    expect(codes).toContain("OSTT");
    expect(codes).toContain("ORBB");
    expect(new Set(codes).size).toBe(codes.length); // no dupes
  });

  it("drops unknown tokens", () => {
    expect(resolveFirs(["Narnia", "ZZZZ"]).length).toBe(0);
  });

  it("every FIR row has a valid centroid and code", () => {
    for (const f of FIRS) {
      expect(f.code).toMatch(/^[A-Z]{4}$/);
      expect(f.lat).toBeGreaterThanOrEqual(-90);
      expect(f.lat).toBeLessThanOrEqual(90);
      expect(f.lon).toBeGreaterThanOrEqual(-180);
      expect(f.lon).toBeLessThanOrEqual(180);
    }
  });
});
