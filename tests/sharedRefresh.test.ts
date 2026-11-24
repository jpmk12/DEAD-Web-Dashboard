import { describe, it, expect } from "vitest";
import { createSharedRefresher, type RefreshResult } from "../lib/sharedRefresh";

const HOUR = 3600_000;

describe("createSharedRefresher", () => {
  it("concurrent callers with one token share ONE refresh", async () => {
    let calls = 0;
    let now = 1_000_000;
    const r = createSharedRefresher(async (k): Promise<RefreshResult> => {
      calls += 1;
      await new Promise((res) => setTimeout(res, 5));
      return { accessToken: `at-${calls}`, accessTokenExpires: now + HOUR, refreshToken: k };
    }, { now: () => now });
    const out = await Promise.all(Array.from({ length: 50 }, () => r("rt")));
    expect(calls).toBe(1);
    expect(new Set(out.map((o) => o.accessToken))).toEqual(new Set(["at-1"]));
    // A request still carrying the old cookie later reuses the result.
    now += 10 * 60_000;
    expect((await r("rt")).accessToken).toBe("at-1");
    expect(calls).toBe(1);
  });

  it("refreshes again once the result is inside the margin, and keys apart", async () => {
    let calls = 0;
    let now = 0;
    const r = createSharedRefresher(async (k) => {
      calls += 1;
      return { accessToken: `${k}-${calls}`, accessTokenExpires: now + HOUR, refreshToken: k };
    }, { now: () => now, marginMs: 5 * 60_000 });
    await r("a");
    await r("b");
    expect(calls).toBe(2);
    now += HOUR - 4 * 60_000; // inside the 5-min margin
    expect((await r("a")).accessToken).toBe("a-3");
  });

  it("never caches a failure", async () => {
    let calls = 0;
    const r = createSharedRefresher(async () => {
      calls += 1;
      if (calls === 1) throw new Error("invalid_grant");
      return { accessToken: "ok", accessTokenExpires: Date.now() + HOUR, refreshToken: "x" };
    });
    const both = await Promise.allSettled([r("x"), r("x")]);
    expect(both.every((b) => b.status === "rejected")).toBe(true);
    expect(calls).toBe(1);
    expect((await r("x")).accessToken).toBe("ok");
  });
});
