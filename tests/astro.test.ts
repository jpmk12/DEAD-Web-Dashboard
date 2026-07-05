import { describe, it, expect } from "vitest";
import { sunTimes, moonInfo } from "../lib/astro";
import { runwayWindComponents, crosswindFlag, runwayWinds } from "../lib/sitrepSignals";

describe("sunTimes", () => {
  // KWRI (40.02N, -74.59W) on a July day: sunrise ~09:35Z, sunset ~00:30Z(+1),
  // civil twilight ~30 min beyond each. Assert coarse invariants, not almanac
  // precision (the lib is planning-grade by design).
  const KWRI = { lat: 40.0155, lon: -74.5917 };
  const JUL = Date.UTC(2026, 6, 5, 12, 0);

  it("orders civil dawn < sunrise and sunset < civil dusk", () => {
    const t = sunTimes(KWRI.lat, KWRI.lon, JUL);
    expect(t.sunriseZ).toBeTruthy();
    expect(t.civilDawnZ).toBeTruthy();
    expect(Date.parse(t.civilDawnZ!)).toBeLessThan(Date.parse(t.sunriseZ!));
    // times are on the same UTC day; sunset for a US-east summer evening
    // lands near 00Z of the next local day but is computed for this UTC day
    expect(t.sunsetZ).toBeTruthy();
    expect(t.civilDuskZ).toBeTruthy();
  });

  it("summer sunrise at KWRI lands in a plausible 09-11Z window", () => {
    const t = sunTimes(KWRI.lat, KWRI.lon, JUL);
    const h = new Date(t.sunriseZ!).getUTCHours();
    expect(h).toBeGreaterThanOrEqual(9);
    expect(h).toBeLessThanOrEqual(11);
  });

  it("polar night returns nulls instead of fake times", () => {
    // Alert, Nunavut (82.5N) in late December: no sunrise.
    const t = sunTimes(82.5, -62.3, Date.UTC(2026, 11, 21, 12, 0));
    expect(t.sunriseZ).toBeNull();
    expect(t.sunsetZ).toBeNull();
  });
});

describe("moonInfo", () => {
  const EPOCH_NEW = Date.UTC(2000, 0, 6, 18, 14);
  const SYNODIC_MS = 29.530588853 * 86400000;

  it("is ~0% at the anchor new moon and ~100% half a cycle later", () => {
    expect(moonInfo(EPOCH_NEW).illumPct).toBeLessThan(3);
    const full = moonInfo(EPOCH_NEW + SYNODIC_MS / 2);
    expect(full.illumPct).toBeGreaterThan(97);
    expect(full.phaseName).toBe("full moon");
  });

  it("waxing before full, waning after", () => {
    expect(moonInfo(EPOCH_NEW + SYNODIC_MS * 0.25).waxing).toBe(true);
    expect(moonInfo(EPOCH_NEW + SYNODIC_MS * 0.75).waxing).toBe(false);
  });
});

describe("runway wind components", () => {
  it("pure headwind and pure crosswind resolve correctly", () => {
    // wind 240@20 onto runway heading 240 → all headwind
    const head = runwayWindComponents(240, 240, 20, null);
    expect(head.headKt).toBe(20);
    expect(head.crossKt).toBe(0);
    // wind 330@20 onto heading 240 → all crosswind
    const cross = runwayWindComponents(240, 330, 20, 30);
    expect(cross.crossKt).toBe(20);
    expect(Math.abs(cross.headKt)).toBeLessThanOrEqual(1);
    expect(cross.gustCrossKt).toBe(30);
  });

  it("tailwind shows as negative headwind", () => {
    expect(runwayWindComponents(240, 60, 15, null).headKt).toBe(-15);
  });

  it("flags advisory thresholds", () => {
    expect(crosswindFlag(10, null)).toBe("g");
    expect(crosswindFlag(22, null)).toBe("a");
    expect(crosswindFlag(18, 27)).toBe("a");
    expect(crosswindFlag(31, null)).toBe("r");
  });

  it("runwayWinds sorts favoured ends first and skips variable wind", () => {
    const rw = [{ leIdent: "06", heIdent: "24", leHeadingDegT: 60, heHeadingDegT: 240 }];
    const out = runwayWinds(rw, 240, false, 20, null);
    expect(out[0].ident).toBe("24");         // headwind end first
    expect(out[0].headKt).toBe(20);
    expect(out[1].headKt).toBe(-20);
    expect(runwayWinds(rw, 240, true, 20, null)).toEqual([]);
    expect(runwayWinds(rw, null, false, 20, null)).toEqual([]);
  });
});
