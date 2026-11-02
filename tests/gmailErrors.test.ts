import { describe, it, expect } from "vitest";
import { gmailFailure, isGmailRateLimit } from "../lib/gmailErrors";

describe("gmailFailure", () => {
  it("429 and a 403 with a rate reason are both the rate limit", () => {
    expect(gmailFailure({ code: 429 }).cls).toBe("rate");
    expect(gmailFailure({ code: 403, errors: [{ reason: "userRateLimitExceeded" }] }).cls).toBe("rate");
    expect(isGmailRateLimit({ response: { status: 403, data: { error: { errors: [{ reason: "rateLimitExceeded" }] } } } })).toBe(true);
  });
  it("401 / a permission 403 is the account, never the rate limit", () => {
    expect(gmailFailure({ code: 401 }).cls).toBe("auth");
    expect(gmailFailure({ code: 403, errors: [{ reason: "insufficientPermissions" }] }).cls).toBe("auth");
    expect(isGmailRateLimit({ code: 401 })).toBe(false);
  });
  it("anything else names the status; no status reads unreachable; the raw message is never repeated", () => {
    const f = gmailFailure({ code: 500, message: "req id abc123 at host x" });
    expect(f).toEqual({ cls: "other", reason: "Gmail error 500" });
    expect(gmailFailure(new Error("socket hang up")).reason).toBe("Gmail unreachable");
    expect(gmailFailure(undefined).cls).toBe("other");
  });
});
