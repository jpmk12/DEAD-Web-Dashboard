import { describe, it, expect } from "vitest";
import { commandBoard, type CommandInput, type CbPosture, type CbSitrep, type CbBoard } from "@/lib/commandBoard";
import { EMPTY_MUST_TRACK } from "@/lib/missionProfile";
import { parseRoomParam, roomParam, sameRoom, doorRoom, roomAor, roomSiblings, airfieldsByCommand, allFields, fieldWorst, commandFields } from "@/lib/room";

const posture = (p: Partial<CbPosture> & { id: string; country: string; aor: CbPosture["aor"] }): CbPosture => ({
  label: p.country, kind: "country", lat: 0, lon: 0, composite: "green", topDriver: "nothing notable", ...p,
});
const sitrep = (s: Partial<CbSitrep> & { icao: string; country: string; aor: CbSitrep["aor"] }): CbSitrep => ({
  label: s.icao, status: { wx: "g", ops: "g", threat: "g", infra: "g", spectrum: "g" }, driver: "all green", worse: [], ...s,
});
const board = (b: Partial<CbBoard> & { problemId: string; aor: CbBoard["aor"] }): CbBoard => ({
  label: `${b.aor} · X`, level: "calm", anomaly: 0, trajectory: "stable", learning: false, drivers: [], ...b,
});

const input: CommandInput = {
  nowMs: 0, sinceMs: 0,
  mustTrack: { ...EMPTY_MUST_TRACK, icaos: ["OJAQ", "EGUN"] }, // EGUN: ★ with no posture row and no coordinates — pinned strip only, command UNKNOWN
  ownFields: [
    { icao: "KWRI", label: "JB MDL", role: "hub", country: "United States", lat: 40, lon: -74.6 },
    { icao: "ETAD", label: "Spangdahlem", role: "spoke", country: "Germany", lat: 49.97, lon: 6.69 },
  ],
  posture: [
    posture({ id: "c1", country: "Germany", aor: "EUCOM", composite: "amber" }),
    posture({ id: "b1", country: "Germany", aor: "EUCOM", kind: "base", label: "Ramstein", icao: "ETAR", composite: "amber", topDriver: "TAF IFR" }),
    posture({ id: "b2", country: "Germany", aor: "EUCOM", kind: "base", label: "Spangdahlem", icao: "ETAD", composite: "green" }),
    posture({ id: "c2", country: "Russia", aor: "EUCOM", composite: "red" }),
    posture({ id: "b3", country: "Jordan", aor: "CENTCOM", kind: "base", label: "Azraq", icao: "OJAQ", composite: "amber" }),
    posture({ id: "b4", country: "United States", aor: "NORTHCOM", kind: "base", label: "JB MDL", icao: "KWRI", composite: "red" }),
  ],
  boards: [board({ problemId: "mp-ukr", aor: "EUCOM", label: "EUCOM · Ukraine" }), board({ problemId: "mp-iran", aor: "CENTCOM", label: "CENTCOM · Iran", level: "watch" })],
  sitreps: [
    sitrep({ icao: "ETAD", country: "Germany", aor: "EUCOM", status: { wx: "a", ops: "g", threat: "g", infra: "g", spectrum: "g" }, driver: "VFR → IFR", worse: ["wx"] }),
    sitrep({ icao: "KWRI", country: "United States", aor: "NORTHCOM", status: { wx: "g", ops: "r", threat: "g", infra: "g", spectrum: "g" }, driver: "RWY CLSD" }),
  ],
  demand: null, events: null, delta: null, alerts: null, crewMismatchAors: [],
};
const cb = commandBoard(input);

describe("room refs and params", () => {
  it("round-trips the three kinds and refuses junk", () => {
    expect(parseRoomParam("country:Germany")).toEqual({ kind: "country", id: "Germany" });
    expect(parseRoomParam("field:etar")).toEqual({ kind: "field", id: "ETAR" });
    expect(parseRoomParam("board:mp-iran")).toEqual({ kind: "board", id: "mp-iran" });
    expect(parseRoomParam("sitrep:ETAR")).toBeNull();
    expect(parseRoomParam("country:")).toBeNull();
    expect(parseRoomParam("")).toBeNull();
    expect(parseRoomParam(null)).toBeNull();
    expect(roomParam({ kind: "country", id: "United Kingdom" })).toBe("country:United Kingdom");
  });
  it("compares countries case-insensitively and everything else exactly", () => {
    expect(sameRoom({ kind: "country", id: "germany" }, { kind: "country", id: "Germany" })).toBe(true);
    expect(sameRoom({ kind: "field", id: "ETAR" }, { kind: "field", id: "ETAD" })).toBe(false);
    expect(sameRoom({ kind: "field", id: "ETAR" }, { kind: "country", id: "ETAR" })).toBe(false);
    expect(sameRoom(null, { kind: "field", id: "ETAR" })).toBe(false);
  });
  it("a primer door names its deepest level; a command-only door opens no room", () => {
    expect(doorRoom({ aor: "EUCOM", country: "Germany", icao: "etar" })).toEqual({ kind: "field", id: "ETAR" });
    expect(doorRoom({ aor: "EUCOM", problemId: "mp-ukr" })).toEqual({ kind: "board", id: "mp-ukr" });
    expect(doorRoom({ aor: "EUCOM", country: "Germany" })).toEqual({ kind: "country", id: "Germany" });
    expect(doorRoom({ aor: "EUCOM" })).toBeNull();
  });
});

describe("room siblings and command", () => {
  it("knows a subject's command, from the detail rows, the pinned strip or the boards", () => {
    expect(roomAor(cb, { kind: "country", id: "germany" })).toBe("EUCOM");
    expect(roomAor(cb, { kind: "field", id: "OJAQ" })).toBe("CENTCOM");
    expect(roomAor(cb, { kind: "board", id: "mp-iran" })).toBe("CENTCOM");
    expect(roomAor(cb, { kind: "country", id: "Narnia" })).toBeNull();
    // A METAR-only station with no coordinates has no command — never guessed.
    expect(roomAor(cb, { kind: "field", id: "EGUN" })).toBeNull();
  });
  it("‹ › walk the command's countries in board order and its fields hub › ★ › spokes › rest", () => {
    const cs = roomSiblings(cb, { kind: "country", id: "Germany" }).map((r) => r.id);
    expect(cs).toEqual(["Russia", "Germany"]); // worst first — the board's own order
    expect(roomSiblings(cb, { kind: "field", id: "ETAR" }).map((r) => r.id)).toEqual(["ETAD", "ETAR"]); // spoke before the plain field
    expect(roomSiblings(cb, { kind: "board", id: "mp-ukr" })).toEqual([{ kind: "board", id: "mp-ukr" }]);
    expect(roomSiblings(cb, { kind: "country", id: "Narnia" })).toEqual([]);
  });
});

describe("airfields by command (A′)", () => {
  it("lists every tracked field once, including a pinned-strip field no country row holds", () => {
    const icaos = allFields(cb).map((f) => f.icao).sort();
    expect(icaos).toEqual(["EGUN", "ETAD", "ETAR", "KWRI", "OJAQ"]);
  });
  it("reads a field's worst LED from its SITREP, else its posture, else UNKNOWN", () => {
    const by = Object.fromEntries(allFields(cb).map((f) => [f.icao, f]));
    expect(fieldWorst(by.KWRI)).toBe("r");   // ops LED
    expect(fieldWorst(by.ETAR)).toBe("a");   // posture only
    expect(fieldWorst(by.EGUN)).toBe("u");
  });
  it("groups by command, worst group first, UNKNOWN last, hub › ★ › spoke inside a group", () => {
    const g = airfieldsByCommand(cb);
    expect(g.map((x) => x.aor)).toEqual(["NORTHCOM", "EUCOM", "CENTCOM", "UNKNOWN"]);
    expect(g[0].worst?.icao).toBe("KWRI");
    expect(g[0].worstLed).toBe("r");
    expect(g.find((x) => x.aor === "EUCOM")!.fields.map((f) => f.icao)).toEqual(["ETAD", "ETAR"]);
    expect(g.find((x) => x.aor === "UNKNOWN")!.fields.map((f) => f.icao)).toEqual(["EGUN"]);
    expect(commandFields(cb, "CENTCOM").map((f) => f.icao)).toEqual(["OJAQ"]);
  });
});
