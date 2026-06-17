import { describe, it, expect } from "vitest";
import { parseLightQuotes, parseDailyClose } from "@/lib/energyPrices";

describe("parseLightQuotes", () => {
  it("parses open/close keyed by lowercased symbol", () => {
    const csv = "Symbol,Date,Time,Open,High,Low,Close\nCL.F,2026-06-16,21:00:00,72.10,73.00,71.50,72.80\nGC.F,2026-06-16,21:00:00,2330.0,2345.0,2320.0,2340.5";
    const m = parseLightQuotes(csv);
    expect(m.get("cl.f")).toEqual({ open: 72.1, close: 72.8, date: "2026-06-16" });
    expect(m.get("gc.f")!.close).toBe(2340.5);
  });

  it("yields NaN closes for N/D cells (so the caller falls back)", () => {
    const csv = "Symbol,Date,Time,Open,High,Low,Close\nCB.F,N/D,N/D,N/D,N/D,N/D,N/D";
    const row = parseLightQuotes(csv).get("cb.f")!;
    expect(Number.isFinite(row.close)).toBe(false);
  });

  it("returns empty for a header-only or junk body", () => {
    expect(parseLightQuotes("Symbol,Date,Open,Close").size).toBe(0);
    expect(parseLightQuotes("").size).toBe(0);
  });
});

describe("parseDailyClose", () => {
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
    expect(r.changePct).toBeNull(); // only one valid row
  });

  it("returns null when no valid rows exist", () => {
    expect(parseDailyClose("Date,Open,High,Low,Close\n")).toBeNull();
    expect(parseDailyClose("")).toBeNull();
  });
});
