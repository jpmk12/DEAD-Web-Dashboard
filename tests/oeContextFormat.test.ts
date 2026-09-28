import { describe, it, expect } from "vitest";
import { renderOeContext, surfaceLine, OE_CONTEXT_MAX_CHARS, type OeSnapshot } from "../lib/oeContextFormat";

const base: OeSnapshot = {
  atISO: "2026-09-28T14:05:00Z",
  force: [
    { label: "Qatar", composite: "green", topDriver: "quiet" },
    { label: "Iraq", composite: "red", topDriver: "Conflict — strikes near Erbil", cocom: "CENTCOM", chronicity: "chronic 12/14d", escalated: true },
    { label: "Jordan", composite: "unknown", topDriver: "feeds down" },
  ],
  sitrep: [{ icao: "KWRI", label: "McGuire", status: { wx: "g", ops: "a", threat: "g", infra: "u" }, driver: "RWY 06/24 closed 1400-1800", worse: ["ops"] }],
  boards: [{ label: "CENTCOM · Iran", level: "watch", anomaly: 0.42, trajectory: "deteriorating", learning: false, drivers: ["escalatory rhetoric", "airspace NOTAMs"] }],
  alerts: [{ severity: "red", title: "Force protection RED — Iraq", sub: "Conflict — strikes near Erbil" }],
  delta: { line: "1 worse since your last look", worse: ["Iraq amber→red"], better: [], fresh: [] },
  decisionsDue: [{ problem: "CENTCOM · Iran", call: "escalate", expectation: "strikes within 7 days", dueISO: "2026-09-29T00:00:00Z" }],
};

describe("renderOeContext", () => {
  it("says unavailable, and forbids inference, when there is no snapshot", () => {
    const s = renderOeContext(null);
    expect(s).toMatch(/unavailable this turn/);
    expect(s).toMatch(/do not infer/);
  });

  it("lists elevated posture worst-first and counts the greens instead of listing them", () => {
    const s = renderOeContext(base);
    const iraq = s.indexOf("Iraq");
    const jordan = s.indexOf("Jordan");
    expect(iraq).toBeGreaterThan(-1);
    expect(iraq).toBeLessThan(jordan);
    expect(s).not.toMatch(/Qatar/);
    expect(s).toMatch(/1 green/);
  });

  it("keeps UNKNOWN visible rather than dropping it", () => {
    const s = renderOeContext(base);
    expect(s).toMatch(/Jordan.*UNKNOWN/);
    expect(s).toMatch(/infra unknown/);
  });

  it("marks an unavailable surface as UNAVAILABLE, distinct from empty", () => {
    const s = renderOeContext({ ...base, force: null, boards: [] });
    expect(s).toMatch(/Force posture .*UNAVAILABLE/);
    expect(s).not.toMatch(/I&W boards .*UNAVAILABLE/);
  });

  it("carries chronicity, escalation, worse-than-yesterday and learning-mode tags", () => {
    const s = renderOeContext({ ...base, boards: [{ ...base.boards![0], learning: true }] });
    expect(s).toMatch(/escalated today, chronic 12\/14d/);
    expect(s).toMatch(/worse than yesterday: ops/);
    expect(s).toMatch(/learning mode/);
  });

  it("stamps the snapshot time and flags staleness", () => {
    expect(renderOeContext(base)).toMatch(/as of 14:05Z/);
    expect(renderOeContext({ ...base, stale: true })).toMatch(/STALE/);
  });

  it("names surfaces so the answer can send the user there", () => {
    const s = renderOeContext(base);
    expect(s).toMatch(/OSINT › Regional/);
    expect(s).toMatch(/OSINT › Watch › I&W/);
    expect(s).toMatch(/Glance › What changed/);
  });

  it("never exceeds the cap", () => {
    const many: OeSnapshot = {
      ...base,
      force: Array.from({ length: 80 }, (_, i) => ({ label: `Country ${i}`, composite: "amber", topDriver: "x".repeat(200) })),
    };
    expect(renderOeContext(many).length).toBeLessThanOrEqual(OE_CONTEXT_MAX_CHARS);
  });
});

describe("surfaceLine", () => {
  it("sanitises the surface id and is empty when absent", () => {
    expect(surfaceLine("osint:watch")).toMatch(/"osint:watch" surface/);
    expect(surfaceLine('<script>')).toMatch(/"script"/);
    expect(surfaceLine(null)).toBe("");
  });
});
