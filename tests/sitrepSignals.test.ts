import { describe, it, expect } from "vitest";
import { groupNotams, impactMatches, filterImpactNews, tafTimeline, wxLed, opsLed, threatLed } from "../lib/sitrepSignals";
import type { TafPeriod } from "../lib/types";

describe("groupNotams", () => {
  const notams = [
    { category: "runway", rank: 1, text: "RWY 06/24 CLSD 0300-0900Z DAILY", runwaysClosed: ["06/24"] },
    { category: "taxiway", rank: 5, text: "TWY C CLSD BTN TWY B AND APRON" },
    { category: "navaid", rank: 3, text: "ILS RWY 18L U/S" },
    { category: "services", rank: 6, text: "TWR OPR HR 1100-0500Z" },
    { category: "airspace", rank: 4, text: "TFR VIP MOVEMENT 24NM SE" },
  ];

  it("buckets by display group in fixed order, amber runway closures first", () => {
    const { groups, limiting, fieldClosed } = groupNotams(notams);
    expect(groups.map((g) => g.key)).toEqual(["runway", "navaid", "hours", "airspace"]);
    const rwy = groups[0];
    expect(rwy.items[0].amber).toBe(true);        // closure sorts first
    expect(rwy.items[0].text).toContain("RWY 06/24");
    expect(limiting).toBe(true);                  // runway closure = limiting
    expect(fieldClosed).toBe(false);
  });

  it("flags aerodrome closure as fieldClosed", () => {
    const { fieldClosed, limiting } = groupNotams([{ category: "other", rank: 1, text: "AD CLSD DUE TO SNOW" }]);
    expect(fieldClosed).toBe(true);
    expect(limiting).toBe(true);
  });

  it("no notams → no groups, not limiting", () => {
    const r = groupNotams([]);
    expect(r.groups).toEqual([]);
    expect(r.limiting).toBe(false);
  });
});

describe("impactMatches / filterImpactNews", () => {
  it("matches impact vocabulary with word bounds", () => {
    expect(impactMatches("JCP&L power outage hits Burlington County")).toContain("power outage");
    expect(impactMatches("Protest planned at main gate Saturday")).toEqual(expect.arrayContaining(["protest", "gate"]));
    expect(impactMatches("Delegate meets governor")).toEqual([]); // "gate" inside "Delegate" must not match
    // Regression: a failed first occurrence must not mask a later valid one.
    expect(impactMatches("Delegate speaks as gate closed for repairs")).toEqual(expect.arrayContaining(["gate", "closed"]));
  });

  it("filters items and carries the matched terms", () => {
    const out = filterImpactNews([
      { title: "Boil water advisory issued for base housing" },
      { title: "High school wins championship" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].matched).toContain("boil water");
  });
});

describe("tafTimeline", () => {
  const T0 = Date.UTC(2026, 6, 5, 12, 0, 0);
  const hr = 3600_000;
  const P = (fromH: number, toH: number, cat: TafPeriod["flightCategory"], changeType = ""): TafPeriod => ({
    from: new Date(T0 + fromH * hr).toISOString(),
    to: new Date(T0 + toH * hr).toISOString(),
    changeType,
    flightCategory: cat,
    summary: "",
  });

  it("clips to the 24h window and merges consecutive same-category periods", () => {
    const segs = tafTimeline([P(-2, 4, "VFR"), P(4, 8, "VFR"), P(8, 14, "IFR"), P(14, 40, "MVFR")], T0, 24);
    expect(segs.map((s) => s.cat)).toEqual(["VFR", "IFR", "MVFR"]);
    expect(segs[0].fromMs).toBe(T0);                    // clipped to now
    expect(segs[2].toMs).toBe(T0 + 24 * hr);            // clipped to horizon
    expect(segs[0].label).toBe("12Z");
  });

  it("folds TEMPO overlays by taking the worse category", () => {
    const segs = tafTimeline([P(0, 12, "VFR"), P(2, 5, "IFR", "TEMPO")], T0, 24);
    expect(segs.some((s) => s.cat === "IFR")).toBe(true);
  });

  it("returns empty with no usable base periods", () => {
    expect(tafTimeline([], T0)).toEqual([]);
    expect(tafTimeline([P(1, 3, "IFR", "TEMPO")], T0)).toEqual([]);
  });
});

describe("status LEDs", () => {
  it("wxLed escalates on current LIFR, severe alerts, and forecast IFR", () => {
    expect(wxLed("VFR", "VFR", 0, false)).toBe("g");
    expect(wxLed("VFR", "IFR", 0, false)).toBe("a");
    expect(wxLed("VFR", "VFR", 1, false)).toBe("a");
    expect(wxLed("LIFR", null, 0, false)).toBe("r");
    expect(wxLed("VFR", null, 2, true)).toBe("r");
    expect(wxLed(null, null, 0, false)).toBe("u");
  });

  it("opsLed reflects DAIP availability and limiting NOTAMs", () => {
    expect(opsLed(true, true, false, false)).toBe("g");
    expect(opsLed(true, true, true, false)).toBe("a");
    expect(opsLed(true, true, true, true)).toBe("r");
    expect(opsLed(false, false, false, false)).toBe("u");
  });

  it("threatLed maps FP composite", () => {
    expect(threatLed("green")).toBe("g");
    expect(threatLed("amber")).toBe("a");
    expect(threatLed("red")).toBe("r");
    expect(threatLed(null)).toBe("u");
  });
});
