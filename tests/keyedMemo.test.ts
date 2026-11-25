import { describe, it, expect } from "vitest";
import { createKeyedMemo } from "../lib/keyedMemo";

describe("createKeyedMemo", () => {
  it("shares one in-flight call and serves the result inside the TTL", async () => {
    let now = 0;
    let calls = 0;
    const m = createKeyedMemo<number>(60_000, { now: () => now });
    const fn = async () => { calls++; await new Promise((r) => setTimeout(r, 2)); return calls; };
    const out = await Promise.all([m.get("a", fn), m.get("a", fn), m.get("a", fn)]);
    expect(out).toEqual([1, 1, 1]);
    now += 30_000;
    expect(await m.get("a", fn)).toBe(1);
    now += 31_000;
    expect(await m.get("a", fn)).toBe(2);
    expect(calls).toBe(2);
  });

  it("keys apart and never caches a failure", async () => {
    let calls = 0;
    const m = createKeyedMemo<string>(60_000);
    await expect(m.get("x", async () => { calls++; throw new Error("down"); })).rejects.toThrow("down");
    expect(await m.get("x", async () => { calls++; return "ok"; })).toBe("ok");
    expect(await m.get("y", async () => { calls++; return "y"; })).toBe("y");
    expect(calls).toBe(3);
  });

  it("forget drops entries, and a read in flight during a write is not kept", async () => {
    let calls = 0;
    const m = createKeyedMemo<number>(60_000);
    let release!: () => void;
    const slow = m.get("a", () => new Promise<number>((r) => { release = () => r(++calls); }));
    m.forget(); // a write lands while the read is in flight
    release();
    expect(await slow).toBe(1);
    expect(await m.get("a", async () => ++calls)).toBe(2); // the stale read was not kept
    m.forget("a");
    expect(await m.get("a", async () => ++calls)).toBe(3);
  });
});
