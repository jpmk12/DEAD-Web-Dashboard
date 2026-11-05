import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  featureAor, countryPostures, postureFor, countryStyle, commandTags, roughCentroid,
  COMMAND_HUE, type CountryFeatureProps,
} from "@/lib/commandOverlay";
import type { CommandRow } from "@/lib/commandBoard";

const fc = JSON.parse(readFileSync(path.resolve(__dirname, "../public/geo/countries-110m.json"), "utf8")) as {
  features: { properties: CountryFeatureProps; geometry: { type: string; coordinates: unknown } }[];
};
const feat = (a3: string) => fc.features.find((f) => f.properties.a3 === a3)!;
const aorOf = (a3: string) => featureAor(feat(a3).properties, roughCentroid(feat(a3).geometry));

describe("every country lands in a command", () => {
  it("only Antarctica is unassigned, and by country — never by latitude", () => {
    const unassigned = fc.features.filter((f) => featureAor(f.properties) === "UNKNOWN").map((f) => f.properties.name);
    expect(unassigned).toEqual(["Antarctica"]);
  });
  it("the UCP seams the coordinate bands get wrong", () => {
    expect(aorOf("IRQ")).toBe("CENTCOM");   // Erbil is above 36°N
    expect(aorOf("SYR")).toBe("CENTCOM");
    expect(aorOf("TUR")).toBe("EUCOM");
    expect(aorOf("ISR")).toBe("CENTCOM");
    expect(aorOf("EGY")).toBe("CENTCOM");
    expect(aorOf("LBY")).toBe("AFRICOM");
    expect(aorOf("PRI")).toBe("NORTHCOM");  // Puerto Rico, not SOUTHCOM
    expect(aorOf("CUB")).toBe("SOUTHCOM");
    expect(aorOf("GRL")).toBe("NORTHCOM");
    expect(aorOf("RUS")).toBe("EUCOM");
    expect(aorOf("PAK")).toBe("CENTCOM");
    expect(aorOf("IND")).toBe("INDOPACOM");
  });
  it("Northern Cyprus and Somaliland (no ISO3) go by name, not by centroid", () => {
    const n = fc.features.filter((f) => f.properties.a3 === "-99");
    expect(n.length).toBeGreaterThan(0);
    for (const f of n) expect(featureAor(f.properties)).not.toBe("UNKNOWN");
    expect(featureAor({ name: "N. Cyprus", admin: "Northern Cyprus", a2: "-99", a3: "-99" })).toBe("EUCOM");
  });
});

describe("posture per country", () => {
  const rows = [
    { kind: "country", label: "Jordan", country: "Jordan", composite: "amber" as const },
    { kind: "base", label: "Muwaffaq Salti AB", country: "JO", composite: "red" as const },
    { kind: "base", label: "Ramstein", country: "Germany", composite: "green" as const },
    { kind: "country", label: "Iraq", composite: "unknown" as const },
  ];
  const m = countryPostures(rows);
  it("worst of the country row and its bases; ISO2 joins the name", () => {
    expect(m.get("jordan")).toBe("red");
    expect(m.get("germany")).toBe("green");
    expect(m.get("iraq")).toBe("unknown");
  });
  it("a country nobody watches has no posture — never green", () => {
    expect(postureFor(feat("SAU").properties, m)).toBeNull();
    expect(postureFor(feat("JOR").properties, m)).toBe("red");
  });
});

describe("styles", () => {
  it("unwatched = faint command wash, dashed; watched = the posture tint", () => {
    const s = countryStyle("CENTCOM", null, "ALL");
    expect(s.fillColor).toBe(COMMAND_HUE.CENTCOM);
    expect(s.fillOpacity).toBeLessThan(0.1);
    expect(s.dashArray).toBeTruthy();
    expect(countryStyle("CENTCOM", "red", "ALL").fillColor).toBe("#ef4444");
  });
  it("a command out of focus dims", () => {
    const on = countryStyle("EUCOM", "amber", "EUCOM"), off = countryStyle("EUCOM", "amber", "CENTCOM");
    expect(off.fillOpacity).toBeLessThan(on.fillOpacity);
  });
  it("Antarctica draws no wash", () => {
    expect(countryStyle("UNKNOWN", null, "ALL").fillOpacity).toBe(0);
  });
});

describe("command tags", () => {
  const row = (over: Partial<CommandRow>): CommandRow => ({
    aor: "CENTCOM", label: "USCENTCOM", star: false, iw: null,
    posture: { red: 0, amber: 0, green: 0, unknown: 0, escalated: 0, worst: null, watched: 0 },
    bases: { count: 0, red: 0, amber: 0, worse: 0, worst: null }, demand: null,
    events: { total: 0, kinetic: 0, neo: 0, disaster: 0, fresh: 0 }, delta: { worse: 0, better: 0, fresh: 0 },
    alerts: 0, why: "", quiet: true, score: 0, ...over,
  });
  it("names the board, the posture and the demand arrow from the board's own row", () => {
    const [t] = commandTags([row({
      iw: { level: "warning", anomaly: 0.4, trajectory: "deteriorating", boards: 1, learning: false, worstLabel: "Iran" },
      posture: { red: 1, amber: 2, green: 3, unknown: 0, escalated: 0, worst: "red", watched: 6 },
      demand: { aor: "CENTCOM", direction: "rise", score: 30, confidence: "medium", line: "" },
    })]);
    expect(t.label).toBe("CENTCOM");
    expect(t.iw).toBe("I&W WARNING");
    expect(t.posture).toBe("1 red");
    expect(t.demand).toBe("demand ↑");
    expect(t.tone).toBe("red");
  });
  it("nothing watched says so; no board says so; tone stays slate", () => {
    const [t] = commandTags([row({ aor: "AFRICOM", label: "USAFRICOM" })]);
    expect(t.iw).toBe("no board");
    expect(t.posture).toBe("nothing watched");
    expect(t.demand).toBe("demand —");
    expect(t.tone).toBe("slate");
  });
  it("all watched rows UNKNOWN reads unknown, not calm", () => {
    const [t] = commandTags([row({ posture: { red: 0, amber: 0, green: 0, unknown: 3, escalated: 0, worst: "unknown", watched: 3 } })]);
    expect(t.tone).toBe("unknown");
  });
  it("UNKNOWN rows get no tag", () => {
    expect(commandTags([row({ aor: "UNKNOWN" })])).toEqual([]);
  });
});
