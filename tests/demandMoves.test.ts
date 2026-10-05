import { describe, it, expect } from "vitest";
import { demandHorizon, MOVE_CAP, type DemandInput, type DemandMove } from "../lib/demandHorizon";

const base = (moves: DemandMove[]): DemandInput => ({
  today: "2026-10-05", watchedAors: ["CENTCOM"], boards: [], disasters: [], advisories: [], posture: [], chokepoints: [], moves,
});
const mv = (o: Partial<DemandMove> = {}): DemandMove => ({
  headline: "Pentagon orders carrier strike group to the Gulf", aor: "CENTCOM", kind: "deploy", actor: "United States", side: "us",
  pubDate: "2026-10-04T12:00:00Z", sources: 2, ...o,
});

describe("demand horizon — posture moves as a driver", () => {
  it("a corroborated deployment today is a material driver, named with its sources", () => {
    const [o] = demandHorizon(base([mv()]));
    const d = o.drivers.find((x) => x.source === "move");
    expect(d?.delta).toBe(14);
    expect(d?.text).toMatch(/2 sources/);
  });

  it("a single-source move is a lead: smaller, and says so", () => {
    const [o] = demandHorizon(base([mv({ sources: 1 })]));
    const d = o.drivers.find((x) => x.source === "move");
    expect(d?.delta).toBe(8);
    expect(d?.text).toMatch(/single source/);
  });

  it("recency decays and an old report contributes nothing", () => {
    const week = demandHorizon(base([mv({ pubDate: "2026-09-30T12:00:00Z" })]))[0].drivers.find((x) => x.source === "move");
    expect(week?.delta).toBe(8);
    const old = demandHorizon(base([mv({ pubDate: "2026-09-10T12:00:00Z" })]))[0].drivers.find((x) => x.source === "move");
    expect(old).toBeUndefined();
  });

  it("a withdrawal pulls demand DOWN; a non-U.S. mover by less", () => {
    const us = demandHorizon(base([mv({ kind: "withdraw" })]))[0].drivers.find((x) => x.source === "move");
    expect(us?.delta).toBe(-8);
    const other = demandHorizon(base([mv({ kind: "withdraw", side: "other", actor: "India" })]))[0].drivers.find((x) => x.source === "move");
    expect(other?.delta).toBe(-4);
  });

  it("moves are capped per AOR so reporting cannot dominate the outlook", () => {
    const many = Array.from({ length: 6 }, (_, i) => mv({ headline: `move ${i}`, kind: "deploy" }));
    const [o] = demandHorizon(base(many));
    const total = o.drivers.filter((x) => x.source === "move").reduce((s, d) => s + d.delta, 0);
    expect(total).toBe(MOVE_CAP);
  });

  it("absent moves (sweep did not run) change nothing", () => {
    const { moves: _m, ...noMoves } = base([]);
    const [o] = demandHorizon(noMoves as DemandInput);
    expect(o.drivers).toEqual([]);
  });
});
