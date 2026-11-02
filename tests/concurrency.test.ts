import { describe, it, expect } from "vitest";
import { runLimited } from "../lib/concurrency";

describe("runLimited", () => {
  it("keeps input order and never runs more than the limit at once", async () => {
    let inFlight = 0, peak = 0;
    const out = await runLimited([30, 5, 20, 1, 10, 2], 2, async (ms, i) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight--;
      return i * 10;
    });
    expect(out).toEqual([0, 10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });
  it("an empty list resolves empty; a bad limit runs one at a time", async () => {
    expect(await runLimited([], 3, async () => 1)).toEqual([]);
    let inFlight = 0, peak = 0;
    await runLimited([1, 2, 3], 0, async () => { inFlight++; peak = Math.max(peak, inFlight); await Promise.resolve(); inFlight--; });
    expect(peak).toBe(1);
  });
});
