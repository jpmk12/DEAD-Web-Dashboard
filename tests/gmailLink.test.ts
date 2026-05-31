import { describe, it, expect } from "vitest";
import { gmailMessageUrl } from "@/lib/gmailLink";

describe("gmailMessageUrl", () => {
  it("builds an authuser-scoped deep link to the message", () => {
    expect(gmailMessageUrl("18f0abc", "user@example.com")).toBe(
      "https://mail.google.com/mail/?authuser=user%40example.com#all/18f0abc"
    );
  });

  it("url-encodes + and @ in the account email", () => {
    expect(gmailMessageUrl("ID1", "a.b+tag@example.com")).toBe(
      "https://mail.google.com/mail/?authuser=a.b%2Btag%40example.com#all/ID1"
    );
  });

  it("returns null when the message id is missing", () => {
    expect(gmailMessageUrl("", "user@example.com")).toBeNull();
    expect(gmailMessageUrl(undefined, "user@example.com")).toBeNull();
  });

  // Bug fix: without an account email the link would fall back to the browser's
  // default account and open the WRONG mailbox — render no link instead.
  it("returns null when the account email is missing", () => {
    expect(gmailMessageUrl("ID1", "")).toBeNull();
    expect(gmailMessageUrl("ID1", undefined)).toBeNull();
  });
});
