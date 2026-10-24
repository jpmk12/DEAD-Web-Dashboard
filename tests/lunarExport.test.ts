import { describe, it, expect } from "vitest";
import { renderLunarHtml } from "../lib/lunarExport";
import { lunarNights, DEFAULT_LUNAR_THRESHOLDS } from "../lib/moon";
import { parseCurrent } from "../lib/currentConditions";

describe("light-data export", () => {
  const nights = lunarNights(40.016, -74.592, "America/New_York", "2026-10-24", 7);
  it("is one self-contained, script-free page with a row per night and the budget columns", () => {
    const html = renderLunarHtml({ placeLabel: "KWRI · McGuire", lat: 40.016, lon: -74.592, nights, thresholds: DEFAULT_LUNAR_THRESHOLDS, generatedISO: "2026-10-24T19:00:00.000Z" });
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/(src|href)=["']https?:/i);
    expect(html).toContain("SNAPSHOT AS OF 2026-10-24 19:00Z");
    expect((html.match(/<tr class="(hi|mid|lo|polar)">/g) ?? []).length).toBe(7);
    expect(html).toContain("<th>Moon-free h</th>");
    expect(html).toContain("Sat 24 Oct");
    expect(html).toContain("LOW &lt; 25% · HIGH ≥ 60%");
    expect(html).toContain("America/New_York");
  });
  it("escapes the place label — it is user text", () => {
    const html = renderLunarHtml({ placeLabel: `<img src=x onerror=alert(1)> "Base"`, lat: 0, lon: 0, nights, thresholds: DEFAULT_LUNAR_THRESHOLDS, generatedISO: "2026-10-24T19:00:00.000Z" });
    expect(html).not.toMatch(/<img src=x/);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; &quot;Base&quot;");
  });
  it("a polar night renders as POLAR with dashes, never invented times", () => {
    const polar = lunarNights(78.22, 15.63, "Arctic/Longyearbyen", "2026-06-24", 1);
    const html = renderLunarHtml({ placeLabel: "LYR", lat: 78.22, lon: 15.63, nights: polar, thresholds: DEFAULT_LUNAR_THRESHOLDS, generatedISO: "2026-06-24T12:00:00.000Z" });
    expect(html).toContain(">POLAR<");
    expect(html).toContain("<td>—</td>");
  });
});

describe("Open-Meteo timezone on CurrentConditions", () => {
  it("keeps a valid IANA zone and drops anything else", () => {
    const base = { current: { temperature_2m: 50, is_day: 1 }, daily: { time: ["2026-10-24"], sunrise: ["2026-10-24T07:19"], sunset: ["2026-10-24T18:06"] } };
    expect(parseCurrent({ ...base, timezone: "America/New_York" })!.timezone).toBe("America/New_York");
    expect(parseCurrent({ ...base, timezone: "Etc/GMT+5" })!.timezone).toBe("Etc/GMT+5");
    expect(parseCurrent({ ...base, timezone: "<script>" })!.timezone).toBeNull();
    expect(parseCurrent(base)!.timezone).toBeNull();
  });
});
