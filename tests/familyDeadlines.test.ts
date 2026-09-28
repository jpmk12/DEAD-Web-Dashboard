import { describe, it, expect } from "vitest";
import {
  deadlineKey, daysUntil, toView, sortDeadlines, mergeDeadlines, rollup,
  DUE_SOON_DAYS, MAIL_WINDOW_DAYS,
} from "../lib/familyDeadlines";
import type { StoredDeadline, DeadlineView } from "../lib/familyDeadlines";
import type { FamilyDeadline } from "../lib/family";

const TODAY = "2026-09-28";
const NOW = Date.parse(`${TODAY}T12:00:00Z`);
const DAY = 86_400_000;

const TITLE = "Return the immunization form";

// id is DERIVED, never hardcoded: the store writes deadlineKey's output, so a
// literal here would silently drift from the real key and make every "known"
// row look new — which is how this fixture was wrong the first time.
const stored = (over: Partial<StoredDeadline> = {}): StoredDeadline => ({
  id: deadlineKey("m1", TITLE), title: TITLE,
  detail: "Buried in the spirit-week newsletter", dueISO: "2026-10-10",
  personId: "p1", sourceId: "m1", buried: true,
  firstSeen: new Date(NOW - 3 * DAY).toISOString(),
  lastSeen: new Date(NOW - 1 * DAY).toISOString(),
  state: "open", stateAt: null,
  ...over,
});

const fresh = (over: Partial<FamilyDeadline> = {}): FamilyDeadline => ({
  title: TITLE, detail: "From the newsletter",
  dueISO: "2026-10-10", personId: "p1", sourceId: "m1", buried: true,
  ...over,
});

describe("deadlineKey", () => {
  it("is stable across rewording of the same obligation", () => {
    // The model re-reads the same mail on every cache miss and may rephrase.
    // Keying on the raw title would create a duplicate row each time.
    expect(deadlineKey("m1", "Return the form!")).toBe(deadlineKey("m1", "return  the   form"));
    expect(deadlineKey("m1", "Return the Form.")).toBe(deadlineKey("m1", "Return the form"));
  });

  it("keeps two obligations in one newsletter distinct", () => {
    // Keying on the message alone would collapse them into one.
    expect(deadlineKey("m1", "Return the form")).not.toBe(deadlineKey("m1", "Pay the trip fee"));
  });

  it("separates the same obligation from different mails", () => {
    expect(deadlineKey("m1", "Return the form")).not.toBe(deadlineKey("m2", "Return the form"));
  });
});

describe("daysUntil", () => {
  it("counts whole days, negative when overdue", () => {
    expect(daysUntil("2026-10-05", TODAY)).toBe(7);
    expect(daysUntil(TODAY, TODAY)).toBe(0);
    expect(daysUntil("2026-09-20", TODAY)).toBe(-8);
  });

  it("returns null rather than 0 for a missing or malformed date", () => {
    // 0 would render as "due today", which is a guess.
    expect(daysUntil(null, TODAY)).toBeNull();
    expect(daysUntil("next Friday", TODAY)).toBeNull();
    expect(daysUntil("2026-9-5", TODAY)).toBeNull();
  });
});

describe("toView — an undated deadline can never lapse", () => {
  it("phases an undated open deadline as undated, not lapsed", () => {
    // familyDates deliberately refuses to resolve "next Friday". Calling such a
    // deadline overdue would invent the date the extractor declined to guess.
    const v = toView(stored({ dueISO: null }), TODAY, NOW);
    expect(v.phase).toBe("undated");
    expect(v.daysUntil).toBeNull();
  });

  it("phases by date otherwise", () => {
    expect(toView(stored({ dueISO: "2026-09-20" }), TODAY, NOW).phase).toBe("lapsed");
    expect(toView(stored({ dueISO: "2026-10-02" }), TODAY, NOW).phase).toBe("due-soon");
    expect(toView(stored({ dueISO: "2026-11-30" }), TODAY, NOW).phase).toBe("open");
    expect(daysUntil("2026-10-02", TODAY)).toBeLessThanOrEqual(DUE_SOON_DAYS);
  });

  it("lets a handled state win over any date", () => {
    expect(toView(stored({ dueISO: "2026-09-01", state: "done" }), TODAY, NOW).phase).toBe("done");
    expect(toView(stored({ dueISO: "2026-09-01", state: "dismissed" }), TODAY, NOW).phase).toBe("dismissed");
  });

  it("reports how long you have been sitting on it", () => {
    expect(toView(stored(), TODAY, NOW).ageDays).toBe(3);
  });

  it("flags when the app is the only thing that still remembers it", () => {
    // Past the mail window the source email is gone from the query result; the
    // stored row is all that is left, and the UI says so.
    const old = stored({ lastSeen: new Date(NOW - (MAIL_WINDOW_DAYS + 2) * DAY).toISOString() });
    expect(toView(old, TODAY, NOW).onlyRemembered).toBe(true);
    expect(toView(stored(), TODAY, NOW).onlyRemembered).toBe(false);
  });
});

describe("mergeDeadlines", () => {
  it("adds an unseen deadline as open", () => {
    const { upserts, refreshed } = mergeDeadlines([], [fresh()], new Date(NOW).toISOString());
    expect(upserts).toHaveLength(1);
    expect(upserts[0].state).toBe("open");
    expect(upserts[0].firstSeen).toBe(upserts[0].lastSeen);
    expect(refreshed).toEqual([]);
  });

  it("never resets lifecycle state on a re-extraction", () => {
    // Something marked done must not spring back to open just because the mail
    // is still inside the 14-day window.
    const done = stored({ state: "done", stateAt: new Date(NOW - DAY).toISOString() });
    const { upserts, refreshed } = mergeDeadlines([done], [fresh()], new Date(NOW).toISOString());
    expect(upserts[0].state).toBe("done");
    expect(upserts[0].stateAt).toBe(done.stateAt);
    expect(refreshed).toEqual([done.id]);
  });

  it("refreshes lastSeen and lets detail sharpen", () => {
    const prev = stored({ detail: "vague" });
    const { upserts } = mergeDeadlines([prev], [fresh({ detail: "clearer wording" })], new Date(NOW).toISOString());
    expect(upserts[0].detail).toBe("clearer wording");
    expect(upserts[0].lastSeen).toBe(new Date(NOW).toISOString());
    expect(upserts[0].firstSeen).toBe(prev.firstSeen);
  });

  it("never overwrites a date we already had with null", () => {
    // Losing a date would silently convert a lapsing deadline into an
    // unscoreable undated one — the exact failure this module prevents.
    const { upserts } = mergeDeadlines([stored({ dueISO: "2026-10-10" })], [fresh({ dueISO: null })]);
    expect(upserts[0].dueISO).toBe("2026-10-10");
  });

  it("accepts a date on a re-read when we had none", () => {
    const { upserts } = mergeDeadlines([stored({ dueISO: null })], [fresh({ dueISO: "2026-10-10" })]);
    expect(upserts[0].dueISO).toBe("2026-10-10");
  });

  it("skips a titleless extraction rather than storing a blank row", () => {
    expect(mergeDeadlines([], [fresh({ title: "   " })]).upserts).toEqual([]);
  });
});

describe("sortDeadlines", () => {
  it("puts lapsed first — the thing a cleaner design would have hidden", () => {
    const mk = (id: string, dueISO: string | null, state: StoredDeadline["state"] = "open"): DeadlineView =>
      toView(stored({ id, dueISO, state }), TODAY, NOW);
    const r = sortDeadlines([
      mk("open", "2026-11-30"),
      mk("done", "2026-10-01", "done"),
      mk("undated", null),
      mk("soon", "2026-10-01"),
      mk("lapsed", "2026-09-10"),
    ]);
    expect(r.map((v) => v.id)).toEqual(["lapsed", "soon", "open", "undated", "done"]);
  });
});

describe("rollup", () => {
  it("summarises what is outstanding", () => {
    const views = [
      toView(stored({ id: "a", dueISO: "2026-09-10" }), TODAY, NOW),
      toView(stored({ id: "b", dueISO: "2026-10-01" }), TODAY, NOW),
      toView(stored({ id: "c", dueISO: null }), TODAY, NOW),
    ];
    const r = rollup(views);
    expect(r.lapsed).toBe(1);
    expect(r.dueSoon).toBe(1);
    expect(r.undated).toBe(1);
    expect(r.line).toBe("1 past due · 1 due within 7 days · 1 with no date yet");
  });

  it("says nothing when nothing is outstanding", () => {
    const done = toView(stored({ state: "done" }), TODAY, NOW);
    expect(rollup([done]).line).toBeNull();
    expect(rollup([]).line).toBeNull();
  });
});
