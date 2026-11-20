import { describe, it, expect } from "vitest";
import { fieldOutlook, wmoSeverity, blockLabel } from "../lib/fieldOutlook";
import type { ProfileHour } from "../lib/icingSignals";
import type { TafPeriod } from "../lib/types";

const NOW = Date.parse("2026-11-20T14:20:00Z");
const H = 3_600_000;
const hour = (t: number, o: Partial<ProfileHour> = {}): ProfileHour => ({
  t, tempC2m: 5, freezingLevelM: 1500, weatherCode: 2, precipMm: 0, windDir: 240, windKt: 10, gustKt: 15,
  cloudPct: 50, visM: 24000, precipPct: 10, levels: [], ...o,
});
const hours = Array.from({ length: 84 }, (_, k) => hour(Date.parse("2026-11-20T12:00:00Z") + k * H));

describe("fieldOutlook", () => {
  it("cuts 72 h into 6-h Zulu blocks from the block holding now, grouped by Zulu day", () => {
    const o = fieldOutlook({ nowMs: NOW, lon: 6.7, hours, taf: [] });
    expect(o.live).toBe(true);
    expect(o.blocks).toHaveLength(12);
    expect(new Date(o.blocks[0].fromMs).toISOString()).toBe("2026-11-20T12:00:00.000Z");
    expect(o.blocks[0].hours).toBe(4); // 12Z and 13Z are past: 14–17Z remain
    expect(o.days.map((d) => d.blocks.length)).toEqual([2, 4, 4, 2]);
    expect(blockLabel(o.blocks[0])).toBe("Fri 12Z–18Z");
    expect(o.flagged).toBe(0);
    expect(o.summary).toMatch(/nothing flagged/);
  });
  it("flags thunderstorms, gusts and TAF IFR, worst first, and keeps the worst code per block", () => {
    const hs = hours.map((h) => {
      const iso = new Date(h.t).toISOString();
      if (iso === "2026-11-21T19:00:00.000Z") return { ...h, weatherCode: 95 };
      if (iso.startsWith("2026-11-22T0")) return { ...h, gustKt: 36, windKt: 22 };
      return h;
    });
    const taf: TafPeriod[] = [
      { from: "2026-11-20T12:00:00Z", to: "2026-11-21T18:00:00Z", changeType: "", flightCategory: "VFR", summary: "" },
      { from: "2026-11-20T18:00:00Z", to: "2026-11-21T00:00:00Z", changeType: "TEMPO", flightCategory: "IFR", summary: "" },
    ];
    const o = fieldOutlook({ nowMs: NOW, lon: 6.7, hours: hs, taf });
    const at = (iso: string) => o.blocks.find((b) => new Date(b.fromMs).toISOString() === iso)!;
    expect(at("2026-11-21T18:00:00.000Z").code).toBe(95);
    expect(at("2026-11-21T18:00:00.000Z").flags).toContain("thunderstorms (model)");
    expect(at("2026-11-20T18:00:00.000Z").taf).toBe("IFR");
    expect(at("2026-11-22T00:00:00.000Z").flags[0]).toBe("gusts to 36 kt (model)");
    expect(at("2026-11-22T06:00:00.000Z").inTaf).toBe(false);
    expect(o.summary).toMatch(/^Next 72 h: thunderstorms \(model\) Sat 18Z–00Z · IFR \(TAF\) Fri 18Z–00Z · gusts to 36 kt \(model\) Sun 00Z–12Z/);
  });
  it("no profile → UNKNOWN, never quiet", () => {
    const o = fieldOutlook({ nowMs: NOW, lon: 0, hours: null, taf: [] });
    expect(o.live).toBe(false);
    expect(o.summary).toMatch(/UNKNOWN/);
  });
  it("ranks weather codes", () => {
    expect(wmoSeverity(95)).toBeGreaterThan(wmoSeverity(67));
    expect(wmoSeverity(67)).toBeGreaterThan(wmoSeverity(73));
    expect(wmoSeverity(73)).toBeGreaterThan(wmoSeverity(63));
    expect(wmoSeverity(null)).toBe(-1);
  });
});
