import { describe, it, expect } from "vitest";
import { readLine, lineReadLines, type LineFieldInput, type LineReadInput } from "../lib/lineRead";

const TODAY = "2026-10-27";
const line = (over: Partial<LineReadInput["line"]> = {}): LineReadInput["line"] => ({ id: "l1", day: TODAY, airframe: "C-17", fields: ["OJAQ", "OTBH"], status: "planned", ...over });
const all = { sitrep: true, posture: true, taf: true, cap: true };
const green = { wx: "g", ops: "g", threat: "g", infra: "g", spectrum: "g" } as const;
const field = (icao: string, over: Partial<LineFieldInput> = {}): LineFieldInput => ({
  icao, sitrepSlot: true,
  sitrep: { status: { ...green }, driver: "all green", worse: [], closure: { now: false, next: null, indeterminate: false } },
  posture: { composite: "green", topDriver: "quiet", country: "Jordan", via: "base" },
  taf: { worst: "VFR", fromISO: "" },
  cap: { lengthFt: 12000, surface: "ASP", cls: "C-17" },
  ...over,
});

describe("readLine", () => {
  it("reads quiet as quiet — and says absence of signal, not calm", () => {
    const r = readLine({ line: line(), fields: [field("OJAQ"), field("OTBH")], sources: all, today: TODAY });
    expect(r.worst).toBe("g");
    expect(r.summary).toMatch(/quiet across the line — absence of signal/);
    expect(r.unavailable).toEqual([]);
  });
  it("a field with no SITREP slot is UNKNOWN and says what to do", () => {
    const r = readLine({ line: line(), fields: [field("OJAQ"), field("OTBH", { sitrepSlot: false, sitrep: null })], sources: all, today: TODAY });
    expect(r.perField[1].worst).toBe("u");
    expect(r.perField[1].drivers[0].text).toMatch(/no SITREP slot — ★/);
    expect(r.worst).toBe("u");
  });
  it("a closure in effect is the lead driver and reads RED; a scheduled one AMBER", () => {
    const r = readLine({ line: line(), fields: [field("OJAQ", { sitrep: { status: { ...green, ops: "r" }, driver: "FIELD CLOSED (NOTAM)", worse: ["ops"], closure: { now: true, next: null, indeterminate: false } } }), field("OTBH")], sources: all, today: TODAY });
    expect(r.worst).toBe("r");
    expect(r.drivers[0]).toMatchObject({ icao: "OJAQ", kind: "closure", level: "r" });
    expect(r.summary).toMatch(/RED at OJAQ — field CLOSED now/);
    const s = readLine({ line: line({ fields: ["OJAQ"] }), fields: [field("OJAQ", { sitrep: { status: { ...green }, driver: "OPEN now", worse: [], closure: { now: false, next: "Sun 14:00Z–18:00Z", indeterminate: false } } })], sources: all, today: TODAY });
    expect(s.worst).toBe("a");
    expect(s.drivers[0].text).toMatch(/closure scheduled Sun 14:00Z/);
  });
  it("runway class below the airframe's need is a hard RED driver, stated planning-grade; a tanker needs the heavy class", () => {
    const r = readLine({ line: line({ airframe: "KC-135", fields: ["OJAQ"] }), fields: [field("OJAQ", { cap: { lengthFt: 5200, surface: "ASP", cls: "C-130" } })], sources: all, today: TODAY });
    expect(r.worst).toBe("r");
    expect(r.drivers[0]).toMatchObject({ kind: "runway", level: "r" });
    expect(r.drivers[0].text).toMatch(/5,200 ft .*C-130 — below the C-17 class a KC-135 needs \(planning-grade/);
    const ok = readLine({ line: line({ airframe: "C-130", fields: ["OJAQ"] }), fields: [field("OJAQ", { cap: { lengthFt: 5200, surface: "ASP", cls: "C-130" } })], sources: all, today: TODAY });
    expect(ok.worst).toBe("g");
    // A field the line names but the read was not given is UNKNOWN, never dropped.
    const missing = readLine({ line: line({ airframe: "C-130" }), fields: [field("OJAQ")], sources: all, today: TODAY });
    expect(missing.worst).toBe("u");
    expect(missing.perField[1].drivers[0].text).toMatch(/no SITREP slot/);
  });
  it("posture falls back to the host country and says so; TAF speaks only to today and tomorrow", () => {
    const r = readLine({ line: line({ fields: ["OJAQ"] }), fields: [field("OJAQ", { posture: { composite: "red", topDriver: "Conflict — strikes", country: "Jordan", via: "country" } })], sources: all, today: TODAY });
    expect(r.drivers[0]).toMatchObject({ kind: "posture", level: "r" });
    expect(r.drivers[0].text).toMatch(/posture RED \(Jordan\)/);
    const near = readLine({ line: line({ day: "2026-10-28" }), fields: [field("OJAQ", { taf: { worst: "IFR", fromISO: "2026-10-28T06:00:00Z" } })], sources: all, today: TODAY });
    expect(near.drivers.some((d) => d.kind === "taf")).toBe(true);
    expect(near.drivers.find((d) => d.kind === "taf")?.text).toMatch(/IFR forecast from 06:00Z/);
    const far = readLine({ line: line({ day: "2026-10-30" }), fields: [field("OJAQ", { taf: { worst: "IFR", fromISO: "2026-10-28T06:00:00Z" } })], sources: all, today: TODAY });
    expect(far.drivers.some((d) => d.kind === "taf")).toBe(false);
  });
  it("a dead source family is named and reads UNKNOWN, never clear", () => {
    const r = readLine({ line: line(), fields: [field("OJAQ", { posture: null, sitrep: null })], sources: { ...all, posture: false }, today: TODAY });
    expect(r.unavailable).toEqual(["force posture"]);
    expect(r.worst).toBe("u");
    expect(r.drivers.map((d) => d.text).join(" ")).toMatch(/force posture unavailable/);
    expect(r.drivers.map((d) => d.text).join(" ")).toMatch(/SITREP did not assemble/);
  });
  it("renders prompt lines with the day, the label, the status and the lead drivers", () => {
    const r = readLine({ line: line(), fields: [field("OJAQ", { sitrep: { status: { ...green, wx: "a" }, driver: "IFR → LIFR fcst", worse: [], closure: null } }), field("OTBH")], sources: all, today: TODAY });
    const [l] = lineReadLines([r]);
    expect(l).toBe("- Tue 27 Oct · JD 300 · C-17 · OJAQ → OTBH · planned · worst AMBER — OJAQ: wx AMBER — IFR → LIFR fcst");
  });
});
