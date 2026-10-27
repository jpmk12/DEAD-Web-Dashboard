import { describe, it, expect } from "vitest";
import {
  ANNOTATION_MAX_LEN, BOARD_KEY, annotationLines, latestOpenByTarget, recentlyResolved, sortAnnotations,
  validateAnnotationDraft, type Annotation,
} from "../lib/annotations";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-27T12:00:00Z");
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
const mk = (p: Partial<Annotation> & { id: string }): Annotation => ({
  problemId: "b1", indicatorId: null, note: `note ${p.id}`, by: "ops@example.com", createdAt: iso(1), resolvedAt: null, resolvedBy: null, ...p,
});

describe("validateAnnotationDraft", () => {
  it("requires a board and a note of a few words, and caps the length", () => {
    expect(validateAnnotationDraft({})).toMatch(/board/i);
    expect(validateAnnotationDraft({ problemId: "b1", note: "ok" })).toMatch(/few words/i);
    expect(validateAnnotationDraft({ problemId: "b1", note: "x".repeat(ANNOTATION_MAX_LEN + 1) })).toMatch(/under/i);
    expect(validateAnnotationDraft({ problemId: "b1", note: "known receiver outage this week" })).toBeNull();
    expect(validateAnnotationDraft({ problemId: "b1", indicatorId: "pnt_denial", note: "known receiver outage" })).toBeNull();
    expect(validateAnnotationDraft({ problemId: "b1", indicatorId: 5, note: "known receiver outage" })).toMatch(/string/i);
  });
});

describe("sorting and the latest open note per target", () => {
  const entries = [
    mk({ id: "old-open", createdAt: iso(5), indicatorId: "pnt_denial" }),
    mk({ id: "new-open", createdAt: iso(1), indicatorId: "pnt_denial" }),
    mk({ id: "board", createdAt: iso(2) }),
    mk({ id: "done", createdAt: iso(9), resolvedAt: iso(3), resolvedBy: "do@example.com", indicatorId: "pnt_denial" }),
    mk({ id: "done-old", createdAt: iso(40), resolvedAt: iso(30), resolvedBy: "do@example.com" }),
  ];
  it("puts open notes first, newest leading, then resolved by resolution time", () => {
    expect(sortAnnotations(entries).map((a) => a.id)).toEqual(["new-open", "board", "old-open", "done", "done-old"]);
  });
  it("keeps one open note per indicator — the newest — and the board's own under BOARD_KEY", () => {
    const m = latestOpenByTarget(entries);
    expect(m.get("pnt_denial")?.id).toBe("new-open");
    expect(m.get(BOARD_KEY)?.id).toBe("board");
    expect(m.size).toBe(2);
  });
  it("recently resolved keeps the last 14 days only", () => {
    expect(recentlyResolved(entries, NOW).map((a) => a.id)).toEqual(["done"]);
  });
});

describe("annotationLines (the Ask pack)", () => {
  it("labels the target, names the author and age, marks resolved ones, and caps", () => {
    const entries = [
      mk({ id: "a", indicatorId: "pnt_denial", note: "GPSJam gap is a known receiver outage, not jamming", createdAt: iso(0) }),
      mk({ id: "b", note: "exercise window Tue–Thu; expect lift", createdAt: iso(2), by: "do@example.com" }),
      mk({ id: "c", indicatorId: "conflict_intensity", note: "was a one-day spike", createdAt: iso(6), resolvedAt: iso(4), resolvedBy: "ops@example.com" }),
    ];
    const lines = annotationLines(entries, (id) => id.toUpperCase(), NOW);
    expect(lines[0]).toBe('- [PNT_DENIAL] "GPSJam gap is a known receiver outage, not jamming" — ops, today');
    expect(lines[1]).toBe('- [whole board] "exercise window Tue–Thu; expect lift" — do, 2 d ago');
    expect(lines[2]).toBe('- (resolved 4 d ago) [CONFLICT_INTENSITY] "was a one-day spike"');
    expect(annotationLines([], (id) => id, NOW)).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => mk({ id: `n${i}`, createdAt: iso(i) }));
    expect(annotationLines(many, (id) => id, NOW, 5)).toHaveLength(5);
  });
});
