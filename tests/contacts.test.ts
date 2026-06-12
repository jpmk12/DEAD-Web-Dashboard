import { describe, it, expect } from "vitest";
import { contactStatus, sortByDue } from "@/lib/contacts";

const c = (lastContacted: string | null, cadenceDays: number, name = "X") => ({ lastContacted, cadenceDays, name });

describe("contactStatus", () => {
  it("never-contacted is its own most-urgent state", () => {
    expect(contactStatus(c(null, 90), "2026-06-12")).toEqual({ nextDue: null, daysUntil: null, state: "never" });
  });

  it("computes next due = last + cadence", () => {
    const s = contactStatus(c("2026-05-13", 30), "2026-06-12");
    expect(s.nextDue).toBe("2026-06-12");
    expect(s.daysUntil).toBe(0);
    expect(s.state).toBe("due");
  });

  it("flags overdue with a negative daysUntil", () => {
    const s = contactStatus(c("2026-01-01", 90), "2026-06-12");
    expect(s.daysUntil).toBeLessThan(0);
    expect(s.state).toBe("overdue");
  });

  it("classifies soon (≤7d out) vs fresh precisely", () => {
    // last 2026-06-12, cadence 5 → next 06-17, 5 days out → soon
    expect(contactStatus(c("2026-06-12", 5), "2026-06-12").state).toBe("soon");
    // cadence 30 → next 07-12, 30 days out → fresh
    expect(contactStatus(c("2026-06-12", 30), "2026-06-12").state).toBe("fresh");
  });

  it("guards a zero/negative cadence to at least 1 day", () => {
    // cadence floored to 1 → next 06-13; on 06-15 that's 2 days overdue
    expect(contactStatus(c("2026-06-12", 0), "2026-06-15").state).toBe("overdue");
  });
});

describe("sortByDue", () => {
  it("orders never → most-overdue → soonest → fresh", () => {
    const list = [
      c("2026-06-12", 30, "fresh"),     // due 07-12 (fresh)
      c("2026-01-01", 90, "overdue"),   // long overdue
      c(null, 90, "never"),             // never
      c("2026-06-10", 5, "soon"),       // due 06-15 (soon)
    ];
    expect(sortByDue(list, "2026-06-12").map((x) => x.name)).toEqual(["never", "overdue", "soon", "fresh"]);
  });

  it("does not mutate the input array", () => {
    const list = [c("2026-01-01", 90, "b"), c(null, 90, "a")];
    const copy = [...list];
    sortByDue(list, "2026-06-12");
    expect(list).toEqual(copy);
  });
});
