import { describe, it, expect } from "vitest";
import { fairKeep } from "../lib/xRetention";

const NOW = Date.parse("2026-10-31T12:00:00Z");
const H = 3_600_000;
const row = (id: string, handle: string, hoursAgo: number) => ({ id, handle, ts: NOW - hoursAgo * H });

describe("fairKeep — X retention is fair by handle", () => {
  it("a quiet spotter keeps its post when two loud lists fill the cap", () => {
    // 2026-10-31: @ArmchairAdml's 28 Oct post vanished under ~400 news posts a day.
    const loud = Array.from({ length: 600 }, (_, i) => row(`w${i}`, i % 2 ? "WSJ" : "FaytuksNetwork", i * 0.1));
    const spotter = row("spot", "ArmchairAdml", 72);
    const keep = fairKeep([...loud, spotter], NOW, { total: 400, perHandleFloor: 25 });
    expect(keep.has("spot")).toBe(true);
    expect(keep.size).toBe(400);
  });
  it("fills the cap newest-first after the floors", () => {
    const rows = [row("a1", "a", 1), row("a2", "a", 2), row("a3", "a", 3), row("b1", "b", 10)];
    expect([...fairKeep(rows, NOW, { total: 3, perHandleFloor: 1 })].sort()).toEqual(["a1", "a2", "b1"]);
  });
  it("never keeps a post outside the window, floor or not", () => {
    const keep = fairKeep([row("old", "spotter", 15 * 24), row("new", "spotter", 1)], NOW, { total: 10, perHandleFloor: 5, maxDays: 14 });
    expect([...keep]).toEqual(["new"]);
  });
  it("floors may take the store past the cap when many handles post — every voice keeps its newest", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`h${i}`, `handle${i}`, i));
    expect(fairKeep(rows, NOW, { total: 5, perHandleFloor: 1 }).size).toBe(10);
  });
  it("handles compare case-insensitively", () => {
    const rows = [row("x1", "WSJ", 1), row("x2", "wsj", 2), row("x3", "Wsj", 3)];
    expect(fairKeep(rows, NOW, { total: 0, perHandleFloor: 2 }).size).toBe(2);
  });
});
