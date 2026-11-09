import { describe, it, expect } from "vitest";
import { markReadWithFallback, BATCH_CHUNK, type MarkDeps } from "../lib/gmailMark";

const RATE = { code: 429 };
const AUTH = { code: 401 };
const OTHER = { code: 500 };

function deps(over: Partial<MarkDeps> & { calls?: { batch: string[][]; single: string[] } } = {}): MarkDeps & { calls: { batch: string[][]; single: string[] } } {
  const calls = over.calls ?? { batch: [], single: [] };
  return {
    calls,
    batch: over.batch ?? (async (ids) => { calls.batch.push(ids); }),
    single: over.single ?? (async (id) => { calls.single.push(id); }),
    isRate: (e) => (e as { code?: number })?.code === 429,
    isAuth: (e) => (e as { code?: number })?.code === 401,
    sleep: async () => {},
  };
}

describe("markReadWithFallback", () => {
  it("marks everything in ONE batch call when Gmail accepts it", async () => {
    const d = deps();
    const ids = Array.from({ length: 150 }, (_, i) => `id${i}`);
    expect(await markReadWithFallback(ids, d)).toEqual([]);
    expect(d.calls.batch).toHaveLength(1);
    expect(d.calls.single).toHaveLength(0);
  });

  it("chunks at the batch limit and dedupes", async () => {
    const d = deps();
    const ids = Array.from({ length: BATCH_CHUNK + 5 }, (_, i) => `id${i}`);
    await markReadWithFallback([...ids, "id0"], d);
    expect(d.calls.batch.map((c) => c.length)).toEqual([BATCH_CHUNK, 5]);
  });

  it("retries the batch once after a rate limit before going one by one", async () => {
    let n = 0;
    const d = deps({ batch: async () => { if (n++ === 0) throw RATE; } });
    expect(await markReadWithFallback(["a", "b"], d)).toEqual([]);
    expect(n).toBe(2);
    expect(d.calls.single).toHaveLength(0);
  });

  it("falls back one by one when the batch is refused, and reports only what Gmail still refused", async () => {
    const tries: Record<string, number> = {};
    const d = deps({
      batch: async () => { throw OTHER; },
      single: async (id) => {
        tries[id] = (tries[id] ?? 0) + 1;
        if (id === "bad") throw OTHER;
        if (id === "slow" && tries[id] === 1) throw RATE; // refused once, then accepted
      },
    });
    expect(await markReadWithFallback(["a", "slow", "bad", "b"], d)).toEqual(["bad"]);
    expect(tries.slow).toBe(2);
  });

  it("an auth refusal fails the chunk without hammering Gmail", async () => {
    const d = deps({ batch: async () => { throw AUTH; } });
    expect(await markReadWithFallback(["a", "b"], d)).toEqual(["a", "b"]);
    expect(d.calls.single).toHaveLength(0);
  });
});
