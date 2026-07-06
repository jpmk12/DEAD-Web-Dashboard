import { describe, it, expect } from "vitest";
import { isAllowedEmail, parseEmailList, normEmail } from "../lib/allowlist";

describe("parseEmailList", () => {
  it("splits on commas/semicolons/whitespace, normalizes, drops junk", () => {
    expect(parseEmailList(" A@x.com, b@y.com ;c@z.com\nd@w.com ")).toEqual([
      "a@x.com", "b@y.com", "c@z.com", "d@w.com",
    ]);
    expect(parseEmailList("not-an-email, ,")).toEqual([]);
    expect(parseEmailList(undefined)).toEqual([]);
  });
});

describe("isAllowedEmail", () => {
  const OWNER = "jpmk12@gmail.com";
  const ALLOWED = "Denise.poole21@gmail.com";

  it("admits the owner and allowlisted crew, case-insensitively", () => {
    expect(isAllowedEmail("jpmk12@gmail.com", OWNER, ALLOWED)).toBe(true);
    expect(isAllowedEmail("JPMK12@GMAIL.COM", OWNER, ALLOWED)).toBe(true);
    expect(isAllowedEmail("denise.poole21@gmail.com", OWNER, ALLOWED)).toBe(true);
    expect(isAllowedEmail("Denise.Poole21@Gmail.com ", OWNER, ALLOWED)).toBe(true);
  });

  it("rejects everyone else, empty emails, and refuses all when no owner is set", () => {
    expect(isAllowedEmail("stranger@gmail.com", OWNER, ALLOWED)).toBe(false);
    expect(isAllowedEmail("", OWNER, ALLOWED)).toBe(false);
    expect(isAllowedEmail(null, OWNER, ALLOWED)).toBe(false);
    expect(isAllowedEmail("jpmk12@gmail.com", "", ALLOWED)).toBe(false);
    expect(isAllowedEmail("denise.poole21@gmail.com", undefined, ALLOWED)).toBe(false);
  });

  it("tolerates a trailing-newline env value (hosting UIs sneak them in)", () => {
    expect(isAllowedEmail("denise.poole21@gmail.com", OWNER, "denise.poole21@gmail.com\n")).toBe(true);
  });
});

describe("normEmail", () => {
  it("trims and lowercases", () => {
    expect(normEmail("  A@B.Com ")).toBe("a@b.com");
    expect(normEmail(null)).toBe("");
  });
});
