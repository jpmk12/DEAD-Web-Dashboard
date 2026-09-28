import { describe, it, expect } from "vitest";
import { scanJeopardy, hasPhrase, isSuppressed, jeopardyLine } from "../lib/accountJeopardy";
import type { JeopardySource } from "../lib/accountJeopardy";

const src = (text: string, over: Partial<JeopardySource> = {}): JeopardySource => ({
  id: "m1", label: "Electric — Xcel", text, seenDate: "2026-09-27", ...over,
});

describe("hasPhrase", () => {
  it("is word-bounded but tolerates surrounding punctuation", () => {
    expect(hasPhrase("Your balance is past due.", "past due")).toBe(true);
    expect(hasPhrase("(final notice)", "final notice")).toBe(true);
    expect(hasPhrase("pastdueness", "past due")).toBe(false);
  });

  it("is case-insensitive and safe against regex metacharacters", () => {
    expect(hasPhrase("PAYMENT DECLINED", "payment declined")).toBe(true);
    expect(hasPhrase("anything", "a.*")).toBe(false);
  });

  it("handles empty input", () => {
    expect(hasPhrase("", "past due")).toBe(false);
    expect(hasPhrase("past due", "")).toBe(false);
  });
});

describe("suppressors run first", () => {
  it("ignores a receipt that merely contains the vocabulary", () => {
    // Every bill contains "payment". A panel that fires on a receipt gets
    // switched off, and then every real alert is missed too.
    expect(isSuppressed("Thank you for your payment — payment received")).toBe(true);
    expect(scanJeopardy([src("Thank you for your payment. No action is required.")])).toEqual([]);
  });

  it("ignores marketing that describes the risk it prevents", () => {
    expect(scanJeopardy([src("Enroll in autopay to avoid a late payment and avoid disconnection")])).toEqual([]);
    expect(scanJeopardy([src("You have no past due balance at this time")])).toEqual([]);
    expect(scanJeopardy([src("If your payment fails we will retry in three days")])).toEqual([]);
  });

  it("still reports a genuine failure", () => {
    const r = scanJeopardy([src("Your payment was declined — please update your card")]);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("payment-failed");
    expect(r[0].phrase).toBe("payment was declined");
    expect(r[0].severity).toBe("red");
  });
});

describe("scanJeopardy", () => {
  it("never fires on a single generic word", () => {
    // Phrases only — "payment", "due" and "notice" alone carry no information.
    expect(scanJeopardy([src("Your payment is scheduled")])).toEqual([]);
    expect(scanJeopardy([src("Your statement is ready — amount due $84.10")])).toEqual([]);
    expect(scanJeopardy([src("Notice: your bill is available online")])).toEqual([]);
  });

  it("reports at most one finding per message, the worst one", () => {
    // A declined payment that also says "past due" is one problem; listing it
    // twice would make the panel look busier than the situation is.
    const r = scanJeopardy([src("Final notice: your payment failed and the balance is past due")]);
    expect(r).toHaveLength(1);
    expect(r[0].severity).toBe("red");
    expect(r[0].kind).toBe("payment-failed");   // outranks final-notice and past-due
  });

  it("detects each category", () => {
    const cases: [string, string][] = [
      ["Your policy will lapse on 1 October", "lapse"],
      ["Service will be suspended in 5 days", "suspension"],
      ["Returned for insufficient funds", "insufficient-funds"],
      ["Final notice before collections", "final-notice"],
      ["Your account is past due", "past-due"],
      ["We detected suspicious activity", "fraud"],
    ];
    for (const [text, kind] of cases) {
      const r = scanJeopardy([src(text)]);
      expect(r[0]?.kind, text).toBe(kind);
    }
  });

  it("ranks red before amber, then newest", () => {
    const r = scanJeopardy([
      src("Your account is past due", { id: "a", seenDate: "2026-09-27" }),
      src("Your payment was declined", { id: "b", seenDate: "2026-09-20" }),
      src("Disconnection notice", { id: "c", seenDate: "2026-09-26" }),
    ]);
    expect(r.map((f) => f.sourceId)).toEqual(["c", "b", "a"]);
  });

  it("skips blank text and caps the list", () => {
    expect(scanJeopardy([src("   ")])).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => src("payment was declined", { id: `m${i}` }));
    expect(scanJeopardy(many)).toHaveLength(8);
    expect(scanJeopardy(many, { max: 2 })).toHaveLength(2);
  });
});

describe("jeopardyLine", () => {
  it("separates act-now from merely late, and never claims all clear", () => {
    const red = scanJeopardy([src("payment was declined")]);
    expect(jeopardyLine(red)).toBe("1 needing action now");
    const mixed = scanJeopardy([src("payment was declined", { id: "a" }), src("past due", { id: "b" })]);
    expect(jeopardyLine(mixed)).toBe("1 needing action now · 1 late");
    // Null, not "all clear": the scan only sees senders the user declared.
    expect(jeopardyLine([])).toBeNull();
  });
});
