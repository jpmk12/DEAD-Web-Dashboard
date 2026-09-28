import { describe, it, expect } from "vitest";
import {
  readInterdiction, gradeModality, hasPhrase, haversineKm, eventsNear, readActivity,
  DEFAULT_RADIUS_KM, EVENT_WINDOW_DAYS,
} from "../lib/chokepointSignals";
import type { GeoEvent, ChokepointText } from "../lib/chokepointSignals";

const TODAY = "2026-09-28";
const HORMUZ = { lat: 26.57, lon: 56.25 };
const BAB = { lat: 12.58, lon: 43.33 };

const ago = (days: number): string =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

const ev = (over: Partial<GeoEvent> = {}): GeoEvent => ({
  id: "e1", lat: 12.7, lon: 43.5, title: "Attack on merchant vessel", date: ago(3), ...over,
});

const txt = (title: string, over: Partial<ChokepointText> = {}): ChokepointText =>
  ({ title, pubDate: new Date(Date.parse(`${TODAY}T00:00:00Z`) - 86_400_000).toISOString(), ...over });

describe("gradeModality — the op-ed problem", () => {
  it("treats a plain report as an act", () => {
    expect(gradeModality("Missile struck a tanker south of Hormuz")).toBe("act");
  });

  it("demotes a hypothetical to analysis", () => {
    // An op-ed and a strike report share every keyword. What separates them is
    // mood, not topic.
    expect(gradeModality("How Iran could close the strait")).toBe("analysis");
    expect(gradeModality("Analysts warn of risk of closure")).toBe("analysis");
    expect(gradeModality("If attacked, Tehran were to respond")).toBe("threat");
  });

  it("ranks a declared intent as a threat, not analysis", () => {
    // "Iran threatens to close the strait, analysts say" is a declaration being
    // reported — the declaration is the signal.
    expect(gradeModality("Iran threatens to close the strait, analysts say")).toBe("threat");
  });
});

describe("readInterdiction", () => {
  it("earns nothing from a bare mention of the place", () => {
    // This is the whole point: the old scorer counted this as activity.
    expect(readInterdiction("Shipping through the Strait of Hormuz rose in August")).toBeNull();
    expect(readInterdiction("A guide to the Red Sea")).toBeNull();
  });

  it("classifies and weights an act", () => {
    const r = readInterdiction("Tanker struck a tanker? no — missile struck the vessel overnight")!;
    expect(r.modality).toBe("act");
    expect(r.weight).toBeGreaterThan(50);
  });

  it("scores a threatened closure well below an actual one", () => {
    const act = readInterdiction("Tehran closed the strait to all traffic")!;
    const threat = readInterdiction("Tehran threatens to close the strait")!;
    expect(act.cls).toBe("closure");
    expect(threat.cls).toBe("closure");
    expect(threat.weight).toBeLessThan(act.weight);
    expect(threat.weight).toBeGreaterThan(0);   // a declaration is still a signal
  });

  it("scores commentary near zero without discarding it", () => {
    const r = readInterdiction("Why the blockade scenario could reshape the Gulf")!;
    expect(r.modality).toBe("analysis");
    expect(r.weight).toBeLessThan(15);
  });

  it("picks the strongest class present", () => {
    const r = readInterdiction("Naval escort announced after mines were found in the strait")!;
    expect(r.cls).toBe("mining");     // outranks escort
  });

  it("is phrase-based, so generic words do not fire", () => {
    expect(readInterdiction("Port closed for maintenance")).toBeNull();
    expect(readInterdiction("Attack ads dominate the shipping conference")).toBeNull();
  });

  it("detects rerouting — the economic effect landing", () => {
    const r = readInterdiction("Maersk is avoiding the Red Sea and diverting vessels")!;
    expect(r.cls).toBe("rerouting");
    expect(r.modality).toBe("act");
  });
});

describe("haversineKm", () => {
  it("is zero at the same point and sane across a known gap", () => {
    expect(haversineKm(26.57, 56.25, 26.57, 56.25)).toBe(0);
    // Hormuz → Bab-el-Mandeb is roughly 2,000 km.
    const d = haversineKm(HORMUZ.lat, HORMUZ.lon, BAB.lat, BAB.lon);
    expect(d).toBeGreaterThan(1800);
    expect(d).toBeLessThan(2300);
  });
});

describe("eventsNear", () => {
  it("joins an event hundreds of km out, which is where these attacks land", () => {
    const r = eventsNear(BAB, [ev()], TODAY);
    expect(r).toHaveLength(1);
    expect(r[0].distanceKm).toBeLessThan(DEFAULT_RADIUS_KM);
    expect(r[0].ageDays).toBe(3);
  });

  it("excludes events beyond the radius", () => {
    expect(eventsNear(BAB, [ev({ lat: HORMUZ.lat, lon: HORMUZ.lon })], TODAY)).toEqual([]);
  });

  it("honours a per-point radius override", () => {
    // Panama does not want a 300 km net.
    expect(eventsNear({ ...BAB, radiusKm: 20 }, [ev()], TODAY)).toEqual([]);
  });

  it("drops null island rather than treating it as a location", () => {
    expect(eventsNear(BAB, [ev({ lat: 0, lon: 0 })], TODAY)).toEqual([]);
  });

  it("keeps an undated event but reports a null age instead of guessing one", () => {
    const r = eventsNear(BAB, [ev({ date: undefined })], TODAY);
    expect(r).toHaveLength(1);
    expect(r[0].ageDays).toBeNull();
  });

  it("excludes events outside the window and impossible future dates", () => {
    expect(eventsNear(BAB, [ev({ date: ago(EVENT_WINDOW_DAYS + 5) })], TODAY)).toEqual([]);
    expect(eventsNear(BAB, [ev({ date: ago(-10) })], TODAY)).toEqual([]);
  });

  it("orders newest then nearest", () => {
    const r = eventsNear(BAB, [
      ev({ id: "old", date: ago(20) }),
      ev({ id: "new-far", date: ago(1), lat: 14.5, lon: 45.0 }),
      ev({ id: "new-near", date: ago(1), lat: 12.6, lon: 43.4 }),
    ], TODAY);
    expect(r.map((x) => x.id)).toEqual(["new-near", "new-far", "old"]);
  });
});

describe("readActivity", () => {
  it("scores an op-ed-only chokepoint far below one with a real incident", () => {
    const oped = readActivity(BAB, [txt("Why the Red Sea blockade scenario could reshape trade")], [], TODAY);
    const real = readActivity(BAB, [txt("Missile struck a vessel off the coast")], [ev()], TODAY);
    expect(oped.score).toBeLessThan(20);
    expect(real.score).toBeGreaterThan(60);
    expect(oped.line).toMatch(/analysis .* only/);
  });

  it("counts modalities separately so the line can say what kind of activity it is", () => {
    const r = readActivity(BAB, [
      txt("Missile struck a vessel"),
      txt("Houthis threaten to close the strait"),
      // Must contain an interdiction phrase to count at all — analysis that
      // never discusses an act is not chokepoint activity, it is background.
      txt("Analysts say Tehran may blockade the strait"),
    ], [], TODAY);
    expect(r.acts).toBe(1);
    expect(r.threats).toBe(1);
    expect(r.analysis).toBe(1);
    expect(r.line).toMatch(/1 reported act · 1 declared threat/);
  });

  it("ignores analysis that never names an act", () => {
    const r = readActivity(BAB, [txt("Analysts may see escalation in the region")], [], TODAY);
    expect(r.analysis).toBe(0);
    expect(r.score).toBe(0);
  });

  it("is silent when nothing interdiction-shaped is said", () => {
    const r = readActivity(BAB, [txt("Shipping volumes rose in August")], [], TODAY);
    expect(r.score).toBe(0);
    expect(r.line).toBeNull();
    expect(r.lead).toBeNull();
  });

  it("lets events alone carry a score with no news at all", () => {
    // The georeferenced incident IS the evidence; nobody has to write about it.
    const r = readActivity(BAB, [], [ev()], TODAY);
    expect(r.score).toBeGreaterThan(40);
    expect(r.events).toHaveLength(1);
  });

  it("gives events diminishing returns — twenty incidents is not twenty times one", () => {
    const one = readActivity(BAB, [], [ev()], TODAY).score;
    const many = readActivity(BAB, [], Array.from({ length: 20 }, (_, i) => ev({ id: `e${i}` })), TODAY).score;
    expect(many).toBeGreaterThan(one);
    expect(many).toBeLessThanOrEqual(100);
  });

  it("discounts stale text", () => {
    const fresh = readActivity(BAB, [txt("Missile struck a vessel")], [], TODAY).score;
    const stale = readActivity(BAB, [txt("Missile struck a vessel", {
      pubDate: new Date(Date.parse(`${TODAY}T00:00:00Z`) - 40 * 86_400_000).toISOString(),
    })], [], TODAY).score;
    expect(stale).toBeLessThan(fresh);
  });

  it("caps at 100", () => {
    const r = readActivity(BAB, Array.from({ length: 30 }, () => txt("Tehran closed the strait; mines were found")),
      Array.from({ length: 30 }, (_, i) => ev({ id: `e${i}` })), TODAY);
    expect(r.score).toBe(100);
  });
});
