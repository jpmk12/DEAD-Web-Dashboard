import { describe, it, expect } from "vitest";
import { functionalRows, functionalText, worstLed, FC_MAP_LAYERS, type FcInput, type FcSpectrum } from "../lib/functionalCommands";
import { resolveAsk, type AskCatalogue } from "../lib/askResolve";

const read = (state: "dormant" | "watching" | "active" | "confirmed", board = "CENTCOM · Iran", live = true) =>
  ({ state, led: state === "active" || state === "confirmed" ? "r" : state === "watching" ? "a" : "g", board, problemId: "centcom-iran", why: `${state} because of something`, live } as const);

const SPECTRUM: FcSpectrum = {
  pnt: read("watching"),
  cyber: read("active"),
  space: read("dormant", "EUCOM · Russia"),
  counterspace: null,
  spaceWx: { live: true, led: "g", severe: [] },
  edge: { declared: true, live: true, led: "a", vendors: ["Cisco", "Fortinet"], hits: [{ cve: "CVE-2026-1", vendor: "Cisco", product: "ASA", ransomware: true }] },
  boards: [{ problemId: "centcom-iran", label: "CENTCOM · Iran", pnt: "watching", cyber: "active", space: null }, { problemId: "mp-russia", label: "EUCOM · Russia", pnt: "dormant", cyber: "dormant", space: "dormant", counterspace: "watching" }],
  postures: [
    { country: "Russia", board: { problemId: "mp-russia", label: "EUCOM · Russia" }, counterspace: null, catalogue: { live: false, configured: false, reason: "SPACETRACK_USER / SPACETRACK_PASS not set", closestKm: null, manoeuvres14: 0 }, cyber: { posture: "sustained pressure", why: "3 espionage reports" } },
    { country: "China", board: null, counterspace: null, catalogue: null, cyber: { posture: "quiet", why: "nothing reported" } },
  ],
};
const EMPTY: FcInput = { spectrum: null, demand: null, crew: null, straits: null, sitreps: null, ownFields: [], alerts: null };
const FULL: FcInput = {
  spectrum: SPECTRUM,
  demand: [{ aor: "CENTCOM", direction: "rise", score: 40, confidence: "high", line: "CENTCOM demand likely to RISE" }, { aor: "EUCOM", direction: "hold", score: 3, confidence: "low", line: "EUCOM holding" }],
  crew: { declared: true, line: "2 of 8 crews available", stale: false, staleHours: 4, lines: [{ aor: "CENTCOM", direction: "rise", posture: "thin", mismatch: true, line: "CENTCOM demand likely to RISE — 2 of 8 crews (thin) ⚠" }, { aor: "EUCOM", direction: "hold", posture: "thin", mismatch: false, line: "EUCOM holding" }] },
  straits: [{ id: "hormuz", name: "Strait of Hormuz", aor: "CENTCOM", score: 70, acts: 1, threats: 2, line: "IRGC seized a tanker", transit: "suppressed" }, { id: "suez", name: "Suez", aor: "CENTCOM", score: 0, acts: 0, threats: 0, line: null }],
  sitreps: [{ icao: "KWRI", label: "McGuire", country: "United States", aor: "NORTHCOM", status: { wx: "g", ops: "a", threat: "g", infra: "g", spectrum: "u" }, driver: "RWY 06/24 closed 1400-1800", worse: [] }],
  ownFields: [{ icao: "KWRI", label: "McGuire", role: "hub", country: "United States", lat: 40, lon: -74.6 }, { icao: "OJAQ", label: "Aqaba", role: "spoke", country: "Jordan", lat: 29.6, lon: 35 }],
  alerts: [{ id: "outage-Iraq", severity: "red", kind: "spectrum", title: "Critical outage · Iraq", sub: "IODA", aor: "CENTCOM" }],
};

describe("functional commands — every cell is earned, UNKNOWN never folds into green", () => {
  it("with nothing available all three rows are UNKNOWN and say which sensor is missing", () => {
    const rows = functionalRows(EMPTY);
    expect(rows.map((r) => r.cmd)).toEqual(["TRANSCOM", "SPACECOM", "CYBERCOM"]);
    for (const r of rows) {
      expect(r.worst).toBe("u");
      expect(r.cells.every((c) => c.led === "u")).toBe(true);
      expect(r.cells.every((c) => /UNKNOWN|no hub|unavailable/.test(c.text))).toBe(true);
    }
    expect(rows[0].cells.find((c) => c.key === "enroute")!.text).toMatch(/no hub or spoke declared/);
  });
  it("TRANSCOM: rising demand against thin crews is RED, the straits report the act, the en route hub carries its own driver", () => {
    const t = functionalRows(FULL)[0];
    const cell = Object.fromEntries(t.cells.map((c) => [c.key, c]));
    expect(cell.demand.led).toBe("a");
    expect(cell.demand.text).toContain("CENTCOM likely to RISE (high)");
    expect(cell.crews.led).toBe("r");
    expect(cell.crews.text).toMatch(/CENTCOM demand likely to RISE against thin crews · 2 of 8 crews available/);
    expect(cell.straits.led).toBe("r");
    expect(cell.straits.text).toBe("Strait of Hormuz — 1 act, 2 threats · transit suppressed");
    expect(cell.enroute.led).toBe("a");
    expect(cell.enroute.text).toBe("KWRI (hub) amber — RWY 06/24 closed 1400-1800");
    expect(cell.enroute.door).toEqual({ kind: "field", id: "KWRI" });
    expect(t.worst).toBe("r");
    expect(t.why).toMatch(/^Crews: /);
    expect(t.layers).toEqual(FC_MAP_LAYERS.TRANSCOM);
  });
  it("TRANSCOM: undeclared crews are UNKNOWN with the instruction, a stale declaration says so, a quiet strait set is green", () => {
    const quiet = functionalRows({ ...FULL, crew: { declared: false, line: null, stale: false, staleHours: null, lines: [] }, straits: [{ id: "suez", name: "Suez", aor: "CENTCOM", score: 0, acts: 0, threats: 0, line: null }], demand: [{ aor: "EUCOM", direction: "hold", score: 2, confidence: "low", line: "EUCOM holding" }] })[0];
    const cell = Object.fromEntries(quiet.cells.map((c) => [c.key, c]));
    expect(cell.crews.led).toBe("u");
    expect(cell.crews.text).toMatch(/do not assume crews are available/);
    expect(cell.straits.led).toBe("g");
    expect(cell.demand.led).toBe("g");
    const stale = functionalRows({ ...FULL, crew: { ...FULL.crew!, stale: true, staleHours: 72, lines: FULL.crew!.lines.map((l) => ({ ...l, mismatch: false })) } })[0];
    expect(stale.cells.find((c) => c.key === "crews")!.text).toMatch(/last updated 3d ago, confirm/);
    expect(stale.cells.find((c) => c.key === "crews")!.led).toBe("a");
  });
  it("SPACECOM: PNT names its board, counterspace says Space-Track is not configured, space weather reads quiet", () => {
    const s = functionalRows(FULL)[1];
    const cell = Object.fromEntries(s.cells.map((c) => [c.key, c]));
    expect(cell.pnt.led).toBe("a");
    expect(cell.pnt.text).toMatch(/^watching on CENTCOM · Iran — /);
    expect(cell.pnt.door).toEqual({ kind: "board", id: "centcom-iran" });
    expect(cell.pnt.detail).toContain("CENTCOM · Iran: watching");
    expect(cell.counterspace.led).toBe("u");
    expect(cell.counterspace.detail[0]).toMatch(/Space-Track not configured/);
    expect(cell.swx.led).toBe("g");
    expect(cell.swx.text).toMatch(/quiet/);
    expect(cell.launch.led).toBe("g");
    expect(s.worst).toBe("a");
    const storm = functionalRows({ ...FULL, spectrum: { ...SPECTRUM, spaceWx: { live: true, led: "r", severe: [{ scale: "G", level: 4 }] } } })[1];
    expect(storm.cells.find((c) => c.key === "swx")!.text).toBe("G4 in effect");
    expect(storm.worst).toBe("r");
  });
  it("CYBERCOM: active pressure is RED, the edge counts KEV hits and ransomware, an outage alert is RED, actor posture names the actor", () => {
    const c = functionalRows(FULL)[2];
    const cell = Object.fromEntries(c.cells.map((x) => [x.key, x]));
    expect(cell.cyber.led).toBe("r");
    expect(cell.edge.led).toBe("a");
    expect(cell.edge.text).toBe("1 KEV hit on Cisco, Fortinet · 1 in ransomware use");
    expect(cell.outages.led).toBe("r");
    expect(cell.outages.text).toBe("Critical outage · Iraq");
    expect(cell.actors.led).toBe("a");
    expect(cell.actors.text).toBe("Russia: sustained pressure · China: quiet");
    expect(cell.actors.door).toEqual({ kind: "country", id: "Russia" });
    expect(c.worst).toBe("r");
    expect(c.why).toMatch(/^Cyber pressure: /);
  });
  it("CYBERCOM: no declared vendors is UNKNOWN not clear; no outage alert is green only when the cyber sensors answered", () => {
    const sp: FcSpectrum = { ...SPECTRUM, edge: { ...SPECTRUM.edge, declared: false, vendors: [], hits: [] }, cyber: read("dormant", "CENTCOM · Iran", false) };
    const c = functionalRows({ ...FULL, spectrum: sp, alerts: [] })[2];
    const cell = Object.fromEntries(c.cells.map((x) => [x.key, x]));
    expect(cell.edge.led).toBe("u");
    expect(cell.edge.text).toMatch(/no edge vendors declared — UNKNOWN, not clear/);
    expect(cell.outages.led).toBe("u");
    expect(cell.cyber.led).toBe("u");
    const ok = functionalRows({ ...FULL, alerts: [] })[2];
    expect(ok.cells.find((x) => x.key === "outages")!.led).toBe("g");
  });
  it("a pending spectrum summary reads as assembling, never as calm", () => {
    const s = functionalRows({ ...FULL, spectrum: { ...SPECTRUM, pending: true, pnt: null, cyber: null, space: null } })[1];
    expect(s.cells.find((c) => c.key === "pnt")!.text).toMatch(/assembling/);
    expect(s.cells.find((c) => c.key === "pnt")!.led).toBe("u");
  });
  it("the text form for the Ask pack lists every cell with its LED word", () => {
    const text = functionalText(functionalRows(FULL), ["SPACECOM"]);
    expect(text).toMatch(/^USSPACECOM \(AMBER\) — the space domain/);
    expect(text).toContain("- PNT [AMBER]: watching on CENTCOM · Iran");
    expect(text).not.toContain("USTRANSCOM");
    expect(worstLed(["g", "u"])).toBe("u");
    expect(worstLed(["a", "r", "u"])).toBe("r");
  });
});

describe("Ask the board — functional command names resolve", () => {
  const CAT: AskCatalogue = { boards: [], chokepoints: [], countries: ["Iran"] };
  it("SPACECOM / CYBERCOM / TRANSCOM and their aliases place the question on the functional row", () => {
    expect(resolveAsk("What is SPACECOM seeing this week?", CAT).functional).toEqual(["SPACECOM"]);
    expect(resolveAsk("any cyber command concerns for Iran", CAT).functional).toEqual(["CYBERCOM"]);
    expect(resolveAsk("How is the mobility enterprise holding — USTRANSCOM view", CAT).functional).toEqual(["TRANSCOM"]);
    expect(resolveAsk("Is AMC stretched?", CAT).functional).toEqual(["TRANSCOM"]);
    expect(resolveAsk("How likely is conflict with Iran?", CAT).functional).toEqual([]);
    expect(resolveAsk("space force statement on the inspector satellites", CAT).unplaced).not.toContain("SPACECOM");
  });
});
