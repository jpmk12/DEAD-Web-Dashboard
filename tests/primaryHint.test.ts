import { describe, it, expect } from "vitest";
import { normalizeHint, primaryAuthParams, pickHint, NO_HINT } from "../lib/primaryHint";

describe("normalizeHint", () => {
  it("lowercases and trims an email", () => {
    expect(normalizeHint("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
  });
  it("rejects non-emails, empties, the none sentinel and non-strings", () => {
    expect(normalizeHint("")).toBeNull();
    expect(normalizeHint(NO_HINT)).toBeNull();
    expect(normalizeHint("not an email")).toBeNull();
    expect(normalizeHint("a@b")).toBeNull();
    expect(normalizeHint(42)).toBeNull();
    expect(normalizeHint(undefined)).toBeNull();
    expect(normalizeHint(`${"x".repeat(250)}@example.com`)).toBeNull();
  });
});

describe("primaryAuthParams", () => {
  it("names the account when a hint exists — and still asks consent for a refresh token", () => {
    expect(primaryAuthParams("Owner@Example.com")).toEqual({ login_hint: "owner@example.com", prompt: "consent" });
  });
  it("forces the chooser when there is no hint — never a silent default", () => {
    expect(primaryAuthParams(null)).toEqual({ prompt: "select_account consent" });
    expect(primaryAuthParams(NO_HINT)).toEqual({ prompt: "select_account consent" });
    expect(primaryAuthParams("garbage")).toEqual({ prompt: "select_account consent" });
  });
});

describe("pickHint", () => {
  it("URL param beats cookie, invalid candidates are skipped", () => {
    expect(pickHint("x", "a@example.com", "b@example.com")).toBe("a@example.com");
    expect(pickHint(undefined, "b@example.com")).toBe("b@example.com");
    expect(pickHint(NO_HINT, "b@example.com")).toBe("b@example.com");
    expect(pickHint()).toBeNull();
  });
});
