import { describe, it, expect } from "vitest";
import { renderSitrepHtml, esc } from "../lib/sitrepExport";
import type { SitrepPayload } from "../lib/sitrep";

const NOW = Date.UTC(2026, 6, 6, 14, 0);
const iso = (ms: number) => new Date(ms).toISOString();

function fakePayload(overrides: Partial<SitrepPayload> = {}): SitrepPayload {
  return {
    base: { icao: "KWRI", label: "JB McGuire-Dix-Lakehurst", lat: 40.0155, lon: -74.5917, country: "United States", place: "McGuire AFB New Jersey", artcc: "ZNY" },
    generatedAt: iso(NOW),
    status: { wx: "g", ops: "a", threat: "g", infra: "g" },
    weather: {
      live: true,
      now: { icao: "KWRI", flightCategory: "VFR", windKt: 12, gustKt: null, visMi: 10, ceilingFt: null } as SitrepPayload["weather"]["now"],
      metarRaw: "KWRI 061355Z 24012KT 10SM FEW060 29/17 A3002",
      tafWorst: { worst: "MVFR", fromISO: iso(NOW + 4 * 3600_000) } as SitrepPayload["weather"]["tafWorst"],
      tafSegments: [
        { cat: "VFR", fromMs: NOW, toMs: NOW + 8 * 3600_000, label: "14Z" },
        { cat: "IFR", fromMs: NOW + 8 * 3600_000, toMs: NOW + 16 * 3600_000, label: "22Z" },
      ],
      alerts: [{ event: "Severe Thunderstorm Watch", severity: "Severe", lifeThreatening: false, headline: "storms possible <script>alert(1)</script>" }],
      current: null,
      outlook: [{ date: "2026-07-06", hiF: 91, loF: 68, precipPct: 20, windMph: 14 }],
      windDirDeg: 240,
      windVariable: false,
    },
    astro: {
      sunriseZ: iso(NOW - 5 * 3600_000), sunsetZ: iso(NOW + 10 * 3600_000),
      civilDawnZ: iso(NOW - 5.5 * 3600_000), civilDuskZ: iso(NOW + 10.5 * 3600_000),
      moon: { illumPct: 68, phaseName: "waxing gibbous", waxing: true },
    },
    ops: {
      configured: true, live: true, notamCount: 2,
      groups: [{
        key: "runway", label: "Runway / surface",
        items: [
          { category: "taxiway", rank: 1, text: "TWY A CLSD <img src=x onerror=alert(1)>", amber: true, start: iso(NOW - 3600_000), end: iso(NOW + 6 * 3600_000) },
          { category: "navaid", rank: 2, text: "ILS RWY 24 U/S", amber: false, start: iso(NOW + 12 * 3600_000), end: iso(NOW + 23 * 3600_000) },
        ],
      }],
      limiting: true, fieldClosed: false,
      capability: { lengthFt: 13123, surface: "asph", cls: "C-17" } as SitrepPayload["ops"]["capability"],
      center: { code: "ZNY", live: true, count: 2, items: [] },
      runwayWinds: [{ ident: "24", headingDegT: 240, headKt: 12, crossKt: 0, gustCrossKt: null, flag: "g" }],
      fuel: { live: true, items: [] },
    },
    history: [],
    infra: {
      internet: { live: true, entity: "New Jersey", led: "g", series: [{ datasource: "bgp", label: "BGP routes", latest: 100, baseline: 100, dropPct: 0 }] },
      water: { live: true, gauges: [] },
      nas: { live: true, updated: null, counts: { groundStops: 4, groundDelays: 2, closures: 0, delays: 1 }, nearby: [] },
      powerNews: [], waterNews: [], commsNews: [],
    },
    threats: { fp: { composite: "green", topDriver: "no elevated drivers", axes: [] }, disasters: [], news: [], newsScanned: 41 },
    mission: { state: "fmc", functions: [{ key: "launch_recovery", label: "Launch & Recovery", capability: "fmc", driver: "VFR; runway open", window: null, limfacIds: [] }], limfacs: [], ccir: [] },
    ...overrides,
  } as SitrepPayload;
}

describe("renderSitrepHtml", () => {
  const html = renderSitrepHtml(fakePayload(), { bluf: ["Field supports ops <b>today</b>"], watch: ["18Z TAF amendment"] });

  it("is a complete, script-free, self-contained document", () => {
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("</html>");
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).not.toMatch(/src="https?:/);       // no external resources
    expect(html).not.toMatch(/href="https?:/);
  });

  it("carries the snapshot stamp, base identity, and all four cards", () => {
    expect(html).toContain("SNAPSHOT AS OF 2026-07-06 14:00Z — NOT LIVE");
    expect(html).toContain("KWRI · JB McGuire-Dix-Lakehurst");
    for (const s of ["Weather", "Ops / Airfield", "Threats", "Infrastructure"]) expect(html).toContain(`<h2>${s}</h2>`);
  });

  it("escapes hostile NOTAM / alert / BLUF content", () => {
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Field supports ops &lt;b&gt;today&lt;/b&gt;");
  });

  it("renders the TAF bar, closure timeline, and window conflict", () => {
    expect(html).toContain(">VFR<");
    expect(html).toContain(">IFR<");
    expect(html).toContain("Closure windows");
    expect(html).toContain("TWY A");
    expect(html).toContain("ILS RWY 24");
    // ILS U/S (12h→23h) overlaps the IFR segment (8h→16h)... but conflicts
    // require kind=closure on a RWY/Airfield row — TWY A closure vs IFR does
    // NOT conflict (taxiway), so no conflict box here.
    expect(html).not.toContain("Window conflict");
  });

  it("flags a runway closure × IFR overlap as a conflict", () => {
    const p = fakePayload();
    p.ops.groups[0].items[0] = { category: "runway", rank: 0, text: "RWY 06/24 CLSD", amber: true, start: iso(NOW + 7 * 3600_000), end: iso(NOW + 12 * 3600_000) } as typeof p.ops.groups[0]["items"][0];
    const h = renderSitrepHtml(p, null);
    expect(h).toContain("Window conflict");
    expect(h).toContain("RWY 06/24 closure");
  });

  it("keeps UNKNOWN discipline when sources are dead", () => {
    const p = fakePayload();
    p.ops.configured = false;
    p.infra.internet = { live: false, entity: null, led: "u", series: [] };
    p.infra.nas = null;
    p.threats.fp = null;
    const h = renderSitrepHtml(p, null);
    expect(h).toContain("DAIP NOTAM feed unreachable");
    expect(h).toContain("IODA unreachable — UNKNOWN");
    expect(h).toContain("Force Protection assessment unavailable");
    expect(h).not.toContain("all clear");
  });
});

describe("esc", () => {
  it("escapes the five HTML metacharacters", () => {
    expect(esc(`<a href="x" onclick='y'>&`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;");
  });
});
