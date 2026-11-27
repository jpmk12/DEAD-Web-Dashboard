import { describe, it, expect } from "vitest";
import * as ot from "../lib/opsTimeline";
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

import { sliceAt, changePoints, zuluStamp, spanText, windowBand } from "../lib/opsTimeline";

describe("scrubbing: the hour readout", () => {
  const fz = () => opsTimeline({ ...base, taf: [taf(0, 6), taf(6, 12, { wxRaw: "-FZRA", flightCategory: "IFR" }), taf(12, 30)], hours: hours(72, (k) => ({ tempC2m: k < 20 ? -1 : 4, dewC: -1.5 })) });
  const closures = [{ fromMs: T0 + 40 * H, toMs: T0 + 44 * H, kind: "closure" as const, label: "RWY 09/27", text: "RWY 09/27 CLSD WIP" }];

  it("the Zulu stamp and span text", () => {
    expect(zuluStamp(T0 + 5 * H + 15 * 60_000)).toBe("Thu 26 Nov · 0515Z");
    expect(zuluStamp(T0 + 5 * H, false)).toBe("Thu 26 · 0500Z");
    expect(spanText(40 * 60_000)).toBe("40 min");
    expect(spanText(16 * H)).toBe("16 h");
    expect(spanText(28 * H)).toBe("1 d 4 h");
  });

  it("reads every lane at the hour, says which window it is in and when it clears", () => {
    const t = fz();
    const { lane, windows } = windowsWithNotams(t, closures);
    const s = sliceAt(t, [lane], windows, T0 + 8 * H + 30 * 60_000)!;
    expect(s.stamp).toBe("Thu 26 Nov · 0830Z");
    expect(s.src).toBe("taf");
    expect(s.rows.map((r) => r.key)).toEqual(["sky", "precip", "temp", "deice", "runway", "icing", "xwind", "ramp", "notam"]);
    expect(s.rows.find((r) => r.key === "runway")).toMatchObject({ tone: "a", label: "ICE" });
    expect(s.rows.find((r) => r.key === "temp")!.text).toMatch(/^-1 °C · dew -1 · feels 4 · 0 °C at [0-9,]+ ft AGL \(model\)$/);
    expect(s.rows.find((r) => r.key === "notam")).toMatchObject({ tone: "n", text: "no closure in effect" });
    expect(s.window).toMatchObject({ index: 0, toMs: T0 + 12 * H, leftMs: 3.5 * H });
    expect(s.next).toBeNull();
  });

  it("outside a window it names the next one; beyond the TAF it says model", () => {
    const t = fz();
    const { lane, windows } = windowsWithNotams(t, closures);
    const s = sliceAt(t, [lane], windows, T0 + 33 * H)!;
    expect(s.src).toBe("model");
    expect(s.window).toBeNull();
    expect(s.next).toMatchObject({ fromMs: T0 + 40 * H, inMs: 7 * H });
    expect(sliceAt(t, [lane], windows, T0 + 41 * H)!.rows.find((r) => r.key === "notam")).toMatchObject({ tone: "a", label: "RWY 09/27 CLSD" });
  });

  it("an UNKNOWN lane is said as UNKNOWN, never as nothing limiting", () => {
    const t = opsTimeline({ ...base, runways: [], taf: null, hours: hours(72) });
    const s = sliceAt(t, [], t.windows, T0 + H)!;
    expect(s.rows.find((r) => r.key === "xwind")).toMatchObject({ tone: "u", label: "UNKNOWN" });
    expect(s.rows.find((r) => r.key === "deice")).toMatchObject({ tone: "n", text: "nothing limiting" });
    // A dead timeline has no slice; the cursor clamps into the 72 h.
    expect(sliceAt(opsTimeline({ ...base, taf: null, hours: null }), [], [], T0)).toBeNull();
    expect(sliceAt(t, [], [], T0 + 500 * H)!.ms).toBe(T0 + 72 * H - 1);
  });

  it("a lane unknown only past the TAF still reads inside it", () => {
    const t = opsTimeline({ ...base, taf: [taf(0, 24, { wxRaw: "-SN", flightCategory: "IFR" })], hours: null });
    expect(sliceAt(t, [], t.windows, T0 + 2 * H)!.rows.find((r) => r.key === "sky")).toMatchObject({ label: "IFR" });
    expect(sliceAt(t, [], t.windows, T0 + 30 * H)!.rows.find((r) => r.key === "sky")!.tone).toBe("u");
  });

  it("change points are every bar edge and every 0 °C crossing, inside the 72 h", () => {
    const t = fz();
    const c = changePoints(t);
    expect(c).toContain(T0 + 6 * H);
    expect(c).toContain(T0 + 12 * H);
    expect(c).toContain(t.temp.crossings[0].t);
    expect(c.every((x) => x > t.startMs && x < t.startMs + 72 * H)).toBe(true);
    expect([...c].sort((a, b) => a - b)).toEqual(c);
  });

  it("the airfield band carries the windows with NOTAMs folded in", () => {
    const t = fz();
    const { windows } = windowsWithNotams(t, closures);
    const b = windowBand(t, windows)!;
    expect(b.live).toBe(true);
    expect(b.windows).toHaveLength(2);
    expect(b.windows[1].label).toMatch(/RWY 09\/27 CLSD/);
    expect(windowBand(null, [])).toBeNull();
  });
});

describe("the two fixes from the mockup fixture", () => {
  it("a TAF freezing rain over warm model air says the sources disagree", () => {
    const t = opsTimeline({ ...base, taf: [taf(0, 12, { wxRaw: "-FZRA", flightCategory: "IFR" })], hours: hours(72, () => ({ tempC2m: 6 })) });
    const d = t.lanes.find((l) => l.key === "deice")!.segs[0];
    expect(d.label).toBe("DE/ANTI-ICE");
    expect(d.detail).toMatch(/model has the air at 6 °C; the TAF and the model disagree/);
    expect(d.detail).not.toMatch(/freezing rain \(TAF\) at 6/);
  });
  it("a NOTAM bar carries a short label for a narrow bar", () => {
    const lane = notamLane([{ fromMs: T0, toMs: T0 + 4 * H, kind: "closure", label: "RWY 05/23", text: "x" }], T0);
    expect(lane.segs[0]).toMatchObject({ label: "RWY 05/23 CLSD", short: "CLSD" });
  });
});

import { packRows, sliceAt as sliceAtFix } from "../lib/opsTimeline";
import { windowLabel } from "../lib/sitrepSignals";
import { notamSubject } from "../lib/notamSubject";

// From the ETAD screenshot (2026-11-26): two shelter NOTAMs overlapping on one
// row, a three-day "limiting window" made of closed shelters, the NOTAM text
// read twice in the readout, and "icing possible 900–900 ft AGL".
describe("timeline overlap and readout fixes (ETAD, 2026-11-26)", () => {
  const HAS = "L0076/26 AERODROME HAS'S AND HARDSTANDS 3003, 3004, 3008, 3016 CLSD";
  it("a hardened-shelter / hardstand NOTAM is about parking, never the aerodrome", () => {
    expect(notamSubject(HAS)).toBe("apron");
    expect(windowLabel(HAS, "other")).toBe("Parking / HAS");
    expect(notamSubject("RWY 09/27 HAS BEEN RESURFACED")).toBe("runway");
    // A last-resort label never starts with the NOTAM number.
    expect(windowLabel("A1234/26 NOTAMN BALLOON RELEASE NE OF FIELD", "other")).toMatch(/^BALLOON/);
  });

  it("closed parking is a note, not a limiting window; the readout reads each NOTAM once", () => {
    const t = opsTimeline({ ...base, taf: null, hours: hours(72) });
    const closures = [
      { fromMs: T0, toMs: T0 + 72 * H, kind: "closure" as const, label: "Parking / HAS", text: HAS },
      { fromMs: T0 + 10 * H, toMs: T0 + 40 * H, kind: "closure" as const, label: "Parking / HAS", text: HAS.replace("L0076", "L0080") },
    ];
    const { lane: nl, windows } = windowsWithNotams(t, closures);
    expect(nl.segs.every((s) => s.tone === "i")).toBe(true);
    expect(windows).toHaveLength(0);
    expect(nl.segs[0].detail).toMatch(/^Parking \/ HAS closed \(NOTAM L0076\/26\) — parking capacity/);
    expect(nl.segs[0].detail.match(/L0076\/26/g)).toHaveLength(1);
    const row = sliceAtFix(t, [nl], windows, T0 + 20 * H)!.rows.find((r) => r.key === "notam")!;
    expect(row.label).toBe("2 in effect");
    expect(row.text).toMatch(/L0076\/26.* · .*L0080\/26/);
  });

  it("overlapping bars take a row each up to three; the fourth shares the row that frees first", () => {
    const s = (a: number, b: number) => ({ fromMs: a, toMs: b });
    expect(packRows([s(0, 10), s(5, 15), s(12, 20)])).toEqual([{ row: 0, over: false }, { row: 1, over: false }, { row: 0, over: false }]);
    const p = packRows([s(0, 10), s(1, 11), s(2, 12), s(3, 13)]);
    expect(p.map((x) => x.row)).toEqual([0, 1, 2, 0]);
    expect(p[3].over).toBe(true);
  });

  it("one model level reads 'near N ft', never 'N–N ft'", () => {
    const lv = [{ hPa: 925, heightM: 300 + 900 / 3.28084, tempC: -4, rh: 90 }];
    const t = opsTimeline({ ...base, taf: null, hours: hours(24, () => ({ levels: lv })) });
    const d = lane(t, "icing").segs[0].detail;
    expect(d).toMatch(/near 900 ft AGL/);
    expect(d).not.toMatch(/900–900/);
  });
});

describe("mission generation vs launch & recovery (2026-11-27)", () => {
  const navaidAllPeriod = { fromMs: T0, toMs: T0 + 80 * H, kind: "unserviceable" as const, label: "TACAN", text: "A0123/26 TACAN U/S" };

  it("a three-day outage is STANDING, said once, and no longer swallows the other windows", () => {
    // Freezing rain 06–12Z and gusts 40–44Z: two separate windows once the outage is split off.
    const t = opsTimeline({ ...base, hours: hours(72, (k) => (k >= 40 && k < 44 ? { gustKt: 40 } : { tempC2m: -1 })), taf: [taf(0, 6), taf(6, 12, { wxRaw: "-FZRA" }), taf(12, 30)] });
    const merged = limitingWindows([...t.lanes, ot.notamLane([navaidAllPeriod], t.startMs)]);
    expect(merged).toHaveLength(1); // the old behaviour: one 72-h window
    const v = ot.planView(t, [navaidAllPeriod]);
    expect(v.standing).toHaveLength(1);
    expect(v.standing[0]).toMatchObject({ lane: "notam", label: "TACAN U/S", proc: "launch", hours: 72 });
    expect(v.windows.length).toBeGreaterThanOrEqual(2);
    expect(v.windows.some((w) => w.factors.some((f) => f.label === "TACAN U/S"))).toBe(false);
    expect(ot.standingLine(v.standing[0])).toMatch(/^Standing \(all\) — NOTAMs \[launch & recovery\]: TACAN unserviceable/);
  });

  it("generation and launch read their own lanes: de-ice limits generation, IFR limits launch", () => {
    const t = opsTimeline({ ...base, hours: hours(72, (k) => (k >= 20 && k < 26 ? { tempC2m: -3 } : {})), taf: [taf(0, 10), taf(10, 16, { flightCategory: "IFR" }), taf(16, 20), taf(20, 26, { wxRaw: "-SN" }), taf(26, 30)] });
    const v = ot.planView(t, []);
    const g = v.strips.gen.hours, l = v.strips.launch.hours;
    expect(l[12].tone).toBe("a");
    expect(l[12].why).toContain("IFR");
    expect(g[12].tone).toBe("g"); // IFR is not a generation limit
    expect(g[22].tone).toBe("a");
    expect(g[22].why).toContain("DE-ICE");
  });

  it("best windows are the longest clear stretches, with what ends them, TAF hours and daylight", () => {
    const t = opsTimeline({ ...base, hours: hours(72), taf: [taf(0, 10), taf(10, 16, { flightCategory: "IFR" }), taf(16, 30)] });
    const v = ot.planView(t, []);
    const b = v.best.launch;
    expect(b[0]).toMatchObject({ fromMs: T0 + 16 * H, toMs: T0 + 72 * H, hours: 56, tafH: 14, endsBy: null });
    expect(b[1]).toMatchObject({ fromMs: T0, toMs: T0 + 10 * H, hours: 10, tafH: 10 });
    expect(b[1].endsBy?.why).toContain("IFR");
    expect(b[1].text).toMatch(/ends with IFR/);
    expect(v.best.gen[0].hours).toBe(72);
    // A stretch shorter than BEST_MIN_H is never a "best" window.
    const t2 = opsTimeline({ ...base, hours: hours(72), taf: [taf(0, 10, { flightCategory: "IFR" }), taf(10, 12), taf(12, 40, { flightCategory: "LIFR" }), taf(40, 42), taf(42, 72, { flightCategory: "IFR" })] });
    expect(ot.planView(t2, []).best.launch).toHaveLength(0);
    // IFR for 70 of 72 h is STANDING: said once, the strip shows what changes beside it.
    const t3 = opsTimeline({ ...base, hours: hours(72), taf: [taf(0, 10, { flightCategory: "IFR" }), taf(10, 12), taf(12, 72, { flightCategory: "IFR" })] });
    const v3 = ot.planView(t3, []);
    expect(v3.standing).toEqual([expect.objectContaining({ lane: "sky", label: "IFR", hours: 70, proc: "launch" })]);
  });

  it("an UNKNOWN lane makes the hour UNKNOWN, never clear — and never a best window", () => {
    const t = opsTimeline({ ...base, runways: [], hours: hours(72), taf: [taf(0, 30)] });
    const v = ot.planView(t, []);
    expect(v.strips.launch.hours.every((h) => h.tone === "u")).toBe(true);
    expect(v.strips.launch.hours[0].why.join(" ")).toMatch(/Crosswind UNKNOWN/);
    expect(v.best.launch).toHaveLength(0);
    expect(v.best.gen[0].hours).toBe(72);
  });

  it("fuel NOTAMs limit generation (amber), parking stays a note, runway closures limit launch", () => {
    const fuel = { fromMs: T0 + 5 * H, toMs: T0 + 9 * H, kind: "limited" as const, label: "Fuel", text: "JET A1 NOT AVBL" };
    const rwy = { fromMs: T0 + 30 * H, toMs: T0 + 34 * H, kind: "closure" as const, label: "RWY 05/23", text: "RWY 05/23 CLSD" };
    const t = opsTimeline({ ...base, hours: hours(72), taf: [taf(0, 30)] });
    const v = ot.planView(t, [fuel, rwy]);
    expect(v.lane.segs.find((s) => s.label === "Fuel LTD")).toMatchObject({ tone: "a", proc: "gen" });
    expect(v.strips.gen.hours[6].tone).toBe("a");
    expect(v.strips.launch.hours[6].tone).toBe("g");
    expect(v.strips.launch.hours[31].tone).toBe("a");
    expect(v.strips.gen.hours[31].tone).toBe("g");
  });

  it("a flying window is read against each strip, clipped to it", () => {
    const t = opsTimeline({ ...base, hours: hours(72), taf: [taf(0, 10), taf(10, 16, { flightCategory: "IFR" }), taf(16, 30)] });
    const v = ot.planView(t, []);
    const runs = ot.windowVerdict(v.strips.launch, T0 + 8 * H, T0 + 18 * H);
    expect(runs.map((r) => [r.tone, (r.fromMs - T0) / H, (r.toMs - T0) / H])).toEqual([["g", 8, 10], ["a", 10, 16], ["g", 16, 18]]);
  });

  it("the Commander's lines lead with standing limits, then the best window per process", () => {
    const t = opsTimeline({ ...base, hours: hours(72), taf: [taf(0, 30)] });
    const lines = ot.planLines(t, ot.planView(t, [navaidAllPeriod]));
    expect(lines[0]).toMatch(/^Standing \(all\)/);
    expect(lines[1]).toMatch(/^Best generation window: Thu 26 00Z/);
    expect(lines[2]).toMatch(/^Best launch & recovery window:/);
  });

  it("the airfield band carries both strips' limited runs and the standing labels", () => {
    const t = opsTimeline({ ...base, hours: hours(72), taf: [taf(0, 10), taf(10, 16, { flightCategory: "IFR" }), taf(16, 30)] });
    const v = ot.planView(t, [navaidAllPeriod]);
    const band = ot.windowBand(t, v.windows, v)!;
    expect(band.launch).toEqual([expect.objectContaining({ fromMs: T0 + 10 * H, toMs: T0 + 16 * H, tone: "a" })]);
    expect(band.gen).toEqual([]);
    expect(band.standing).toEqual(["TACAN U/S (all)"]);
  });
});
