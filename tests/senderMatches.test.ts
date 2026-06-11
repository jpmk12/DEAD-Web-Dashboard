import { describe, it, expect } from "vitest";
import { senderMatches } from "@/lib/userPrefs";

// VIP/mute rule matching — load-bearing for email triage overrides and
// previously untested. A rule is a full email (exact match) or a bare domain
// (matches the domain and any subdomain).
describe("senderMatches", () => {
  it("matches a full-address rule exactly", () => {
    expect(senderMatches("boss@example.com", ["boss@example.com"])).toBe(true);
    expect(senderMatches("notboss@example.com", ["boss@example.com"])).toBe(false);
  });

  it("parses display-name angle-bracket From headers", () => {
    expect(senderMatches('Big Boss <boss@example.com>', ["boss@example.com"])).toBe(true);
    expect(senderMatches('"Boss, Big" <boss@example.com>', ["example.com"])).toBe(true);
  });

  it("is case-insensitive on both sides", () => {
    expect(senderMatches("Boss@Example.COM", ["boss@example.com"])).toBe(true);
    expect(senderMatches("boss@example.com", ["BOSS@EXAMPLE.COM"])).toBe(true);
  });

  it("bare-domain rule matches the domain and subdomains, not lookalikes", () => {
    expect(senderMatches("a@example.com", ["example.com"])).toBe(true);
    expect(senderMatches("a@mail.example.com", ["example.com"])).toBe(true);
    expect(senderMatches("a@notexample.com", ["example.com"])).toBe(false);
    expect(senderMatches("a@example.com.evil.io", ["example.com"])).toBe(false);
  });

  it("tolerates a leading @ on a domain rule", () => {
    expect(senderMatches("a@example.com", ["@example.com"])).toBe(true);
  });

  it("an email-address rule never falls back to domain matching", () => {
    expect(senderMatches("other@example.com", ["boss@example.com"])).toBe(false);
  });

  it("handles empty rules, blank rules, and non-email From values", () => {
    expect(senderMatches("a@example.com", [])).toBe(false);
    expect(senderMatches("a@example.com", ["", "  "])).toBe(false);
    expect(senderMatches("mailer-daemon", ["example.com"])).toBe(false);
  });
});
