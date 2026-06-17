import { describe, it, expect } from "vitest";
import { parseYahooChart, parseDailyClose } from "@/lib/energyPrices";

describe("parseYahooChart", () => {
  const chart = (meta: Record<string, unknown>) => ({ chart: { result: [{ meta }] } });

  it("reads price + change vs previous close", () => {
    const r = parseYahooChart(chart({ regularMarketPrice: 72.8, chartPreviousClose: 70.0, regularMarketTime: 1750118400 }))!;
    expect(r.price).toBe(72.8);
    expect(r.changePct).toBe(4); // (72.8-70)/70 = 4.0%
    expect(r.date).toBe("2025-06-17");
  });

  it("falls back to previousClose when chartPreviousClose is absent", () => {
    const r = parseYahooChart(chart({ regularMarketPrice: 100, previousClose: 100 }))!;
    expect(r.price).toBe(100);
    expect(r.changePct).toBe(0);
  });

  it("null change when no previous close", () => {
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
