import { describe, it, expect } from "vitest";
import { recordAiOk, recordAiFail, getAiHealth, aiHealthLine } from "../lib/aiHealth";

describe("aiHealth", () => {
  it("names a rejected key as the cause, not a generic error", () => {
    recordAiFail({ status: 401, error: { error: { message: "invalid x-api-key" } } });
    const line = aiHealthLine(getAiHealth())!;
    expect(line).toMatch(/API key rejected/);
    expect(line).toMatch(/ANTHROPIC_API_KEY/);
    expect(line).toMatch(/restart/);
  });

  it("distinguishes rate limit and overload from auth", () => {
    recordAiOk();
    recordAiFail({ status: 429, message: "rate_limit_error" });
    expect(aiHealthLine(getAiHealth())).toMatch(/Rate limited/);
    recordAiOk();
    recordAiFail({ status: 529, message: "overloaded_error" });
    expect(aiHealthLine(getAiHealth())).toMatch(/unavailable/);
  });

  it("counts a streak and goes quiet once a call succeeds again", () => {
    recordAiOk();
    recordAiFail({ status: 401, message: "nope" });
    recordAiFail({ status: 401, message: "nope" });
    expect(getAiHealth().failStreak).toBe(2);
    expect(aiHealthLine(getAiHealth())).toMatch(/2 in a row/);
    recordAiOk();
    expect(aiHealthLine(getAiHealth())).toBeNull();   // recovered → say nothing
    expect(getAiHealth().failStreak).toBe(0);
  });

  it("handles a thrown Error with no status", () => {
    recordAiOk();
    recordAiFail(new Error("fetch failed: ECONNREFUSED"));
    expect(aiHealthLine(getAiHealth())).toMatch(/Could not reach Anthropic/);
  });
});
