import { describe, it, expect } from "vitest";
import { demandHorizon, RISE_AT, FALL_AT, type DemandInput } from "../lib/demandHorizon";

const TODAY = "2026-09-28";
const NOW = Date.parse(`${TODAY}T00:00:00Z`);
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const empty: DemandInput = { today: TODAY, watchedAors: ["CENTCOM", "EUCOM"], boards: [], disasters: [], advisories: [], posture: [], chokepoints: [] };

describe("demandHorizon — rows and defaults", () => {
  it("gives every watched AOR a row, holding with low confidence when quiet", () => {
    const r = demandHorizon(empty);
    expect(r.map((x) => x.aor).sort()).toEqual(["CENTCOM", "EUCOM"]);
    for (const x of r) {
      expect(x.direction).toBe("hold");
      expect(x.confidence).toBe("low");
      expect(x.line).toMatch(/absence of signal/);
    }
  });

  it("adds an unwatched AOR only when something drives it, and never UNKNOWN unless driven", () => {
    const r = demandHorizon({ ...empty, disasters: [{ title: "Typhoon", aor: "INDOPACOM", severity: "red", hadrScore: 70, timeISO: ago(1), nearBase: false }] });
    expect(r.map((x) => x.aor)).toContain("INDOPACOM");
    expect(r.map((x) => x.aor)).not.toContain("UNKNOWN");
  });
});

describe("demandHorizon — trajectory over level", () => {
  it("scores a deteriorating WATCH above an improving WARNING", () => {
    const r = demandHorizon({
      ...empty,
      boards: [
        { label: "A", aor: "CENTCOM", level: "watch", trajectory: "deteriorating", learning: false },
        { label: "B", aor: "EUCOM", level: "warning", trajectory: "improving", learning: false },
      ],
    });
    const c = r.find((x) => x.aor === "CENTCOM")!, e = r.find((x) => x.aor === "EUCOM")!;
    expect(c.score).toBeGreaterThan(e.score);
  });

  it("caps a learning-mode board's push", () => {
    const r = demandHorizon({ ...empty, boards: [{ label: "A", aor: "CENTCOM", level: "alert", trajectory: "deteriorating", learning: true }] });
    expect(r[0].drivers[0].delta).toBe(12);
    expect(r[0].drivers[0].text).toMatch(/learning mode/);
  });

  it("can say FALL when boards are improving and nothing else is rising", () => {
    const r = demandHorizon({
      ...empty,
      boards: [
        { label: "A", aor: "CENTCOM", level: "calm", trajectory: "improving", learning: false },
        { label: "B", aor: "CENTCOM", level: "watch", trajectory: "improving", learning: false },
      ],
    });
    const c = r.find((x) => x.aor === "CENTCOM")!;
    expect(c.score).toBeLessThanOrEqual(FALL_AT);
    expect(c.direction).toBe("fall");
  });
});

describe("demandHorizon — recency and caps", () => {
  it("decays a disaster with age and drops a stale minor one", () => {
    const fresh = demandHorizon({ ...empty, disasters: [{ title: "Quake", aor: "CENTCOM", severity: "red", hadrScore: 70, timeISO: ago(2), nearBase: false }] });
    const old = demandHorizon({ ...empty, disasters: [{ title: "Quake", aor: "CENTCOM", severity: "red", hadrScore: 70, timeISO: ago(20), nearBase: false }] });
    const stale = demandHorizon({ ...empty, disasters: [{ title: "Flood", aor: "CENTCOM", severity: "orange", hadrScore: 55, timeISO: ago(20), nearBase: false }] });
    const s = (r: ReturnType<typeof demandHorizon>) => r.find((x) => x.aor === "CENTCOM")!.score;
    expect(s(fresh)).toBeGreaterThan(s(old));
    expect(s(old)).toBeGreaterThan(0);
    expect(s(stale)).toBe(0);
  });

  it("caps disasters so a swarm of them cannot own the AOR", () => {
    const disasters = Array.from({ length: 10 }, (_, i) => ({ title: `D${i}`, aor: "INDOPACOM" as const, severity: "red" as const, hadrScore: 80, timeISO: ago(1), nearBase: true }));
    const r = demandHorizon({ ...empty, disasters });
    const row = r.find((x) => x.aor === "INDOPACOM")!;
    expect(row.drivers.filter((d) => d.source === "disaster").reduce((s, d) => s + d.delta, 0)).toBeLessThanOrEqual(45);
  });

  it("treats a recent ordered departure as demand and an old one as standing posture", () => {
    const recent = demandHorizon({ ...empty, advisories: [{ country: "Iraq", aor: "CENTCOM", ordered: true, authorized: false, pubDate: ago(3) }] });
    const old = demandHorizon({ ...empty, advisories: [{ country: "Iraq", aor: "CENTCOM", ordered: true, authorized: false, pubDate: ago(200) }] });
    const c = (r: ReturnType<typeof demandHorizon>) => r.find((x) => x.aor === "CENTCOM")!;
    expect(c(recent).direction).toBe("rise");
    expect(c(old).direction).toBe("hold");
    expect(c(old).drivers[0].text).toMatch(/standing/);
  });

  it("weights an escalation above a chronic red", () => {
    const esc = demandHorizon({ ...empty, posture: [{ label: "Iraq", aor: "CENTCOM", composite: "red", escalated: true, chronic: false }] });
    const chr = demandHorizon({ ...empty, posture: [{ label: "Iraq", aor: "CENTCOM", composite: "red", escalated: false, chronic: true }] });
    expect(esc.find((x) => x.aor === "CENTCOM")!.score).toBeGreaterThan(chr.find((x) => x.aor === "CENTCOM")!.score);
  });
});

describe("demandHorizon — confidence and ordering", () => {
  it("confidence counts independent sources, not score size", () => {
    const one = demandHorizon({ ...empty, boards: [{ label: "A", aor: "CENTCOM", level: "alert", trajectory: "deteriorating", learning: false }] });
    const three = demandHorizon({
      ...empty,
      boards: [{ label: "A", aor: "CENTCOM", level: "watch", trajectory: "deteriorating", learning: false }],
      advisories: [{ country: "Iraq", aor: "CENTCOM", ordered: false, authorized: true, pubDate: ago(2) }],
      chokepoints: [{ name: "Hormuz", aor: "CENTCOM", score: 70, acts: 1, threats: 2 }],
    });
    const c = (r: ReturnType<typeof demandHorizon>) => r.find((x) => x.aor === "CENTCOM")!;
    expect(c(one).score).toBeGreaterThan(RISE_AT);
    expect(c(one).confidence).toBe("low");
    expect(c(three).confidence).toBe("high");
    expect(c(three).sources).toBe(3);
  });

  it("orders rows by score and drivers by magnitude", () => {
    const r = demandHorizon({
      ...empty,
      boards: [{ label: "A", aor: "EUCOM", level: "watch", trajectory: "deteriorating", learning: false }],
      advisories: [{ country: "Iraq", aor: "CENTCOM", ordered: true, authorized: false, pubDate: ago(1) }],
      posture: [{ label: "Iraq", aor: "CENTCOM", composite: "amber", escalated: false, chronic: false }],
    });
    expect(r[0].aor).toBe("CENTCOM");
    expect(r[0].drivers[0].source).toBe("neo");
  });
});
