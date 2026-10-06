import { describe, it, expect } from "vitest";
import { commandBoard, escalatedToday, type CommandInput, type CbPosture, type CbSitrep, type CbBoard } from "@/lib/commandBoard";
import { primer, doorLabel, type PrimerInput } from "@/lib/primer";
import { EMPTY_MUST_TRACK } from "@/lib/missionProfile";

const posture = (p: Partial<CbPosture> & { id: string; country: string; aor: CbPosture["aor"] }): CbPosture => ({
  label: p.country, kind: "country", lat: 0, lon: 0, composite: "green", topDriver: "nothing notable", ...p,
});
const sitrep = (s: Partial<CbSitrep> & { icao: string; country: string; aor: CbSitrep["aor"] }): CbSitrep => ({
  label: s.icao, status: { wx: "g", ops: "g", threat: "g", infra: "g", spectrum: "g" }, driver: "all green", worse: [], ...s,
});
const board = (b: Partial<CbBoard> & { problemId: string; aor: CbBoard["aor"] }): CbBoard => ({
  label: `${b.aor} · X`, level: "calm", anomaly: 0, trajectory: "stable", learning: false, drivers: [], ...b,
});

const base: CommandInput = {
  nowMs: Date.parse("2026-10-06T12:00:00Z"), sinceMs: Date.parse("2026-10-05T12:00:00Z"),
  mustTrack: { ...EMPTY_MUST_TRACK }, ownFields: [{ icao: "KWRI", label: "JB MDL", role: "hub", country: "United States", lat: 40.0, lon: -74.6 }],
  posture: [
    posture({ id: "c1", country: "Jordan", aor: "CENTCOM", composite: "red", previousComposite: "amber", topDriver: "Conflict within 207 km", chronicity: "new" }),
    posture({ id: "b1", country: "Jordan", aor: "CENTCOM", kind: "base", label: "Muwaffaq Salti", icao: "OJAQ", composite: "amber", topDriver: "TAF IFR" }),
    posture({ id: "c2", country: "Iraq", aor: "CENTCOM", composite: "green" }),
    posture({ id: "c3", country: "Ukraine", aor: "EUCOM", composite: "amber", chronicity: "chronic", topDriver: "Conflict" }),
    posture({ id: "b2", country: "United States", aor: "NORTHCOM", kind: "base", label: "JB MDL", icao: "KWRI", composite: "amber", topDriver: "NOTAM RWY closure" }),
  ],
  boards: [
    board({ problemId: "mp-iran", aor: "CENTCOM", label: "CENTCOM · Iran", level: "watch", anomaly: 0.31, trajectory: "deteriorating", drivers: ["conflict intensity"] }),
    board({ problemId: "mp-taiwan", aor: "INDOPACOM", label: "INDOPACOM · Taiwan", level: "alert", anomaly: 0.6, trajectory: "deteriorating" }),
    board({ problemId: "mp-ukr", aor: "EUCOM", label: "EUCOM · Ukraine", level: "warning", anomaly: 0.52, trajectory: "deteriorating" }),
  ],
  sitreps: [
    sitrep({ icao: "OJAQ", country: "Jordan", aor: "CENTCOM", status: { wx: "a", ops: "a", threat: "r", infra: "g", spectrum: "g" }, driver: "conflict 207 km", worse: ["threat"] }),
    sitrep({ icao: "KWRI", country: "United States", aor: "NORTHCOM", status: { wx: "g", ops: "a", threat: "g", infra: "g", spectrum: "g" }, driver: "RWY 06/24 closed" }),
  ],
  demand: [
    { aor: "EUCOM", direction: "rise", score: 31, confidence: "medium", line: "" },
    { aor: "CENTCOM", direction: "rise", score: 12, confidence: "low", line: "" },
    { aor: "NORTHCOM", direction: "hold", score: 4, confidence: "low", line: "" },
  ],
  events: [
    { id: "k1", kind: "kinetic", title: "Israel vs Hamas", aor: "CENTCOM", country: "Jordan", severity: "red", timeISO: "2026-10-06T08:00:00Z" },
    { id: "n1", kind: "neo", title: "Jordan — ordered departure", aor: "CENTCOM", country: "Jordan", severity: "red", timeISO: "2026-10-02T00:00:00Z" },
    { id: "k2", kind: "kinetic", title: "Mali", aor: "AFRICOM", country: "Mali", severity: "red", timeISO: null },
  ],
  delta: [
    { kind: "posture", id: "c:jordan", label: "Jordan", from: "amber", to: "red", direction: "worse", aor: "CENTCOM", country: "Jordan" },
    { kind: "sitrep", id: "OJAQ:threat", label: "OJAQ", axis: "threat", from: "a", to: "r", direction: "worse", aor: "CENTCOM", country: "Jordan", icao: "OJAQ" },
    { kind: "iw", id: "mp-ukr", label: "EUCOM · Ukraine", from: "warning", to: "watch", direction: "better", aor: "EUCOM" },
  ],
  alerts: [{ id: "force-Jordan-red", severity: "red", kind: "force", title: "Force protection RED — Jordan", sub: "", aor: "CENTCOM" }],
  crewMismatchAors: ["EUCOM"],
};

describe("commandBoard", () => {
  it("rolls every command into one row, worst first, with a why", () => {
    const b = commandBoard(base);
    expect(b.rows).toHaveLength(6);
    const c = b.rows.find((r) => r.aor === "CENTCOM")!;
    expect(c.posture).toMatchObject({ red: 1, amber: 1, green: 1, escalated: 1, worst: "red", watched: 3 });
    expect(c.iw).toMatchObject({ level: "watch", boards: 1 });
    expect(c.bases).toMatchObject({ count: 1, red: 1, worse: 1, worst: "r" });
    expect(c.events).toMatchObject({ total: 2, kinetic: 1, neo: 1, fresh: 1 });
    expect(c.delta).toEqual({ worse: 2, better: 0, fresh: 0 });
    expect(c.why).toContain("Jordan RED (escalated)");
    expect(c.why).toContain("OJAQ RED");
    expect(c.quiet).toBe(false);
    // The alert-level board outranks a red posture with no star anywhere.
    expect(b.rows[0].aor).toBe("CENTCOM");
    expect(b.rows.map((r) => r.aor).indexOf("INDOPACOM")).toBeLessThan(b.rows.map((r) => r.aor).indexOf("NORTHCOM"));
  });

  it("★ commands sort first regardless of level, and quiet commands are named not hidden", () => {
    const b = commandBoard({ ...base, mustTrack: { aors: ["SOUTHCOM"], countries: [], icaos: [] } });
    expect(b.rows[0].aor).toBe("SOUTHCOM");
    expect(b.rows[0].star).toBe(true);
    expect(b.rows[0].quiet).toBe(false);
    const africom = b.rows.find((r) => r.aor === "AFRICOM")!;
    expect(africom.quiet).toBe(true);
    expect(africom.why).toContain("nothing watched here");
  });

  it("UNKNOWN is counted as unknown and named, never folded into green", () => {
    const b = commandBoard({ ...base, posture: [posture({ id: "x", country: "Kenya", aor: "AFRICOM", composite: "unknown" })], boards: null, sitreps: [], delta: null, events: null, alerts: null, demand: null });
    const a = b.rows.find((r) => r.aor === "AFRICOM")!;
    expect(a.posture.unknown).toBe(1);
    expect(a.posture.worst).toBe("unknown");
    expect(a.why).toContain("UNKNOWN");
    expect(b.sources.posture).toBe(true);
    expect(b.sources.boards).toBe(false);
  });

  it("builds the drill: countries ★-first then worst, airfields under their country with SITREP joined", () => {
    const b = commandBoard({ ...base, mustTrack: { aors: [], countries: ["iraq"], icaos: ["OJAQ"] } });
    const d = b.details.CENTCOM;
    expect(d.boards.map((x) => x.problemId)).toEqual(["mp-iran"]);
    expect(d.countries.map((c) => c.country)).toEqual(["Iraq", "Jordan"]);   // ★ Iraq first despite green
    const jordan = d.countries[1];
    expect(jordan.worst).toBe("red");
    expect(jordan.escalated).toBe(true);
    expect(jordan.fields).toHaveLength(1);
    expect(jordan.fields[0]).toMatchObject({ icao: "OJAQ", star: true, hasSitrep: true });
    expect(jordan.fields[0].sitrep?.worse).toEqual(["threat"]);
    expect(jordan.delta).toEqual({ worse: 2, better: 0 });
    expect(jordan.events).toBe(2);
    expect(jordan.unwatched).toBe(false);
  });

  it("a ★ country with nothing watched is present and flagged, under the command the assembler classified", () => {
    const b = commandBoard({ ...base, mustTrack: { aors: [], countries: ["Taiwan"], icaos: [] }, countryAors: { taiwan: "INDOPACOM" } });
    const t = b.details.INDOPACOM.countries.find((c) => c.country === "Taiwan")!;
    expect(t.unwatched).toBe(true);
    expect(t.worst).toBeNull();
    expect(t.topDriver).toContain("not in the posture watch");
  });

  it("My airfields = hub, spokes, then ★ fields, deduped, each joined to posture + SITREP", () => {
    const b = commandBoard({ ...base, mustTrack: { aors: [], countries: [], icaos: ["OJAQ", "KWRI"] } });
    expect(b.myFields.map((f) => f.icao)).toEqual(["KWRI", "OJAQ"]);
    expect(b.myFields[0]).toMatchObject({ role: "hub", star: true, hasSitrep: true });
    expect(b.myFields[0].posture?.composite).toBe("amber");
    expect(b.myFields[1].aor).toBe("CENTCOM");
  });

  it("escalatedToday means the composite changed AND got worse", () => {
    expect(escalatedToday({ composite: "red", previousComposite: "amber" })).toBe(true);
    expect(escalatedToday({ composite: "amber", previousComposite: "red" })).toBe(false);
    expect(escalatedToday({ composite: "red" })).toBe(false);
  });
});

describe("primer", () => {
  const pin: PrimerInput = {
    ...base,
    convergence: [{ subject: "Hormuz", breadth: 3, kinds: ["iw", "feed", "economic"], aor: "CENTCOM", country: null }],
    decisionsDue: [{ problemId: "mp-iran", label: "CENTCOM · Iran", aor: "CENTCOM", call: "escalating", dueISO: "2026-10-06T00:00:00Z" }],
    sourcesDown: ["DAIP NOTAMs"],
  };

  it("ranks by tier — escalated red, then alert, then a worse red airfield, then warning↗, demand vs crews, forming, calls due", () => {
    const p = primer(pin, 10);
    expect(p.items.map((i) => i.key)).toEqual(["esc:c1", "alert:mp-taiwan", "worse:OJAQ", "warn:mp-ukr", "demand:EUCOM", "conv:Hormuz", "due:mp-iran"]);
    expect(p.items[0].door).toEqual({ aor: "CENTCOM", country: "Jordan", icao: undefined });
    expect(p.items[0].doorLabel).toBe("→ CENTCOM › Jordan");
    expect(p.items[1].doorLabel).toBe("→ INDOPACOM › board");
    expect(p.items[2].doorLabel).toBe("→ CENTCOM › Jordan › OJAQ");
    expect(p.items[0].note).toBe("not a must-track — consider ★");
    expect(p.footer).toContain("1 I&W call due");
    expect(p.footer).toContain("SOUTHCOM");
    expect(p.footer).toContain("absence of signal, not evidence of calm");
    expect(p.footer).toContain("DAIP NOTAMs");
  });

  it("★ breaks ties inside a tier and shows on the note", () => {
    const p = primer({ ...pin, mustTrack: { aors: ["EUCOM"], countries: [], icaos: ["OJAQ"] }, boards: [...(pin.boards ?? []), board({ problemId: "mp-b", aor: "EUCOM", label: "EUCOM · Belarus", level: "alert", anomaly: 0.7, trajectory: "stable" })] }, 10);
    const alerts = p.items.filter((i) => i.tier === 2);
    expect(alerts[0].key).toBe("alert:mp-b");         // ★ EUCOM first
    expect(alerts[0].note).toBe("★ must-track");
    expect(p.items.find((i) => i.key === "worse:OJAQ")!.note).toBe("★ must-track");
  });

  it("caps the list, never promotes a standing red, and says so when there is nothing", () => {
    const p = primer({ ...pin, posture: [posture({ id: "c", country: "Ukraine", aor: "EUCOM", composite: "red", chronicity: "chronic" })], boards: [], sitreps: [], demand: [], convergence: [], decisionsDue: [], delta: [] });
    expect(p.items).toHaveLength(0);
    expect(p.footer).toContain("nothing to drill into first");
    expect(p.quiet).not.toContain("EUCOM");       // a red is not quiet, even if it is not a primer item
    const capped = primer(pin, 2);
    expect(capped.items).toHaveLength(2);
  });

  it("doorLabel composes the path", () => {
    expect(doorLabel({ aor: "EUCOM" })).toBe("→ EUCOM");
    expect(doorLabel({ aor: "CENTCOM", problemId: "x" })).toBe("→ CENTCOM › board");
    expect(doorLabel({ aor: "CENTCOM", country: "Jordan", icao: "OJAQ" })).toBe("→ CENTCOM › Jordan › OJAQ");
  });
});
