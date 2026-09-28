import { describe, it, expect } from "vitest";
import { deriveAvailability, postureAgainstDemand, postureOf, STALE_HOURS, type CrewRow } from "../lib/crewState";

const NOW = Date.parse("2026-09-28T12:00:00Z");
const row = (o: Partial<CrewRow> = {}): CrewRow => ({
  qual: "AC", label: "Aircraft commander", total: 8, crewRest: 2, onMission: 3, dnif: 0, other: 0,
  note: null, sort: 1, updatedBy: "do@example.com", updatedAt: new Date(NOW - 3_600_000).toISOString(), ...o,
});

describe("deriveAvailability — derived, never entered", () => {
  it("derives available from total minus outs, per row and overall", () => {
    const s = deriveAvailability([row(), row({ qual: "LM", total: 6, crewRest: 1, onMission: 1, sort: 2 })], NOW);
    expect(s.rows[0].available).toBe(3);
    expect(s.rows[1].available).toBe(4);
    expect(s.total).toBe(14);
    expect(s.available).toBe(7);
    expect(s.fraction).toBe(0.5);
    expect(s.line).toBe("7 of 14 crews available (3 crew rest, 4 on mission)");
  });

  it("flags a row whose outs exceed its total instead of clamping silently", () => {
    const s = deriveAvailability([row({ total: 2, crewRest: 2, onMission: 1 })], NOW);
    expect(s.rows[0].invalid).toBe(true);
    expect(s.rows[0].available).toBe(0);
    expect(s.invalid).toBe(true);
    expect(s.line).toMatch(/fix it/);
  });

  it("is stale after 24 h without an update, on the OLDEST row", () => {
    const fresh = deriveAvailability([row()], NOW);
    expect(fresh.stale).toBe(false);
    const old = deriveAvailability([row(), row({ qual: "LM", updatedAt: new Date(NOW - (STALE_HOURS + 1) * 3_600_000).toISOString() })], NOW);
    expect(old.stale).toBe(true);
  });

  it("has no line and unknown posture when nothing is declared", () => {
    const s = deriveAvailability([], NOW);
    expect(s.line).toBeNull();
    expect(postureOf(s.fraction)).toBe("unknown");
  });
});

describe("postureAgainstDemand — the sentence the north star asks for", () => {
  const thin = deriveAvailability([row({ total: 8, crewRest: 3, onMission: 3 })], NOW);   // 2/8
  const ok = deriveAvailability([row({ total: 8, crewRest: 1, onMission: 1 })], NOW);     // 6/8

  it("names a mismatch only when demand is rising against thin or critical crews", () => {
    const r = postureAgainstDemand(thin, [{ aor: "CENTCOM", direction: "rise", score: 40 }, { aor: "EUCOM", direction: "hold", score: 0 }], { CENTCOM: "USCENTCOM" });
    expect(r.lines[0].mismatch).toBe(true);
    expect(r.lines[0].line).toBe("USCENTCOM demand likely to RISE — 2 of 8 crews available (thin) ⚠ rising demand against thin crews");
    expect(r.lines[1].mismatch).toBe(false);
    expect(r.headline).toMatch(/mismatch/);
    const fine = postureAgainstDemand(ok, [{ aor: "CENTCOM", direction: "rise", score: 40 }]);
    expect(fine.lines[0].mismatch).toBe(false);
    expect(fine.headline).not.toMatch(/mismatch/);
  });

  it("says so when crew state is stale rather than presenting it as current", () => {
    const stale = deriveAvailability([row({ updatedAt: new Date(NOW - 3 * 86_400_000).toISOString() })], NOW);
    const r = postureAgainstDemand(stale, [{ aor: "CENTCOM", direction: "hold", score: 0 }]);
    expect(r.lines[0].line).toMatch(/last updated 3d ago, confirm/);
  });

  it("cannot judge without a declaration", () => {
    const r = postureAgainstDemand(deriveAvailability([], NOW), [{ aor: "CENTCOM", direction: "rise", score: 40 }]);
    expect(r.lines[0].posture).toBe("unknown");
    expect(r.headline).toMatch(/No crew state declared/);
  });
});
