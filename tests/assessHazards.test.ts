import { describe, it, expect } from "vitest";
import { assessHazards } from "@/lib/severeWeather";

// Threshold logic behind the Crisis map "Hub wx" layer and the threat board —
// previously untested. Build an hourly series starting at `now` so every
// index lands inside the 30 h assessment window.
const NOW = Date.UTC(2026, 5, 10, 12, 0, 0);
const hours = (n: number) =>
  Array.from({ length: n }, (_, i) => new Date(NOW + i * 3600_000).toISOString().slice(0, 16));

const base = (n = 6) => ({
  time: hours(n),
  wind_gusts_10m: Array(n).fill(10),
  visibility: Array(n).fill(10_000),
  weather_code: Array(n).fill(0),
  temperature_2m: Array(n).fill(60),
});

describe("assessHazards", () => {
  it("quiet forecast → none", () => {
    expect(assessHazards(base(), NOW)).toEqual({ severity: "none", flags: [] });
  });

  it("gusts ≥35 kt flag as elevated; ≥50 kt severe", () => {
    const h = base();
    h.wind_gusts_10m[2] = 40;
    const a = assessHazards(h, NOW);
    expect(a.severity).toBe("elevated");
    expect(a.flags[0]).toMatch(/Gusts 40 kt/);

    h.wind_gusts_10m[3] = 55;
    expect(assessHazards(h, NOW).severity).toBe("severe");
  });

  it("visibility <1600 m is IFR; <800 m is LIFR and severe", () => {
    const h = base();
    h.visibility[1] = 1500;
    const ifr = assessHazards(h, NOW);
    expect(ifr.severity).toBe("elevated");
    expect(ifr.flags[0]).toMatch(/IFR/);

    h.visibility[2] = 700;
    const lifr = assessHazards(h, NOW);
    expect(lifr.severity).toBe("severe");
    expect(lifr.flags[0]).toMatch(/LIFR/);
  });

  it("thunderstorms flag; hail codes (96/99) are severe", () => {
    const h = base();
    h.weather_code[1] = 95;
    expect(assessHazards(h, NOW).severity).toBe("elevated");
    h.weather_code[2] = 96;
    expect(assessHazards(h, NOW).severity).toBe("severe");
  });

  it("temperature extremes flag without escalating severity", () => {
    const h = base();
    h.temperature_2m[1] = 115;
    const a = assessHazards(h, NOW);
    expect(a.severity).toBe("elevated" /* flags exist but none severe */);
    expect(a.flags.join(" ")).toMatch(/Extreme heat 115/);
  });

  it("ignores hours outside the 30 h window", () => {
    const h = base(40); // 40 h of data
    h.wind_gusts_10m[38] = 80; // beyond the window
    expect(assessHazards(h, NOW)).toEqual({ severity: "none", flags: [] });
  });

  it("empty series → none", () => {
    expect(assessHazards({}, NOW)).toEqual({ severity: "none", flags: [] });
  });
});
