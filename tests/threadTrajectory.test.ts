import { describe, it, expect } from "vitest";
import { threadRun, sparkCells, threadDiff, throughLineDiff, splitAmc, threadDoors, movingGroups, threadDocMarkdown } from "../lib/threadTrajectory";
import type { LabelOccurrence, LabelSummary } from "../lib/threadHistory";
import { parseThreadTrace } from "../lib/threadTrace";

const occ = (date: string, trend: LabelOccurrence["trend"]): LabelOccurrence => ({ date, trend, headline: "h", sessionId: 1 });

describe("threadRun", () => {
  it("a single occurrence is new today", () => {
    expect(threadRun([occ("2026-10-05", "rising")])).toMatchObject({ days: 1, label: "new today", isNew: true });
  });
  it("counts consecutive sessions with the same trend", () => {
    const r = threadRun([occ("2026-10-03", "rising"), occ("2026-10-04", "rising"), occ("2026-10-05", "rising")]);
    expect(r).toMatchObject({ trend: "rising", days: 3, label: "3rd day" });
  });
  it("a trend change today is the first day of the new run", () => {
    expect(threadRun([occ("2026-10-04", "stable"), occ("2026-10-05", "rising")]).label).toBe("1st day rising");
  });
  it("a gap of two or more days reads as re-emerging", () => {
    const r = threadRun([occ("2026-09-17", "fading"), occ("2026-10-05", "rising")]);
    expect(r.reemerging).toBe(true);
    expect(r.label).toBe("back after 18 d");
  });
  it("no history says so, never a guessed run", () => {
    expect(threadRun([], "rising")).toMatchObject({ days: 0, label: "no history" });
  });
});

describe("sparkCells", () => {
  it("one cell per calendar day, null where no session ran", () => {
    const cells = sparkCells([occ("2026-10-05", "rising"), occ("2026-10-03", "stable")], "2026-10-05", 4);
    expect(cells).toEqual([null, "stable", null, "rising"]);
  });
});

describe("threadDiff / throughLineDiff", () => {
  it("names the sources added and the trend move", () => {
    const d = threadDiff({ trend: "rising", sources: ["Foreign Affairs", "Task & Purpose"], headline: "x" }, { trend: "stable", sources: ["Foreign Affairs"], headline: "y" });
    expect(d).toBe("Previously read stable on 1 source; today adds Task & Purpose, moves to rising.");
  });
  it("says so when there is no previous thread", () => {
    expect(threadDiff({ trend: "rising", sources: [], headline: "x" }, null)).toBe("Not on the previous board.");
  });
  it("the through-line diff lists new, moved, unchanged and dropped", () => {
    const line = throughLineDiff(
      [{ label: "IRAN WAR", trend: "rising" }, { label: "BAB EL-MANDEB", trend: "rising" }, { label: "UKRAINE", trend: "stable" }],
      { date: "2026-10-04", threads: [{ label: "IRAN WAR", trend: "stable" }, { label: "UKRAINE", trend: "stable" }, { label: "GOLDEN DOME", trend: "fading" }] as never },
    );
    expect(line).toBe("vs 2026-10-04: BAB EL-MANDEB is NEW; IRAN WAR stable → rising; 1 unchanged; GOLDEN DOME dropped.");
    expect(throughLineDiff([], null)).toBeNull();
  });
});

describe("splitAmc", () => {
  it("prefers an explicit amc field", () => {
    expect(splitAmc("A. B.", "For AMC: lift.")).toEqual({ body: "A. B.", amc: "For AMC: lift." });
  });
  it("otherwise lifts the last sentence that names mobility", () => {
    const s = "Pay rose. Foreign Affairs frames the logic. For CENTCOM mobility, this means enduring rotational lift demand.";
    const r = splitAmc(s);
    expect(r.amc).toMatch(/^For CENTCOM mobility/);
    expect(r.body).toBe("Pay rose. Foreign Affairs frames the logic.");
  });
  it("never lifts the only sentence", () => {
    expect(splitAmc("Airlift demand rises.").amc).toBeNull();
  });
});

describe("threadDoors", () => {
  it("matches a board by its label words and a chokepoint by keyword, capped", () => {
    const doors = threadDoors(
      { label: "BAB EL-MANDEB", headline: "Yemeni forces seize Bab el-Mandeb", summary: "Red Sea routing changes for Iran's proxy." },
      [{ problemId: "mp-iran", label: "CENTCOM · Iran", level: "watch", trajectory: "deteriorating" }, { problemId: "mp-tw", label: "INDOPACOM · Taiwan", level: "calm", trajectory: "stable" }],
      [{ id: "babelmandeb", name: "Bab-el-Mandeb / Red Sea", keywords: ["bab el mandeb", "red sea"] }, { id: "hormuz", name: "Strait of Hormuz", keywords: ["hormuz"] }],
    );
    expect(doors.map((d) => d.id)).toEqual(["mp-iran", "babelmandeb"]);
  });
  it("a command name alone never opens a board", () => {
    expect(threadDoors({ label: "CENTCOM", headline: "x", summary: "y" }, [{ problemId: "a", label: "CENTCOM · Iran", level: "calm", trajectory: "stable" }], [])).toEqual([]);
  });
});

describe("movingGroups", () => {
  const ls = (label: string, o: Partial<LabelSummary>): LabelSummary => ({ label, occurrences: 3, lastSeen: "2026-10-05", lastTrend: "stable", trajectoryScore: 0, trendSparkline: "", isSustainedEscalation: false, isRemerging: false, ...o });
  it("orders sustained → rising → re-emerging → steady → fading and drops empty groups", () => {
    const g = movingGroups([
      ls("UKRAINE", { lastTrend: "stable" }),
      ls("IRAN WAR", { lastTrend: "rising", isSustainedEscalation: true }),
      ls("EU-CHINA", { lastTrend: "rising", isRemerging: true }),
      ls("ARSENAL", { lastTrend: "rising", trajectoryScore: 1 }),
      ls("FORCE SHAPING", { lastTrend: "fading" }),
    ]);
    expect(g.map((x) => `${x.key}:${x.labels.map((l) => l.label).join("|")}`)).toEqual([
      "sustained:IRAN WAR", "rising:ARSENAL", "reemerging:EU-CHINA", "steady:UKRAINE", "fading:FORCE SHAPING",
    ]);
  });
});

describe("threadDocMarkdown", () => {
  const th = { label: "IRAN WAR", headline: "Combat pay raised", summary: "Pay rose.", trend: "rising" as const, sources: ["Task & Purpose"] };
  it("creates a thread doc with a Trace the Docs tab can parse after two days", () => {
    const d1 = threadDocMarkdown(th, "2026-10-04");
    expect(d1).toMatch(/^# Thread: IRAN WAR/);
    const d2 = threadDocMarkdown({ ...th, headline: "Forever war framing", summary: "FA frames it." }, "2026-10-05", d1);
    const trace = parseThreadTrace(d2);
    expect(trace?.stops.map((s) => s.gloss.slice(0, 10))).toEqual(["2026-10-04", "2026-10-05"]);
    expect(d2).toMatch(/## Latest\n\n\*\*Forever war framing\*\*/);
    expect(d2).not.toMatch(/Combat pay raised\*\*/);
  });
  it("re-saving the same day replaces that day's stop instead of duplicating it", () => {
    const d1 = threadDocMarkdown(th, "2026-10-05");
    const d2 = threadDocMarkdown({ ...th, headline: "Revised" }, "2026-10-05", d1);
    expect((d2.match(/2026-10-05 —/g) ?? []).length).toBe(1);
    expect(d2).toMatch(/1\. 2026-10-05 — ↑ rising — Revised/);
  });
});
