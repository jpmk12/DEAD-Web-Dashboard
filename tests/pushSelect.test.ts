import { describe, it, expect } from "vitest";
import { selectFresh, summarize, SEEN_CAP } from "../lib/pushSelect";
import type { AlertItem } from "../lib/alerts";

const a = (id: string, severity: "red" | "amber" = "red"): AlertItem =>
  ({ id, severity, kind: "force", title: `T ${id}`, sub: `S ${id}` });

describe("selectFresh — a notification is a claim on attention", () => {
  it("reports only ids this device has not been told about", () => {
    const { fresh } = selectFresh([a("x"), a("y")], ["x"]);
    expect(fresh.map((f) => f.id)).toEqual(["y"]);
  });

  it("never re-notifies an id that is still in effect", () => {
    const first = selectFresh([a("x")], []);
    const second = selectFresh([a("x")], first.nextSeen);
    expect(second.fresh).toEqual([]);
    expect(second.nextSeen).toEqual(["x"]);
  });

  it("forgets a cleared id so its return is news again", () => {
    const s1 = selectFresh([a("x")], []).nextSeen;
    const s2 = selectFresh([], s1).nextSeen;      // x cleared
    expect(s2).toEqual([]);
    const back = selectFresh([a("x")], s2);
    expect(back.fresh.map((f) => f.id)).toEqual(["x"]);
  });

  it("caps the remembered set", () => {
    const many = Array.from({ length: SEEN_CAP + 50 }, (_, i) => a(`id${i}`));
    const { nextSeen } = selectFresh(many, []);
    expect(nextSeen).toHaveLength(SEEN_CAP);
    expect(nextSeen[nextSeen.length - 1]).toBe(`id${SEEN_CAP + 49}`);
  });

  it("drops empty ids rather than notifying on them", () => {
    expect(selectFresh([a("")], []).fresh).toEqual([]);
  });
});

describe("summarize — one card per push", () => {
  it("returns null when there is nothing fresh", () => {
    expect(summarize([])).toBeNull();
  });

  it("uses the alert's own title for a single item", () => {
    const n = summarize([a("x")])!;
    expect(n.title).toBe("T x");
    expect(n.tag).toBe("x");
  });

  it("counts reds first and lists titles for a batch", () => {
    const n = summarize([a("m", "amber"), a("r1"), a("r2")])!;
    expect(n.title).toBe("2 red alerts · 1 amber");
    expect(n.body.split("\n")[0]).toBe("T r1");
  });

  it("says 'new alerts' when nothing in the batch is red", () => {
    expect(summarize([a("m1", "amber"), a("m2", "amber")])!.title).toBe("2 new alerts");
  });
});
