import { describe, it, expect } from "vitest";
import { computeDelta, deltaAgainstLook, levelSnapshot, rollLook, SESSION_GAP_MS, type LevelSeries } from "../lib/oeDelta";

const H = 3_600_000;
const T0 = Date.parse("2026-11-25T08:00:00Z");
const ojaq = (lvl: string): LevelSeries => ({ kind: "sitrep", id: "OJAQ:ops", label: "OJAQ", axis: "ops", points: [{ day: "2026-11-24", level: "g" }, { day: "2026-11-25", level: lvl }] });
const jordan = (lvl: string): LevelSeries => ({ kind: "posture", id: "c:jordan", label: "Jordan", points: [{ day: "2026-11-25", level: lvl }] });

describe("OE delta against the levels seen at the last look", () => {
  it("sees a change made the same day — the whole-day comparison could not", () => {
    // 08:00 look: OJAQ ops green. 14:00: today's row has turned red.
    const seenAt8 = levelSnapshot([ojaq("g")]);
    expect(computeDelta([ojaq("r")], T0, T0 + 6 * H).worse).toHaveLength(0); // the old bug
    const d = deltaAgainstLook([ojaq("r")], { at: T0, levels: seenAt8 }, T0 + 6 * H);
    expect(d.worse.map((t) => t.reason)).toEqual(["OJAQ ops: green → red"]);
    expect(d.sinceMs).toBe(T0);
    expect(d.firstLook).toBe(false);
  });

  it("reports improvements, new elevated subjects, and nothing for an unchanged level", () => {
    const seen = levelSnapshot([ojaq("r"), jordan("amber")]);
    const d = deltaAgainstLook([ojaq("g"), jordan("amber"), { kind: "iw", id: "mp-x", label: "Iran", points: [{ day: "2026-11-25", level: "warning" }] }], { at: T0, levels: seen }, T0 + 2 * H);
    expect(d.better.map((t) => t.reason)).toEqual(["OJAQ ops: red → green"]);
    expect(d.fresh.map((t) => t.label)).toEqual(["Iran"]);
    expect(d.worse).toHaveLength(0);
    expect(d.line).toBe("1 improved · 1 new since your last look");
  });

  it("a look inside the session gap keeps the visit's baseline; one after it rolls", () => {
    const a = levelSnapshot([ojaq("g")]);
    const first = rollLook(null, a, T0);
    expect(first.compareWith).toBeNull(); // first ever look → the "yesterday" fallback
    // Next visit, 5 h later: compares with what was seen at 08:00.
    const b = levelSnapshot([ojaq("r")]);
    const second = rollLook(first.next, b, T0 + 5 * H);
    expect(second.compareWith).toEqual({ at: T0, levels: a });
    // A reload 10 min later keeps that baseline — the change stays on the card.
    const reload = rollLook(second.next, b, T0 + 5 * H + 10 * 60_000);
    expect(reload.compareWith).toEqual({ at: T0, levels: a });
    expect(deltaAgainstLook([ojaq("r")], reload.compareWith).worse).toHaveLength(1);
    // A board polling every 5 min for hours never starts a new visit…
    let st = reload.next;
    for (let t = 1; t <= 30; t++) st = rollLook(st, b, T0 + 5 * H + 10 * 60_000 + t * 5 * 60_000).next;
    expect(st.baselineAt).toBe(T0);
    // …an hour away does, and the baseline becomes what was last seen.
    const later = rollLook(st, b, st.lastLookAt + SESSION_GAP_MS);
    expect(later.compareWith?.levels).toEqual(b);
  });

  it("no stored look falls back to yesterday and says so", () => {
    const d = deltaAgainstLook([ojaq("r")], null, T0);
    expect(d.firstLook).toBe(true);
    expect(d.sinceMs).toBeNull();
    expect(d.worse.map((t) => t.reason)).toEqual(["OJAQ ops: green → red"]);
  });

  it("a level the vocabulary cannot place is never snapshotted or reported", () => {
    expect(levelSnapshot([{ kind: "sitrep", id: "X:wx", label: "X", axis: "wx", points: [{ day: "2026-11-25", level: "purple" }] }])).toEqual({});
  });
});
