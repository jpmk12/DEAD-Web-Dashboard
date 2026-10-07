// The room — ONE detail surface for the command board (REVIEW-2026-10 §11,
// recommendation C + A′ + C′). PURE, client-safe, unit-tested.
//
// A room shows one subject: a country (the situation room), an airfield (the
// SITREP) or an I&W board. The board page is lists; every row is a DOOR into
// the room, and the room never reflows the page behind it. What lives here is
// the arithmetic the drawer needs and nothing React: which subject a door
// names, the URL form (`?room=country:Germany`), the neighbours ‹ › walks
// (the command's countries / fields / boards in board order), and the command
// a subject belongs to (the map follows it).

import type { Aor } from "./aor";
import type { CommandBoard, FieldRow, CountryRow } from "./commandBoard";
import type { PrimerDoor } from "./primer";

export type RoomKind = "country" | "field" | "board";

export interface RoomRef {
  kind: RoomKind;
  /** Country display name · ICAO · problem id. */
  id: string;
}

const KINDS: RoomKind[] = ["country", "field", "board"];
const lc = (s: string) => s.trim().toLowerCase();

/** `country:Germany` · `field:ETAR` · `board:mp-iran` → a ref, else null. */
export function parseRoomParam(raw: string | null | undefined): RoomRef | null {
  const s = (raw ?? "").trim();
  const ix = s.indexOf(":");
  if (ix <= 0) return null;
  const kind = s.slice(0, ix) as RoomKind;
  const id = s.slice(ix + 1).trim().slice(0, 120);
  if (!KINDS.includes(kind) || !id) return null;
  return { kind, id: kind === "field" ? id.toUpperCase() : id };
}

export function roomParam(ref: RoomRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function sameRoom(a: RoomRef | null | undefined, b: RoomRef | null | undefined): boolean {
  if (!a || !b) return false;
  return a.kind === b.kind && (a.kind === "country" ? lc(a.id) === lc(b.id) : a.id === b.id);
}

/** A primer door names its deepest level: field › board › country › the command only. */
export function doorRoom(door: PrimerDoor): RoomRef | null {
  if (door.icao) return { kind: "field", id: door.icao.toUpperCase() };
  if (door.problemId) return { kind: "board", id: door.problemId };
  if (door.country) return { kind: "country", id: door.country };
  return null;
}

/** Every tracked field on the board, one row per ICAO (the detail rows win over the pinned strip). */
export function allFields(board: CommandBoard): FieldRow[] {
  const out = new Map<string, FieldRow>();
  for (const d of Object.values(board.details)) for (const c of d.countries) for (const f of c.fields) if (!out.has(f.icao)) out.set(f.icao, f);
  for (const f of board.myFields) if (!out.has(f.icao)) out.set(f.icao, f);
  return [...out.values()];
}

export function findField(board: CommandBoard, icao: string): FieldRow | null {
  const u = icao.toUpperCase();
  return allFields(board).find((f) => f.icao === u) ?? null;
}

export function findCountry(board: CommandBoard, name: string): CountryRow | null {
  for (const d of Object.values(board.details)) for (const c of d.countries) if (lc(c.country) === lc(name)) return c;
  return null;
}

/** The command a subject belongs to; null when the board does not know it. */
export function roomAor(board: CommandBoard, ref: RoomRef): Aor | null {
  if (ref.kind === "country") return findCountry(board, ref.id)?.aor ?? null;
  if (ref.kind === "field") { const f = findField(board, ref.id); return f && f.aor !== "UNKNOWN" ? f.aor : null; }
  for (const d of Object.values(board.details)) if (d.boards.some((b) => b.problemId === ref.id)) return d.aor;
  return null;
}

/**
 * The neighbours ‹ › walk: the command's countries in board order, its
 * fields (hub › ★ › spokes › the rest, as the airfields section lists them),
 * or its boards. The subject itself is in the list, so prev/next are its
 * index ± 1; an unknown subject has no neighbours.
 */
export function roomSiblings(board: CommandBoard, ref: RoomRef): RoomRef[] {
  const aor = roomAor(board, ref);
  if (!aor) return [];
  const d = board.details[aor];
  if (!d) return [];
  if (ref.kind === "country") return d.countries.map((c) => ({ kind: "country" as const, id: c.country }));
  if (ref.kind === "board") return d.boards.map((b) => ({ kind: "board" as const, id: b.problemId }));
  return commandFields(board, aor).map((f) => ({ kind: "field" as const, id: f.icao }));
}

const ROLE_RANK = (f: FieldRow) => (f.role === "hub" ? 0 : f.star ? 1 : f.role === "spoke" ? 2 : 3);
const SEV_RANK: Record<string, number> = { red: 0, amber: 1, unknown: 2, green: 3 };
const LED_RANK: Record<string, number> = { r: 0, a: 1, u: 2, g: 3 };

/** Worst LED across a field's SITREP axes, else its posture composite as an LED, else UNKNOWN. */
export function fieldWorst(f: FieldRow): "r" | "a" | "u" | "g" {
  if (f.sitrep) return (Object.values(f.sitrep.status) as ("r" | "a" | "u" | "g")[]).reduce((w, l) => (LED_RANK[l] < LED_RANK[w] ? l : w), "g" as "r" | "a" | "u" | "g");
  if (f.posture) return f.posture.composite === "red" ? "r" : f.posture.composite === "amber" ? "a" : f.posture.composite === "green" ? "g" : "u";
  return "u";
}

/** A command's fields: hub › ★ › spokes › rest, worst first inside a rank. */
export function commandFields(board: CommandBoard, aor: Aor): FieldRow[] {
  return allFields(board).filter((f) => f.aor === aor).sort((a, b) =>
    ROLE_RANK(a) - ROLE_RANK(b)
    || LED_RANK[fieldWorst(a)] - LED_RANK[fieldWorst(b)]
    || SEV_RANK[a.posture?.composite ?? "unknown"] - SEV_RANK[b.posture?.composite ?? "unknown"]
    || a.icao.localeCompare(b.icao));
}

export interface AirfieldGroup {
  aor: Aor;
  fields: FieldRow[];
  /** The field that colours the group header, and why. */
  worst: FieldRow | null;
  worstLed: "r" | "a" | "u" | "g";
}

/**
 * Airfields by command (A′): every tracked field grouped under its command,
 * groups ordered worst first, then by the board's own row order. A field whose
 * command is UNKNOWN (a METAR-only station with no coordinates) is listed under
 * UNKNOWN last — present, never dropped.
 */
export function airfieldsByCommand(board: CommandBoard): AirfieldGroup[] {
  const fields = allFields(board);
  const aors = [...new Set(fields.map((f) => f.aor))];
  const rowOrder = new Map(board.rows.map((r, i) => [r.aor, i]));
  const groups = aors.map((aor) => {
    const fs = aor === "UNKNOWN"
      ? fields.filter((f) => f.aor === "UNKNOWN").sort((a, b) => a.icao.localeCompare(b.icao))
      : commandFields(board, aor);
    const worst = fs.slice().sort((a, b) => LED_RANK[fieldWorst(a)] - LED_RANK[fieldWorst(b)])[0] ?? null;
    return { aor, fields: fs, worst, worstLed: worst ? fieldWorst(worst) : ("u" as const) };
  });
  return groups.sort((a, b) =>
    (a.aor === "UNKNOWN" ? 1 : 0) - (b.aor === "UNKNOWN" ? 1 : 0)
    || LED_RANK[a.worstLed] - LED_RANK[b.worstLed]
    || (rowOrder.get(a.aor) ?? 99) - (rowOrder.get(b.aor) ?? 99));
}
