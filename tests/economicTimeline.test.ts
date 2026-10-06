import { describe, it, expect } from "vitest";
import { buildTimeline, findSequences, timelineDays, type TimelineDot } from "../lib/economicTimeline";
import type { CoercionMove } from "../lib/economicWarfare";

const TODAY = "2026-09-29";
const mv = (p: Partial<CoercionMove>): CoercionMove => ({
  id: p.id ?? Math.random().toString(36), actorId: "iran", actorLabel: "Iran", direction: "by", target: "commercial shipping",
  instrument: "shipping", cls: "seizure", modality: "act", weight: 75, title: "t", ageDays: 1, own: false, phrase: "p", ...p,
});

describe("timelineDays", () => {
  it("ends on today, oldest first", () => {
    const d = timelineDays(TODAY, 5);
    expect(d).toEqual(["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29"]);
    expect(timelineDays("garbage")).toEqual([]);
  });
});

describe("buildTimeline", () => {
  it("plots dated acts/threats and pressure, never analysis or undated rows", () => {
    const { dots } = buildTimeline({
      today: TODAY,
      moves: [
        mv({ id: "a", pubDate: "2026-09-27T10:00:00Z" }),
        mv({ id: "b", modality: "analysis", pubDate: "2026-09-27T10:00:00Z" }),
        mv({ id: "c", pubDate: undefined }),
        mv({ id: "d", direction: "against", source: "Federal Register", cls: "U.S. sanctions", pubDate: "2026-09-20" }),
        mv({ id: "e", direction: "against", source: "EU consolidated list", cls: "12 listings", pubDate: "2026-09-21" }),
        mv({ id: "f", pubDate: "2026-06-01" }), // outside window
        mv({ id: "g", modality: "reversal", pubDate: "2026-09-26T10:00:00Z" }), // the measure lifted — never a move
      ],
    });
    expect(dots.map((d) => d.kind)).toEqual(["us", "foreign", "actor"]);
    expect(dots[0].day).toBe("2026-09-20");
    // Each move dot carries what the strip needs to explain itself (§10 E5).
    const act = dots.find((d) => d.kind === "actor")!;
    expect(act.modality).toBe("act");
    expect(act.moveId).toBe("a");
    expect(act.title).toBe("t");
  });
  it("plots shipping incidents and Brent moves beyond the threshold", () => {
    const { dots } = buildTimeline({
      today: TODAY, moves: [],
      incidents: [{ date: "2026-09-25", title: "tanker struck", chokepointName: "Strait of Hormuz", actorId: "iran", actorLabel: "Iran" }, { title: "undated", chokepointName: "x", actorId: "iran", actorLabel: "Iran" }],
      brent: [{ date: "2026-09-24", close: 80 }, { date: "2026-09-25", close: 84 }, { date: "2026-09-26", close: 84.5 }],
    });
    // Same day: heavier dot first (the +5% market move outweighs the incident).
    expect(dots.map((d) => d.kind)).toEqual(["market", "shipping"]);
    expect(dots[0].label).toMatch(/\+5\.0%/);
  });
});

describe("findSequences", () => {
  const dot = (kind: TimelineDot["kind"], day: string, label = kind): TimelineDot => ({ kind, day, label, actorId: "iran", actorLabel: "Iran", weight: 50 });
  it("names retaliation (pressure then move) and counter (move then pressure) within the window", () => {
    const s = findSequences([dot("us", "2026-09-10", "OFAC designation"), dot("actor", "2026-09-14", "seizure"), dot("us", "2026-09-18", "second designation")]);
    expect(s.map((x) => `${x.kind}:${x.gapDays}`)).toEqual(expect.arrayContaining(["retaliation:4", "counter:4"]));
  });
  it("a single response is not retaliation for many pressures, and nothing pairs outside the window", () => {
    const s = findSequences([dot("us", "2026-09-01"), dot("us", "2026-09-02"), dot("actor", "2026-09-05"), dot("actor", "2026-09-28")]);
    expect(s.filter((x) => x.kind === "retaliation").length).toBe(1);
    expect(s.some((x) => x.secondDay === "2026-09-28")).toBe(false);
  });
  it("actors do not cross", () => {
    const s = findSequences([dot("us", "2026-09-10"), { ...dot("actor", "2026-09-12"), actorId: "russia", actorLabel: "Russia" }]);
    expect(s).toEqual([]);
  });
});
