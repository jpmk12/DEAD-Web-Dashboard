import { describe, it, expect } from "vitest";
import { closureWindows, windowConflicts, windowLabel, type ClosureWindow } from "../lib/sitrepSignals";
import type { TafSegment } from "../lib/sitrepSignals";

const NOW = Date.UTC(2026, 6, 6, 6, 0);           // 06Z
const H = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const notam = (text: string, category = "runway", start?: number, end?: number) => ({
  category, rank: 1, text,
  ...(start !== undefined ? { start: iso(start) } : {}),
  ...(end !== undefined ? { end: iso(end) } : {}),
});

describe("closureWindows", () => {
  it("builds a clamped bar from B)/C) times and classifies the kind", () => {
    const w = closureWindows([notam("RWY 06/24 CLSD DUE WIP", "runway", NOW + 7.5 * H, NOW + 16 * H)], NOW);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ label: "RWY 06/24", kind: "closure", openEnded: false });
    expect(w[0].fromMs).toBe(NOW + 7.5 * H);
    expect(w[0].toMs).toBe(NOW + 16 * H);
  });

  it("open-ended (no C) end) runs to the horizon and is flagged; no times at all → excluded", () => {
    const w = closureWindows([notam("TWY A CLSD", "taxiway", NOW - 2 * H)], NOW, 48);
    expect(w).toHaveLength(1);
    expect(w[0].openEnded).toBe(true);
    expect(w[0].fromMs).toBe(NOW);                       // clamped: already in effect
    expect(w[0].toMs).toBe(NOW + 48 * H);
    expect(closureWindows([notam("RWY 18/36 CLSD")], NOW)).toHaveLength(0);
  });

  it("skips expired, beyond-horizon, and non-window NOTAMs", () => {
    const w = closureWindows([
      notam("RWY 06/24 CLSD", "runway", NOW - 10 * H, NOW - 2 * H),          // expired
      notam("TWY B CLSD", "taxiway", NOW + 50 * H, NOW + 60 * H),            // starts past horizon
      notam("CRANE 120FT AGL 1NM E AD", "obstacle", NOW, NOW + 5 * H),       // not a window pattern
    ], NOW, 48);
    expect(w).toHaveLength(0);
  });

  it("classifies unserviceable and fuel-limited kinds; closures sort first", () => {
    const w = closureWindows([
      notam("ILS RWY 24 U/S", "navaid", NOW + 19 * H, NOW + 31 * H),
      notam("JET A1 FUEL LIMITED", "services", NOW + 1 * H, NOW + 5 * H),
      notam("AD CLSD EXC EMERG", "services", NOW + 2 * H, NOW + 4 * H),
    ], NOW);
    expect(w.map((x) => x.kind)).toEqual(["closure", "unserviceable", "limited"]);
    expect(w[0].label).toBe("Airfield");
    expect(w[1].label).toBe("ILS RWY 24");
    expect(w[2].label).toBe("Fuel");
  });
});

describe("windowLabel", () => {
  it("extracts asset labels from NOTAM text", () => {
    expect(windowLabel("RWY 08L/26R CLSD", "runway")).toBe("RWY 08L/26R");
    expect(windowLabel("TWY A3 CLSD BTN TWY A AND APRON", "taxiway")).toBe("TWY A3");
    expect(windowLabel("VOR U/S", "navaid")).toBe("VOR");
    expect(windowLabel("SOMETHING ELSE CLSD", "hours")).toBe("Hours");
  });
});

describe("windowConflicts", () => {
  const seg = (cat: TafSegment["cat"], fromH: number, toH: number): TafSegment =>
    ({ cat, fromMs: NOW + fromH * H, toMs: NOW + toH * H, label: "" });
  const win = (label: string, kind: ClosureWindow["kind"], fromH: number, toH: number): ClosureWindow =>
    ({ label, kind, fromMs: NOW + fromH * H, toMs: NOW + toH * H, openEnded: false, text: "" });

  it("flags a runway closure overlapping forecast IFR, ignores non-overlap and non-runway", () => {
    const conflicts = windowConflicts(
      [win("RWY 06/24", "closure", 7.5, 16), win("TWY A", "closure", 7.5, 16), win("ILS RWY 24", "unserviceable", 8, 12)],
      [seg("VFR", 0, 11), seg("IFR", 11, 18)],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain("RWY 06/24 closure");
    expect(conflicts[0]).toContain("IFR");
    // no overlap → no conflict
    expect(windowConflicts([win("RWY 06/24", "closure", 0, 4)], [seg("IFR", 11, 18)])).toHaveLength(0);
  });

  it("picks the worst overlapping category", () => {
    const c = windowConflicts(
      [win("Airfield", "closure", 6, 20)],
      [seg("IFR", 7, 10), seg("LIFR", 12, 14)],
    );
    expect(c[0]).toContain("LIFR");
  });
});
