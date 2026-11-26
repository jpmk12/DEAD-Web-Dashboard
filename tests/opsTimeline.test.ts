import { describe, it, expect } from "vitest";
import { opsTimeline, wxFromCodes, wxFromWmo, windChillC, rangeLabel, limitingWindows, timelineLines, visCategory, type TlLane } from "../lib/opsTimeline";
import type { ProfileHour } from "../lib/icingSignals";
import type { TafPeriod } from "../lib/types";

const H = 3_600_000;
const T0 = Date.parse("2026-11-26T00:00:00Z");
const RWY = [{ leIdent: "09", heIdent: "27", leHeadingDegT: 90, heHeadingDegT: 270 }];

function hour(k: number, o: Partial<ProfileHour> = {}): ProfileHour {
  return { t: T0 + k * H, tempC2m: 5, freezingLevelM: 1500, weatherCode: 0, precipMm: 0, windDir: 90, windKt: 5, gustKt: null, cloudPct: 20, visM: 20000, precipPct: 0, dewC: -2, feelsC: 4, snowCm: 0, levels: [], ...o };
}
const hours = (n: number, f: (k: number) => Partial<ProfileHour> = () => ({})) => Array.from({ length: n }, (_, k) => hour(k, f(k)));
const taf = (fromH: number, toH: number, o: Partial<TafPeriod> = {}): TafPeriod => ({
  from: new Date(T0 + fromH * H).toISOString(), to: new Date(T0 + toH * H).toISOString(), changeType: "", flightCategory: "VFR", summary: "", windDir: 90, windSpeedKt: 5, windGustKt: null, wxRaw: "", ...o,
});
const lane = (t: ReturnType<typeof opsTimeline>, k: string) => t.lanes.find((l) => l.key === k)!;
const base = { nowMs: T0, lat: 50, lon: 7, elevationM: 300, runways: RWY };

describe("weather words", () => {
  it("reads TAF codes worst-first and WMO codes", () => {
    expect(wxFromCodes("-FZRA BR")).toBe("fzra");
    expect(wxFromCodes("TSRA")).toBe("thunder");
    expect(wxFromCodes("+RA")).toBe("heavyrain");
    expect(wxFromCodes("-SHSN")).toBe("snow");
    expect(wxFromCodes("BLSN")).toBe("none");
    expect(wxFromCodes("NSW")).toBe("none");
    expect(wxFromCodes("FZFG")).toBe("fzfog");
    expect(wxFromWmo(67)).toBe("fzra");
    expect(wxFromWmo(73)).toBe("snow");
    expect(wxFromWmo(95)).toBe("thunder");
    expect(wxFromWmo(82)).toBe("heavyrain");
    expect(visCategory(2000)).toBe("IFR");
    expect(visCategory(null)).toBeNull();
  });
  it("wind chill follows the NWS formula and leaves warm or calm air alone", () => {
    expect(windChillC(-20, 25)).toBeLessThan(-30);
    expect(windChillC(15, 30)).toBe(15);
    expect(windChillC(-5, 1)).toBe(-5);
  });
});

describe("opsTimeline", () => {
  it("freezing rain in the TAF: precip, ground ice and runway all amber, one limiting window", () => {
    const t = opsTimeline({ ...base, hours: hours(72, () => ({ tempC2m: -1 })), taf: [taf(0, 6), taf(6, 12, { wxRaw: "-FZRA", flightCategory: "IFR" }), taf(12, 30)] });
    expect(lane(t, "precip").segs.find((s) => s.label === "FZRA")?.tone).toBe("a");
    expect(lane(t, "deice").segs.find((s) => s.label === "DE/ANTI-ICE")).toMatchObject({ fromMs: T0 + 6 * H, toMs: T0 + 12 * H, tone: "a" });
    expect(lane(t, "deice").segs[0].label).toBe("FROST"); // the dry, saturated hours before it
    expect(lane(t, "runway").segs[0].label).toBe("ICE");
    const w = t.windows.find((x) => x.fromMs === T0 + 6 * H)!;
    expect(w.toMs).toBe(T0 + 12 * H);
    expect(w.factors.map((f) => f.lane)).toEqual(["runway", "deice", "sky"]);
    expect(t.summary).toMatch(/limiting window/);
  });

  it("a forecast is never red outside the crosswind lane", () => {
    const t = opsTimeline({ ...base, hours: hours(72, () => ({ weatherCode: 99, tempC2m: -30, windKt: 40, gustKt: 55, precipMm: 30 })), taf: null });
    for (const l of t.lanes) if (l.key !== "xwind") expect(l.segs.some((s) => s.tone === "r")).toBe(false);
  });

  it("the TAF governs its window — no model rain inside a dry TAF hour", () => {
    const t = opsTimeline({ ...base, hours: hours(72, () => ({ weatherCode: 63 })), taf: [taf(0, 24)] });
    expect(lane(t, "precip").segs.every((s) => s.fromMs >= T0 + 24 * H)).toBe(true);
    expect(lane(t, "precip").segs[0].src).toBe("model");
  });

  it("a BECMG gap is still the prior period's weather, not the model's", () => {
    const t = opsTimeline({ ...base, hours: hours(72, () => ({ weatherCode: 63 })), taf: [taf(0, 2), taf(4, 24, { changeType: "BECMG" })] });
    expect(lane(t, "precip").segs.some((s) => s.fromMs < T0 + 24 * H)).toBe(false);
  });

  it("frost is a note, never a limiting window", () => {
    const t = opsTimeline({ ...base, hours: hours(72, () => ({ tempC2m: -3, dewC: -4 })), taf: null });
    expect(lane(t, "deice").segs[0]).toMatchObject({ label: "FROST", tone: "i" });
    expect(t.windows).toHaveLength(0);
  });

  it("refreeze: wet surfaces then a fall below 0 °C", () => {
    const t = opsTimeline({ ...base, taf: null, hours: hours(72, (k) => (k < 4 ? { tempC2m: 3, weatherCode: 61, precipMm: 1 } : { tempC2m: k < 8 ? 1 : -2 })) });
    const r = lane(t, "runway").segs.find((s) => s.label === "REFREEZE")!;
    expect(r.fromMs).toBe(T0 + 8 * H);
    expect(r.tone).toBe("a");
    expect(t.temp.crossings[0]).toEqual({ t: T0 + 8 * H, dir: "down" });
  });

  it("snow names the model's centimetres; heavy rain is standing water", () => {
    const snow = opsTimeline({ ...base, taf: null, hours: hours(72, () => ({ tempC2m: -2, weatherCode: 73, snowCm: 1.2 })) });
    expect(lane(snow, "runway").segs[0].detail).toMatch(/1\.2 cm/);
    expect(lane(snow, "deice").segs[0].label).toBe("DE-ICE");
    const wet = opsTimeline({ ...base, taf: null, hours: hours(72, () => ({ tempC2m: 12, weatherCode: 63, precipMm: 6 })) });
    expect(lane(wet, "runway").segs[0].label).toBe("WATER");
    expect(lane(wet, "deice").segs).toHaveLength(0);
  });

  it("rain at or below 0 °C is glaze (amber); just above is a note", () => {
    const g = opsTimeline({ ...base, taf: null, hours: hours(72, () => ({ tempC2m: -0.5, weatherCode: 61 })) });
    expect(lane(g, "deice").segs[0]).toMatchObject({ label: "GLAZE", tone: "a" });
    const n = opsTimeline({ ...base, taf: null, hours: hours(72, () => ({ tempC2m: 1.5, weatherCode: 61 })) });
    expect(lane(n, "deice").segs[0].tone).toBe("i");
  });

  it("crosswind on the best end, raised when the runway is contaminated", () => {
    const dry = opsTimeline({ ...base, taf: null, hours: hours(72, () => ({ windDir: 0, windKt: 16 })) });
    expect(lane(dry, "xwind").segs[0].tone).toBe("g");
    const icy = opsTimeline({ ...base, taf: null, hours: hours(72, () => ({ windDir: 0, windKt: 16, weatherCode: 73, tempC2m: -3 })) });
    expect(lane(icy, "xwind").segs[0]).toMatchObject({ tone: "a" });
    expect(lane(icy, "xwind").segs[0].detail).toMatch(/contaminated/);
    const none = opsTimeline({ ...base, runways: [], taf: null, hours: hours(72) });
    expect(lane(none, "xwind").unknown).toMatch(/runway headings/);
  });

  it("ramp: lightning, gusts, wind chill and heat", () => {
    const ts = opsTimeline({ ...base, taf: null, hours: hours(72, () => ({ weatherCode: 95, tempC2m: 20 })) });
    expect(lane(ts, "ramp").segs[0].label).toBe("LIGHTNING");
    const cold = opsTimeline({ ...base, taf: null, hours: hours(72, () => ({ tempC2m: -20, windKt: 25 })) });
    expect(lane(cold, "ramp").segs[0].tone).toBe("a");
    const hot = opsTimeline({ ...base, taf: null, hours: hours(72, () => ({ tempC2m: 38, feelsC: 43 })) });
    expect(lane(hot, "ramp").segs[0].label).toBe("HEAT 43°");
  });

  it("icing aloft: the military TAF group wins; model likely is amber only inside 12 h", () => {
    const lv = [{ hPa: 925, heightM: 1000, tempC: -4, rh: 98 }];
    const m = opsTimeline({ ...base, taf: null, hours: hours(72, () => ({ levels: lv })) });
    const segs = lane(m, "icing").segs;
    expect(segs[0]).toMatchObject({ tone: "a", fromMs: T0, toMs: T0 + 12 * H });
    expect(segs[1].tone).toBe("i");
    const g = opsTimeline({ ...base, taf: null, hours: hours(72), tafGroups: [{ code: "640305", intensity: "moderate", type: "rime in cloud", baseFtAgl: 3000, topFtAgl: 8000, fromMs: T0, toMs: T0 + 6 * H, change: "" }] });
    expect(lane(g, "icing").segs[0]).toMatchObject({ label: "MOD ICE", tone: "a", src: "taf" });
  });

  it("beyond the TAF the sky lane is visibility only and says so", () => {
    const t = opsTimeline({ ...base, taf: [taf(0, 24)], hours: hours(72, (k) => ({ visM: k >= 30 ? 2000 : 20000 })) });
    const ifr = lane(t, "sky").segs.find((s) => s.cat === "IFR")!;
    expect(ifr).toMatchObject({ src: "model", dashed: true, label: "IFR vis" });
    expect(ifr.detail).toMatch(/ceiling not modelled/);
  });

  it("no model and no TAF is UNKNOWN, never quiet; a dead model leaves TAF lanes and names the rest", () => {
    const u = opsTimeline({ ...base, taf: null, hours: null });
    expect(u.live).toBe(false);
    expect(u.summary).toMatch(/UNKNOWN/);
    const tafOnly = opsTimeline({ ...base, taf: [taf(0, 24, { wxRaw: "SN", flightCategory: "IFR" })], hours: null });
    expect(tafOnly.live).toBe(true);
    expect(lane(tafOnly, "deice").unknown).toMatch(/UNKNOWN/);
    expect(lane(tafOnly, "precip").segs[0].label).toBe("SN");
    expect(timelineLines(u)).toEqual([u.summary]);
  });

  it("windows merge across lanes and read in order", () => {
    const lanes: TlLane[] = [
      { key: "runway", title: "", unknown: null, segs: [{ fromMs: 0, toMs: 2 * H, tone: "a", label: "ICE", detail: "ice", src: "taf" }] },
      { key: "xwind", title: "", unknown: null, segs: [{ fromMs: 2 * H, toMs: 4 * H, tone: "r", label: "31 R27", detail: "xw", src: "taf" }, { fromMs: 10 * H, toMs: 11 * H, tone: "a", label: "21 R27", detail: "xw2", src: "taf" }] },
    ];
    const w = limitingWindows(lanes);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ fromMs: 0, toMs: 4 * H, tone: "r" });
    expect(w[0].factors.map((f) => f.lane)).toEqual(["runway", "xwind"]);
  });

  it("range labels name both days across midnight", () => {
    expect(rangeLabel(Date.parse("2026-11-26T22:00:00Z"), Date.parse("2026-11-27T04:00:00Z"))).toBe("Thu 26 22Z–Fri 27 04Z");
    expect(rangeLabel(Date.parse("2026-11-26T04:00:00Z"), Date.parse("2026-11-26T11:00:00Z"))).toBe("Thu 26 04Z–11Z");
  });

  it("light runs under every lane", () => {
    const t = opsTimeline({ ...base, taf: null, hours: hours(72) });
    expect(t.light.some((l) => l.state === "night")).toBe(true);
    expect(t.light.some((l) => l.state === "day")).toBe(true);
    expect(t.light[t.light.length - 1].toMs).toBe(T0 + 72 * H);
  });
});

import { opsTimelineHtml } from "../lib/sitrepExport";
import { notamLane, windowsWithNotams } from "../lib/opsTimeline";

describe("NOTAMs on the timeline and the static export", () => {
  it("a closure is an amber factor that leads its window; an unreadable schedule joins none", () => {
    const t = opsTimeline({ ...base, taf: null, hours: hours(72) });
    const closures = [
      { fromMs: T0 + 14 * H, toMs: T0 + 18 * H, kind: "closure" as const, label: "RWY 09/27", text: "RWY 09/27 CLSD WIP" },
      { fromMs: T0 + 30 * H, toMs: T0 + 34 * H, kind: "closure" as const, label: "TWY A", text: "TWY A CLSD", indeterminate: true },
    ];
    const lane = notamLane(closures, t.startMs);
    expect(lane.segs.map((s) => s.tone)).toEqual(["a", "u"]);
    const { windows } = windowsWithNotams(t, closures);
    expect(windows).toHaveLength(1);
    expect(windows[0].factors[0]).toMatchObject({ lane: "notam", label: "RWY 09/27 CLSD" });
  });

  it("the export block is static, escaped and lists the windows", () => {
    const t = opsTimeline({ ...base, taf: [taf(0, 12, { wxRaw: "FZRA", flightCategory: "IFR" })], hours: hours(72, () => ({ tempC2m: -2 })) });
    const html = opsTimelineHtml(t, [{ fromMs: T0, toMs: T0 + H, kind: "closure", label: "<b>RWY</b>", text: "<script>x</script>" }]);
    expect(html).not.toMatch(/<script/i);
    expect(html).toMatch(/&lt;b&gt;RWY/);
    expect(html).toMatch(/Limiting windows/);
    expect(html).toMatch(/de-ice and anti-ice/);
    expect(opsTimelineHtml(null, [])).toBe("");
  });
});

import { labelSeverity } from "../lib/opsTimeline";
describe("which segment names a window", () => {
  it("freezing beats frozen beats wet; a TAF moderate group beats a model 'likely'", () => {
    expect(labelSeverity("ICE")).toBeGreaterThan(labelSeverity("SNOW"));
    expect(labelSeverity("SNOW")).toBeGreaterThan(labelSeverity("WATER"));
    expect(labelSeverity("MOD ICE")).toBeGreaterThan(labelSeverity("ICE likely"));
    expect(labelSeverity("LIFR")).toBeGreaterThan(labelSeverity("IFR"));
    expect(labelSeverity("WC -30°")).toBe(6);
  });
});
