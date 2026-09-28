import { describe, it, expect } from "vitest";
import {
  checkExpectations, subjectMatches, worthShowing, expectationLine, daysUntil,
  WATCH_WINDOW_DAYS,
} from "../lib/expectedDocs";
import type { DocExpectation, ObservedDoc } from "../lib/expectedDocs";

const TODAY = "2026-02-10";

const w2 = (over: Partial<DocExpectation> = {}): DocExpectation => ({
  id: "x1", label: "W-2 — employer", match: "W-2", byISO: "2026-01-31", ...over,
});

const obs = (subject: string, over: Partial<ObservedDoc> = {}): ObservedDoc =>
  ({ subject, date: "2026-01-20", ...over });

describe("subjectMatches", () => {
  it("is word-bounded and tolerates hyphenated forms", () => {
    expect(subjectMatches("Your 2025 W-2 is available", "W-2")).toBe(true);
    expect(subjectMatches("your w-2 form", "W-2")).toBe(true);
    expect(subjectMatches("W-20 update", "W-2")).toBe(false);
  });

  it("refuses a phrase too short to mean anything", () => {
    expect(subjectMatches("anything", "a")).toBe(false);
    expect(subjectMatches("", "W-2")).toBe(false);
  });

  it("treats regex metacharacters literally", () => {
    expect(subjectMatches("anything at all", ".*")).toBe(false);
    expect(subjectMatches("Form 1099-INT enclosed", "1099-INT")).toBe(true);
  });
});

describe("daysUntil", () => {
  it("is negative once past", () => {
    expect(daysUntil("2026-02-20", TODAY)).toBe(10);
    expect(daysUntil("2026-01-31", TODAY)).toBe(-10);
    expect(daysUntil("nope", TODAY)).toBeNull();
  });
});

describe("checkExpectations — a dead search must not accuse", () => {
  it("reports unknown, never missing, when no mail was observed", () => {
    // A false "missing" accuses a sender of not writing and sends the user
    // chasing a document they already have.
    const r = checkExpectations([w2()], [], TODAY);
    expect(r[0].status).toBe("unknown");
    expect(r[0].reason).toMatch(/no mail was scanned/);
  });

  it("reports overdue once mail WAS observed and none matched", () => {
    const r = checkExpectations([w2()], [obs("Your January statement")], TODAY);
    expect(r[0].status).toBe("overdue");
    expect(r[0].reason).toMatch(/10 days ago/);
  });
});

describe("checkExpectations — missing requires the date to have passed", () => {
  it("is pending, not overdue, before the by-date", () => {
    // A W-2 that has not arrived on 3 January is not a problem, it is January.
    const r = checkExpectations([w2({ byISO: "2026-02-28" })], [obs("Unrelated mail")], TODAY);
    expect(r[0].status).toBe("pending");
    expect(r[0].daysUntil).toBe(18);
  });

  it("marks arrival when a subject matches", () => {
    const r = checkExpectations([w2()], [obs("Your 2025 W-2 is available")], TODAY);
    expect(r[0].status).toBe("arrived");
    expect(r[0].matchedSubject).toBe("Your 2025 W-2 is available");
    expect(r[0].reason).toMatch(/arrived 2026-01-20/);
  });

  it("is unknown with an unusable by-date rather than assuming overdue", () => {
    const r = checkExpectations([w2({ byISO: "soon" })], [obs("something")], TODAY);
    expect(r[0].status).toBe("unknown");
    expect(r[0].reason).toMatch(/no usable expected-by date/);
  });
});

describe("checkExpectations — sender constraint", () => {
  it("requires the declared sender when one is given", () => {
    const e = w2({ fromPattern: "adp.com" });
    expect(checkExpectations([e], [obs("Your W-2 is ready", { from: "no-reply@adp.com" })], TODAY)[0].status).toBe("arrived");
    // Right phrase, wrong sender — a phishing mail must not satisfy an expectation.
    expect(checkExpectations([e], [obs("Your W-2 is ready", { from: "scam@elsewhere.ru" })], TODAY)[0].status).toBe("overdue");
  });

  it("accepts any sender when none is declared", () => {
    expect(checkExpectations([w2()], [obs("W-2 attached", { from: "whoever@x.com" })], TODAY)[0].status).toBe("arrived");
  });
});

describe("checkExpectations — hygiene and ordering", () => {
  it("skips a row with no label or no match phrase", () => {
    expect(checkExpectations([w2({ label: "  " })], [obs("x")], TODAY)).toEqual([]);
    expect(checkExpectations([w2({ match: "" })], [obs("x")], TODAY)).toEqual([]);
  });

  it("puts overdue first, then soonest pending, then unknown, then arrived", () => {
    const r = checkExpectations([
      w2({ id: "arr", label: "Arrived", match: "1099", byISO: "2026-02-01" }),
      w2({ id: "due", label: "Pending", match: "report card", byISO: "2026-02-15" }),
      w2({ id: "late", label: "Overdue", match: "W-2", byISO: "2026-01-31" }),
      w2({ id: "unk", label: "Unknown", match: "insurance card", byISO: "bad" }),
    ], [obs("Your 1099 is ready")], TODAY);
    expect(r.map((x) => x.expectation.id)).toEqual(["late", "due", "unk", "arr"]);
  });
});

describe("worthShowing", () => {
  it("hides what arrived and what is months away", () => {
    const r = checkExpectations([
      w2({ id: "arr", match: "1099", byISO: "2026-02-01" }),
      w2({ id: "far", match: "report card", byISO: "2026-09-01" }),
      w2({ id: "late", match: "W-2", byISO: "2026-01-31" }),
    ], [obs("Your 1099 is ready")], TODAY);
    expect(worthShowing(r).map((x) => x.expectation.id)).toEqual(["late"]);
  });

  it("shows a pending item once it is inside the watch window", () => {
    const soon = daysUntil("2026-02-20", TODAY);
    expect(soon).toBeLessThanOrEqual(WATCH_WINDOW_DAYS);
    const r = checkExpectations([w2({ match: "report card", byISO: "2026-02-20" })], [obs("x")], TODAY);
    expect(worthShowing(r)).toHaveLength(1);
  });
});

describe("expectationLine", () => {
  it("counts each state, and is null when clear", () => {
    const r = checkExpectations([
      w2({ id: "late", match: "W-2", byISO: "2026-01-31" }),
      w2({ id: "soon", match: "report card", byISO: "2026-02-15" }),
    ], [obs("nothing relevant")], TODAY);
    expect(expectationLine(r)).toBe("1 overdue · 1 due soon");
    expect(expectationLine([])).toBeNull();
  });
});
