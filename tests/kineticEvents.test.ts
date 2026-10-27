import { describe, it, expect } from "vitest";
import { readKinetic, placeEvent, countryInTitle, kineticEvents, kineticGeoEvents, countKineticInAoi, kineticInCountry } from "../lib/kineticEvents";
import { conflictWithCaptures, CAPTURE_WATCH_AT } from "../lib/warningRules";
import { parseEventsCapture, coordsOf } from "../lib/eventCapture";
import type { StoredEventDraft } from "../lib/eventCapture";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const ev = (title: string, o: Partial<StoredEventDraft> = {}): StoredEventDraft => ({
  id: o.id ?? `ev_${title.length}_${title.slice(0, 8)}`, url: o.url ?? "https://iran.liveuamap.com/en/2026/27-october-x", title,
  sourceUrl: null, publishedAt: o.publishedAt ?? "2026-10-27T03:00:00Z", source: o.source ?? "iran", capturedAt: "2026-10-27T09:00:00Z",
  lat: o.lat ?? null, lon: o.lon ?? null,
});

describe("readKinetic — a kinetic ACT by phrase, graded by the shared modality grammar", () => {
  it("files strikes, incoming fire, explosions, shelling, clashes and drone attacks", () => {
    expect(readKinetic("Israeli airstrike on Khan Younis kills 4")?.cls).toBe("strike");
    expect(readKinetic("Sirens sounding in Eilat; missile intercepted over the Red Sea")?.cls).toBe("incoming");
    expect(readKinetic("Explosions reported in Isfahan near the air base")?.cls).toBe("explosion");
    expect(readKinetic("Artillery shelling of villages near Deir ez-Zor overnight")?.cls).toBe("shelling");
    expect(readKinetic("Clashes between SDF and tribal fighters east of the Euphrates")?.cls).toBe("clash");
    expect(readKinetic("Drone attack on Erbil airport, no casualties")?.cls).toBe("drone");
    expect(readKinetic("Drone strike hits fuel depot")?.cls).toBe("strike");   // a strike first
  });
  it("earns nothing for a mention, a threat, an analysis piece or a reversal", () => {
    expect(readKinetic("Iranian foreign minister meets Omani counterpart in Muscat")).toBeNull();
    expect(readKinetic("IRGC threatens to strike US bases if attacked")).toBeNull();
    expect(readKinetic("Why the next airstrike could come from the sea — analysis")).toBeNull();
    expect(readKinetic("Airspace reopened after last night's explosions")).toBeNull();
    expect(readKinetic("")).toBeNull();
  });
});

describe("placeEvent — reported coordinates, else the named country, else the region's single country, else nothing", () => {
  it("prefers reported coordinates and still names the country", () => {
    const p = placeEvent(ev("Explosions reported in Isfahan", { lat: 32.65, lon: 51.67 }))!;
    expect(p.placement).toBe("reported");
    expect(p.lat).toBeCloseTo(32.65, 2);
    expect(p.country).toBe("Iran");
  });
  it("places an unplaced title at the centroid of the country it names — longest form wins", () => {
    expect(countryInTitle("Shelling reported near Juba, South Sudan")).toBe("South Sudan");
    expect(countryInTitle("Hodeidah port hit by airstrikes")).toBe("Yemen");
    const p = placeEvent(ev("Houthi missile intercepted over the Red Sea", { source: "israelpalestine" }))!;
    expect(p.placement).toBe("country");
    expect(p.country).toBe("Yemen");
  });
  it("uses the region page only when it covers ONE country; a multi-country page with no country named stays unplaced", () => {
    expect(placeEvent(ev("Explosions heard near the airport", { source: "iran" }))?.country).toBe("Iran");
    expect(placeEvent(ev("Explosions heard near the airport", { source: "isis" }))).toBeNull();
    expect(placeEvent(ev("Explosions heard near the airport", { source: "israelpalestine" }))).toBeNull();
    expect(placeEvent(ev("Explosions heard near the airport", { source: "zzz" }))).toBeNull();
  });
});

describe("kineticEvents / consumers", () => {
  const events = [
    ev("Explosions reported in Isfahan", { id: "a", lat: 32.65, lon: 51.67 }),
    ev("Drone attack on Erbil airport", { id: "b", source: "isis", publishedAt: "2026-10-26T20:00:00Z" }),
    ev("Minister visits Tehran for talks", { id: "c" }),
    ev("Airstrike on Sanaa", { id: "d", source: "yemen", publishedAt: "2026-09-01T00:00:00Z" }),   // out of window
    ev("Clashes in the old city", { id: "e", source: "isis" }),                                      // unplaced
  ];
  it("keeps placed kinetic acts inside the window, newest first", () => {
    const ks = kineticEvents(events, NOW);
    expect(ks.map((k) => k.id)).toEqual(["a", "b"]);
    expect(ks[1].placement).toBe("country");
    expect(ks[1].country).toBe("Iraq");
  });
  it("hands the chokepoint reads only REPORTED positions by default, and says so on a country placement when asked", () => {
    const ks = kineticEvents(events, NOW);
    expect(kineticGeoEvents(ks).map((g) => g.id)).toEqual(["cap-a"]);
    const all = kineticGeoEvents(ks, { reportedOnly: false });
    expect(all).toHaveLength(2);
    expect(all[1].title).toMatch(/placed at Iraq — no position in the capture/);
    expect(all[0].source).toBe("LiveUAMap");
  });
  it("counts events in an AOI by bbox for a reported position and by country for a placement", () => {
    const ks = kineticEvents(events, NOW);
    const gulf = { bbox: { latMin: 12, latMax: 40, lonMin: 34, lonMax: 64 }, countries: ["Iran", "Iraq"] };
    expect(countKineticInAoi(ks, gulf)).toBe(2);
    expect(countKineticInAoi(ks, { ...gulf, countries: ["Iran"] })).toBe(1);
    expect(countKineticInAoi(ks, { bbox: { latMin: 0, latMax: 10, lonMin: 0, lonMax: 10 }, countries: [] })).toBe(0);
    expect(kineticInCountry(ks, "iraq").map((k) => k.id)).toEqual(["b"]);
  });
});

describe("conflictWithCaptures — own capture caps at watching, a dead feed plus captures is not calm", () => {
  it("leaves a live elevated feed's state alone and adds confidence at the corroboration floor", () => {
    const r = conflictWithCaptures({ state: "active", confidence: 0.85, live: true }, 7);
    expect(r.state).toBe("active");
    expect(r.confidence).toBeCloseTo(0.9, 5);
    expect(r.note).toMatch(/7 captured kinetic events.*corroborate/);
    expect(conflictWithCaptures({ state: "active", confidence: 0.85, live: true }, 2).confidence).toBe(0.85);
  });
  it("lifts a live DORMANT feed to watching at the floor, never higher; below it a note only", () => {
    const up = conflictWithCaptures({ state: "dormant", confidence: 0, live: true }, CAPTURE_WATCH_AT);
    expect(up.state).toBe("watching");
    expect(up.confidence).toBe(0.4);
    expect(up.note).toMatch(/own capture only, caps at watching/);
    const low = conflictWithCaptures({ state: "dormant", confidence: 0, live: true }, CAPTURE_WATCH_AT - 1);
    expect(low.state).toBe("dormant");
    expect(low.note).toMatch(/below the 5-event floor/);
    expect(conflictWithCaptures({ state: "dormant", confidence: 0, live: true }, 0).note).toBe("");
  });
  it("a dead feed: captures at the floor earn watching at lower confidence and the note names the outage", () => {
    const r = conflictWithCaptures({ state: "dormant", confidence: 0, live: false }, 9);
    expect(r.state).toBe("watching");
    expect(r.confidence).toBe(0.35);
    expect(r.note).toMatch(/structured conflict feeds unreachable/);
    expect(conflictWithCaptures({ state: "dormant", confidence: 0, live: false }, 1).state).toBe("dormant");
  });
});

describe("eventCapture coordinates", () => {
  it("accepts lat/lng in the common spellings, in range, never the 0/0 placeholder", () => {
    expect(coordsOf({ lat: "32.65", lng: "51.67" })).toEqual({ lat: 32.65, lon: 51.67 });
    expect(coordsOf({ latitude: 1, longitude: 2 })).toEqual({ lat: 1, lon: 2 });
    expect(coordsOf({ lat: 0, lng: 0 })).toEqual({ lat: null, lon: null });
    expect(coordsOf({ lat: 95, lng: 10 })).toEqual({ lat: null, lon: null });
    expect(coordsOf({ lat: "x", lng: 10 })).toEqual({ lat: null, lon: null });
    expect(coordsOf({})).toEqual({ lat: null, lon: null });
  });
  it("a capture item carries its coordinates through the parser; one without reads null", () => {
    const r = parseEventsCapture(JSON.stringify({ format: "dead-events", version: 1, capturedAt: "2026-10-27T09:00:00Z", source: { kind: "liveuamap", label: "iran" }, items: [
      { url: "https://iran.liveuamap.com/en/2026/27-october-a", title: "Explosions reported in Isfahan near the air base", time: "2026-10-27T03:00:00Z", lat: "32.65", lng: "51.67" },
      { url: "https://iran.liveuamap.com/en/2026/27-october-b", title: "Explosions reported in Shiraz near the air base", time: "2026-10-27T03:00:00Z" },
    ] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events[0].lat).toBeCloseTo(32.65, 4);
    expect(r.events[0].lon).toBeCloseTo(51.67, 4);
    expect(r.events[1].lat).toBeNull();
  });
});
