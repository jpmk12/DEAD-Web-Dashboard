import { describe, it, expect } from "vitest";
import { commandBoard, type CommandInput, type CbSitrep } from "../lib/commandBoard";
import { primer } from "../lib/primer";
import { findField, roomSiblings } from "../lib/room";
import { EMPTY_MUST_TRACK } from "../lib/missionProfile";

// The command board's QUICK tier (lib/commandsAssemble quickBodyFrom): only
// the declaration and the SITREP summaries, every team surface null. The pure
// join must still give My airfields and field rows the room can open — that
// is the whole point of answering before the posture / boards / demand land.

const sit = (icao: string, country: string, aor: CbSitrep["aor"]): CbSitrep => ({
  icao, label: icao, country, aor, status: { wx: "g", ops: "a", threat: "u", infra: "g", spectrum: "u" }, driver: "ops amber", worse: [],
});

const input: CommandInput = {
  nowMs: Date.UTC(2026, 10, 24), sinceMs: 0,
  mustTrack: { ...EMPTY_MUST_TRACK, icaos: ["ETAD"] },
  ownFields: [
    { icao: "OJMS", label: "Muwaffaq Salti", role: "hub", country: "Jordan", lat: 31.83, lon: 36.79 },
    { icao: "OKAS", label: "Ali Al Salem", role: "spoke", country: "Kuwait", lat: 29.35, lon: 47.52 },
  ],
  posture: null, boards: null, demand: null, events: null, delta: null, alerts: null, crewMismatchAors: [],
  sitreps: [sit("OJMS", "Jordan", "CENTCOM"), sit("ETAD", "Germany", "EUCOM"), sit("KWRI", "United States", "NORTHCOM")],
};

describe("command board quick tier", () => {
  const board = commandBoard(input);

  it("lists hub › spoke › ★ in My airfields, each with its SITREP when one exists", () => {
    expect(board.myFields.map((f) => f.icao)).toEqual(["OJMS", "OKAS", "ETAD"]);
    expect(board.myFields[0].role).toBe("hub");
    expect(board.myFields[0].hasSitrep).toBe(true);
    expect(board.myFields[1].hasSitrep).toBe(false);
    expect(board.myFields[2].star).toBe(true);
  });

  it("every SITREP base can be found for the room, under its command", () => {
    for (const icao of ["OJMS", "ETAD", "KWRI"]) expect(findField(board, icao)?.icao).toBe(icao);
    expect(findField(board, "ETAD")?.aor).toBe("EUCOM");
    expect(roomSiblings(board, { kind: "field", id: "OJMS" })).toBeTruthy();
  });

  it("marks the absent team surfaces as not answered, never as quiet sources", () => {
    expect(board.sources).toMatchObject({ posture: false, boards: false, demand: false, events: false, sitreps: true });
    const pr = primer({ ...input, convergence: null, decisionsDue: null, sourcesDown: [] });
    expect(Array.isArray(pr.items)).toBe(true);
  });
});
