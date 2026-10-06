import { describe, it, expect } from "vitest";
import { spaceWxSentence, spaceWeatherImpacts, type NoaaScales } from "@/lib/spaceWeatherOps";

const quiet: NoaaScales = { live: true, now: { date: "2026-10-06", R: 0, G: 0, S: 0 }, outlook: [{ date: "2026-10-07", R: 0, G: 1, S: 0 }, { date: "2026-10-08", R: 0, G: 0, S: 0 }] } as NoaaScales;

describe("spaceWxSentence", () => {
  it("reads 'no impact' with a quiet outlook when every scale is 0–1", () => {
    const s = spaceWxSentence(quiet, spaceWeatherImpacts(quiet, { polar: false }));
    expect(s.tone).toBe("g");
    expect(s.lead).toBe("No impact today.");
    expect(s.detail).toMatch(/HF, GPS approaches and SATCOM normal; 3-day outlook quiet/);
  });
  it("names what breaks at a scale of 3+", () => {
    const storm = { ...quiet, now: { date: "2026-10-06", R: 3, G: 0, S: 0 } } as NoaaScales;
    const s = spaceWxSentence(storm, spaceWeatherImpacts(storm, { polar: false }));
    expect(s.tone).toBe("r");
    expect(s.lead).toBe("R3 in effect.");
    expect(s.detail).toMatch(/HF radio/);
  });
  it("names a G2+ day in the outlook when today is quiet", () => {
    const later = { ...quiet, outlook: [{ date: "2026-10-07", R: 0, G: 2, S: 0 }] } as NoaaScales;
    const s = spaceWxSentence(later, spaceWeatherImpacts(later, { polar: false }));
    expect(s.detail).toMatch(/G2 possible on 10-07/);
  });
  it("is UNKNOWN, never quiet, when SWPC is unreachable", () => {
    const dead = { live: false, now: { date: "", R: null, G: null, S: null }, outlook: [] } as unknown as NoaaScales;
    const s = spaceWxSentence(dead, spaceWeatherImpacts(dead, { polar: false }));
    expect(s.tone).toBe("u");
    expect(s.lead).toMatch(/UNKNOWN/);
  });
});
