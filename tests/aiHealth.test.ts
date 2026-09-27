import { describe, it, expect, afterEach } from "vitest";
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

describe("keyFormat", () => {
  const orig = process.env.ANTHROPIC_API_KEY;
  afterEach(() => { process.env.ANTHROPIC_API_KEY = orig; });

  it("flags the trailing-newline paste the hosting env UI is known to add", async () => {
    const { keyFormat } = await import("../lib/claude");
    process.env.ANTHROPIC_API_KEY = "sk-ant-abc123\n";
    expect(keyFormat()).toBe("whitespace");
    process.env.ANTHROPIC_API_KEY = " sk-ant-abc123 ";
    expect(keyFormat()).toBe("whitespace");
  });

  it("flags a wrong value and a missing one, and passes a clean key", async () => {
    const { keyFormat } = await import("../lib/claude");
    process.env.ANTHROPIC_API_KEY = "not-a-key";
    expect(keyFormat()).toBe("unexpected-prefix");
    process.env.ANTHROPIC_API_KEY = "   ";
    expect(keyFormat()).toBe("missing");
    process.env.ANTHROPIC_API_KEY = "sk-ant-api03-abc123";
    expect(keyFormat()).toBe("ok");
  });
});

describe("missing-key path", () => {
  const orig = process.env.ANTHROPIC_API_KEY;
  afterEach(() => { process.env.ANTHROPIC_API_KEY = orig; });

  it("records a health failure when the key is absent — the throw happens on property access, not on create", async () => {
    // Regression: the promise hook only fires for a call that was actually
    // made, so an absent key (the commonest failure) left the banner silent.
    const { anthropic } = await import("../lib/claude");
    const { recordAiOk, getAiHealth, aiHealthLine } = await import("../lib/aiHealth");
    recordAiOk();
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => anthropic.messages).toThrow(/not set/i);
    expect(getAiHealth().failStreak).toBeGreaterThan(0);
    expect(aiHealthLine(getAiHealth())).toBeTruthy();
  });
});
