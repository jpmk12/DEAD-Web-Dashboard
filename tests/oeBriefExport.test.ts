import { describe, it, expect } from "vitest";
import { renderOeBriefHtml, oeBriefFilename } from "../lib/oeBriefExport";
import type { OeSnapshot } from "../lib/oeContextFormat";
import type { DecisionEntry } from "../lib/decisionLog";

const snap: OeSnapshot = {
  atISO: "2026-09-28T14:05:00Z",
  force: [
    { label: "Iraq", composite: "red", topDriver: "Conflict — <strikes> near Erbil", cocom: "CENTCOM", chronicity: "chronic 12/14d", escalated: true },
    { label: "Qatar", composite: "green", topDriver: "quiet" },
    { label: "Jordan", composite: "unknown", topDriver: "feeds down" },
  ],
  sitrep: [{ icao: "KWRI", label: "McGuire", status: { wx: "g", ops: "a", threat: "g", infra: "u" }, driver: "RWY 06/24 closed", worse: ["ops"] }],
  boards: [{ problemId: "mp-1", label: "CENTCOM · Iran", level: "warning", anomaly: 0.42, trajectory: "deteriorating", learning: false, drivers: ["escalatory rhetoric"] }],
  alerts: [{ severity: "red", title: "Force protection RED — Iraq", sub: "Conflict" }],
  delta: { line: "1 worse", worse: ["Iraq amber→red"], better: [], fresh: [] },
  decisionsDue: [],
  demand: [{ aor: "CENTCOM", direction: "rise", score: 64, confidence: "high", line: "CENTCOM: demand likely to RISE over 7 days (+64, high confidence) — I&W CENTCOM · Iran WARNING, deteriorating" }],
};

const decision: DecisionEntry = {
  id: "d1", problemId: "mp-1", indicatorId: null, call: "escalating", expectation: "Strikes on <Erbil> within 7 days",
  horizonDays: 7, createdAt: "2026-09-20T00:00:00Z", dueAt: "2026-09-27T00:00:00Z", outcome: null, scoredAt: null, scoreNote: null, by: "cmdr@example.com",
};

const html = renderOeBriefHtml({ snapshot: snap, openDecisions: [decision], preparedBy: "cmdr@example.com", missionSummary: "AO: CENTCOM" });

describe("renderOeBriefHtml", () => {
  it("is self-contained: no scripts, no external resources", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/src="http/i);
    expect(html).not.toMatch(/href="http/i);
    expect(html).not.toMatch(/@import/);
  });

  it("escapes every dynamic string", () => {
    expect(html).not.toMatch(/<strikes>/);
    expect(html).toMatch(/&lt;strikes&gt;/);
    expect(html).not.toMatch(/<Erbil>/);
  });

  it("stamps the snapshot as not live", () => {
    expect(html).toMatch(/SNAPSHOT AS OF 2026-09-28 14:05Z — NOT LIVE/);
  });

  it("leads with a BLUF that counts reds, boards, rising demand and changes", () => {
    expect(html).toMatch(/1 location at force-protection RED/);
    expect(html).toMatch(/1 UNKNOWN \(feed gap, not clear\)/);
    expect(html).toMatch(/1 I&amp;W board at WARNING\/ALERT/);
    expect(html).toMatch(/demand likely to rise in USCENTCOM|demand likely to rise in CENTCOM/);
    expect(html).toMatch(/1 level change since last look/);
  });

  it("lists elevated posture, counts greens, and keeps unknown visible", () => {
    expect(html).toMatch(/Iraq/);
    expect(html).toMatch(/1 green \(not listed\)/);
    expect(html).toMatch(/Jordan[\s\S]*UNKNOWN/);
  });

  it("marks an unavailable surface as UNAVAILABLE, never omits it", () => {
    const h = renderOeBriefHtml({ snapshot: { ...snap, force: null, demand: null }, openDecisions: [], preparedBy: "x" });
    expect(h).toMatch(/Force posture — UNAVAILABLE/);
    expect(h).toMatch(/Demand horizon — UNAVAILABLE/);
  });

  it("names the board on an open call, flags it DUE when past, and strips the email domain", () => {
    expect(html).toMatch(/CENTCOM · Iran<\/td><td>Escalating|CENTCOM · Iran<\/td><td>/);
    expect(html).toMatch(/2026-09-27 · DUE/);
    expect(html).toMatch(/>cmdr</);
    expect(html).not.toMatch(/cmdr@example\.com<\/td>/);
  });

  it("builds a sortable filename from the stamp", () => {
    expect(oeBriefFilename(snap.atISO)).toBe("OE-BRIEF-20260928-1405Z.html");
  });
});
