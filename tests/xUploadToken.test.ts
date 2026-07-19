import { describe, it, expect } from "vitest";
import { hashXToken, looksLikeXToken, newXToken } from "../lib/xUploadToken";

describe("X upload token — pure helpers", () => {
  it("newXToken produces a prefixed, high-entropy, valid-format token", () => {
    const t = newXToken();
    expect(t.startsWith("xcap_")).toBe(true);
    expect(looksLikeXToken(t)).toBe(true);
    expect(new Set([newXToken(), newXToken(), newXToken()]).size).toBe(3); // unique
  });

  it("hashXToken is deterministic, 64-hex (sha256), and hides the plaintext", () => {
    const t = "xcap_abcdefghijklmnopqrstuvwxyz012345";
    const h = hashXToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashXToken(t)).toBe(h);          // deterministic
    expect(h).not.toContain(t);             // not reversible / not embedded
    expect(hashXToken(t + "x")).not.toBe(h); // avalanche
  });

  it("looksLikeXToken rejects junk, wrong prefix, and too-short tokens", () => {
    expect(looksLikeXToken("")).toBe(false);
    expect(looksLikeXToken("bearer abc")).toBe(false);
    expect(looksLikeXToken("xcap_short")).toBe(false);
    expect(looksLikeXToken("nope_abcdefghijklmnopqrstuvwxyz012345")).toBe(false);
  });
});
