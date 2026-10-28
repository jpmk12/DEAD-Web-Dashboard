import { describe, it, expect } from "vitest";
import {
  LINE_HORIZON_DAYS, addDaysYmd, isValidDay, julianOf, lineDayLabel, lineLabel, linesInHorizon,
  normalizeLineDraft, parseFieldsText, runwayClassFor, validateLineDraft,
} from "../lib/missionLines";

describe("validateLineDraft — the bound at the write boundary", () => {
  const ok = { day: "2026-10-28", airframe: "C-17", fields: ["OJAQ", "OTBH"], status: "planned" };
  it("accepts a day, an airframe, fields and a status", () => {
    expect(validateLineDraft(ok)).toBeNull();
    expect(validateLineDraft({ ...ok, fields: "ojaq otbh" })).toBeNull();
    expect(validateLineDraft({ ...ok, id: "x" })).toBeNull();
  });
  it("refuses every key the record does not have — a line holds nothing finer", () => {
    expect(validateLineDraft({ ...ok, note: "pax 40" })).toMatch(/holds no “note”/);
    expect(validateLineDraft({ ...ok, tail: "07-7177" })).toMatch(/holds no “tail”/);
    expect(validateLineDraft({ ...ok, callsign: "RCH123" })).toMatch(/holds no “callsign”/);
  });
  it("refuses a tail, a callsign, a time or a load typed as a field, by name", () => {
    expect(validateLineDraft({ ...ok, fields: ["OJAQ", "07-7177"] })).toMatch(/tail number/);
    expect(validateLineDraft({ ...ok, fields: ["RCH123"] })).toMatch(/callsign/);
    expect(validateLineDraft({ ...ok, fields: ["OJAQ", "1400Z"] })).toMatch(/a time/);
    expect(validateLineDraft({ ...ok, fields: ["40PAX"] })).toMatch(/a load/);
    expect(validateLineDraft({ ...ok, fields: ["AMMAN"] })).toMatch(/not an ICAO/);
  });
  it("needs a real day, a listed airframe, a listed status and at least one field", () => {
    expect(validateLineDraft({ ...ok, day: "2026-02-30" })).toMatch(/calendar date/);
    expect(validateLineDraft({ ...ok, airframe: "C-5" })).toMatch(/Airframe must be one of/);
    expect(validateLineDraft({ ...ok, status: "flying" })).toMatch(/planned or execution/);
    expect(validateLineDraft({ ...ok, fields: [] })).toMatch(/at least one field/);
    expect(validateLineDraft({ ...ok, fields: Array(9).fill("OJAQ") })).toMatch(/8 fields/);
  });
  it("normalises: upper-case ICAOs, order kept, a turn keeps its repeat", () => {
    expect(normalizeLineDraft({ ...ok, fields: "ojaq → otbh, ojaq" }).fields).toEqual(["OJAQ", "OTBH", "OJAQ"]);
    expect(parseFieldsText("OJAQ/OTBH|LTAG")).toEqual(["OJAQ", "OTBH", "LTAG"]);
  });
});

describe("days and labels", () => {
  it("validates days, adds days across a month end, and derives the Julian day", () => {
    expect(isValidDay("2026-10-31")).toBe(true);
    expect(isValidDay("2026-11-31")).toBe(false);
    expect(addDaysYmd("2026-10-30", 3)).toBe("2026-11-02");
    expect(julianOf("2026-01-01")).toBe(1);
    expect(julianOf("2026-10-27")).toBe(300);
    expect(lineDayLabel("2026-10-28")).toBe("Wed 28 Oct · JD 301");
    expect(lineLabel({ airframe: "KC-46", fields: ["KWRI", "LPLA"] })).toBe("KC-46 · KWRI → LPLA");
  });
  it("keeps the horizon to four days from today, past lines never read", () => {
    const mk = (day: string, airframe = "C-17") => ({ day, airframe, updatedAt: "" });
    const lines = [mk("2026-10-26"), mk("2026-10-27"), mk("2026-10-30"), mk("2026-10-31"), mk("2026-10-27", "C-130")];
    expect(LINE_HORIZON_DAYS).toBe(4);
    expect(linesInHorizon(lines, "2026-10-27").map((l) => `${l.day} ${l.airframe}`)).toEqual(["2026-10-27 C-130", "2026-10-27 C-17", "2026-10-30 C-17"]);
  });
  it("tankers need the heavy runway class; the C-130 its own", () => {
    expect(runwayClassFor("KC-135")).toBe("C-17");
    expect(runwayClassFor("KC-46")).toBe("C-17");
    expect(runwayClassFor("C-130")).toBe("C-130");
  });
});

describe("the horizon is enforced when a clock is given", () => {
  it("refuses a past day and a fifth day, by name", () => {
    const now = Date.UTC(2026, 9, 28, 12);
    const ok = { day: "2026-10-28", airframe: "C-17", fields: ["OJAQ"], status: "planned" };
    expect(validateLineDraft(ok, { nowMs: now })).toBeNull();
    expect(validateLineDraft({ ...ok, day: "2026-10-31" }, { nowMs: now })).toBeNull();
    expect(validateLineDraft({ ...ok, day: "2026-10-27" }, { nowMs: now })).toMatch(/has passed/);
    expect(validateLineDraft({ ...ok, day: "2026-11-01" }, { nowMs: now })).toMatch(/4 days ahead/);
  });
});
