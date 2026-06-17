import { describe, it, expect } from "vitest";
import { parseYahooChart, parseDailyClose } from "@/lib/energyPrices";

describe("parseYahooChart", () => {
  const chart = (meta: Record<string, unknown>, closes?: number[]) =>
    ({ chart: { result: [{ meta, ...(closes ? { indicators: { quote: [{ close: closes }] } } : {}) }] } });

  it("uses the PREVIOUS SESSION close (not chartPreviousClose) for day-over-day", () => {
    // Real Brent shape: chartPreviousClose=87.33 (5 days ago) would be -9.5%;
    // the true day move is 79.03 vs the prior bar 78.96 ≈ +0.1%.
    const r = parseYahooChart(chart(
      { regularMarketPrice: 79.03, chartPreviousClose: 87.33, regularMarketTime: 1781739570 },
      [87.33, 83.17, 78.96, 79.03],
    ))!;
    expect(r.price).toBe(79.03);
    expect(r.changePct).toBe(0.1);
  });

  it("falls back to chartPreviousClose only when <2 daily bars", () => {
    const r = parseYahooChart(chart({ regularMarketPrice: 72.8, chartPreviousClose: 70.0 }, [72.8]))!;
    expect(r.price).toBe(72.8);
    expect(r.changePct).toBe(4); // (72.8-70)/70 = 4.0%
  });

  it("null change when no previous close anywhere", () => {
    const r = parseYahooChart(chart({ regularMarketPrice: 50 }))!;
    expect(r.price).toBe(50);
    expect(r.changePct).toBeNull();
  });

  it("returns null on missing/invalid price or shape", () => {
    expect(parseYahooChart(chart({ regularMarketPrice: "N/D" }))).toBeNull();
    expect(parseYahooChart({ chart: { result: [] } })).toBeNull();
    expect(parseYahooChart({})).toBeNull();
  });
});

describe("parseDailyClose (Stooq fallback)", () => {
  it("takes the last bar's close and day-over-day change", () => {
    const csv = "Date,Open,High,Low,Close,Volume\n2026-06-13,70.0,71,69,70.0,100\n2026-06-16,71.0,73,70,72.0,120";
    const r = parseDailyClose(csv)!;
    expect(r.price).toBe(72.0);
    expect(r.date).toBe("2026-06-16");
    expect(r.changePct).toBe(2.9); // (72-70)/70 = 2.857% → 2.9
  });

  it("skips N/D rows and still returns the latest valid close", () => {
    const csv = "Date,Open,High,Low,Close,Volume\n2026-06-15,70,71,69,70.0,100\n2026-06-16,N/D,N/D,N/D,N/D,N/D";
    const r = parseDailyClose(csv)!;
    expect(r.price).toBe(70.0);
    expect(r.changePct).toBeNull();
  });

  it("returns null when no valid rows exist", () => {
    expect(parseDailyClose("Date,Open,High,Low,Close\n")).toBeNull();
    expect(parseDailyClose("")).toBeNull();
  });
});
