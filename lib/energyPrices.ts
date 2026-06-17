// Energy & commodity prices via Stooq's keyless CSV — the fuel/sustainment and
// macro-stress signals that bear on mobility (Brent ≈ jet-fuel cost driver;
// natgas/gold as macro stress). Keyless, HTTPS, cached. Server-only.
//
// Two Stooq endpoints, in order:
//   1. the light snapshot  q/l/?s=…&f=sd2t2ohlc  — one call, all symbols, gives
//      open+close for the session change.
//   2. per-symbol daily CSV  q/d/l/?s=…&i=d  — fallback for any symbol the
//      snapshot returns as "N/D" (the continuous-futures ".f" symbols often have
//      no intraday OHLC between sessions, which is what blanked the panel). Last
//      bar = latest close; change is vs the prior bar's close.

import { fetchWithTimeout } from "./fetchTimeout";

export interface EnergyQuote {
  symbol: string;   // our short id
  label: string;
  price: number | null;
  changePct: number | null; // session change (close vs open), or day-over-day from the daily fallback
  asOf: string;     // date the quote is for
}

// Stooq symbol → our display. cl.f WTI, cb.f Brent, ng.f Henry Hub, gc.f gold.
const SYMBOLS: { stooq: string; symbol: string; label: string }[] = [
  { stooq: "cl.f", symbol: "wti", label: "WTI Crude" },
  { stooq: "cb.f", symbol: "brent", label: "Brent (jet-fuel driver)" },
  { stooq: "ng.f", symbol: "natgas", label: "Nat Gas" },
  { stooq: "gc.f", symbol: "gold", label: "Gold" },
];

const TTL = 15 * 60 * 1000;
let cache: { data: EnergyQuote[]; expires: number } | null = null;

const UA = "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)";

// Stooq writes "N/D" (no data) into OHLC cells when a symbol has no quote for the
// requested period — Number("N/D") is NaN, so guard with Number.isFinite.
function num(v: string | undefined): number {
  return Number((v ?? "").trim());
}

// PURE: parse the light snapshot CSV (q/l/ with f=sd2t2ohlc). Returns open/close
// keyed by lowercased Stooq symbol. Exported for unit testing.
export function parseLightQuotes(text: string): Map<string, { open: number; close: number; date: string }> {
  const out = new Map<string, { open: number; close: number; date: string }>();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return out;
  const header = lines[0].toLowerCase().split(",");
  const iSym = header.indexOf("symbol"), iDate = header.indexOf("date"),
    iOpen = header.indexOf("open"), iClose = header.indexOf("close");
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const sym = (c[iSym] || "").toLowerCase().trim();
    if (!sym) continue;
    out.set(sym, { open: num(c[iOpen]), close: num(c[iClose]), date: (c[iDate] || "").trim() });
  }
  return out;
}

// PURE: parse a daily history CSV (q/d/l/?i=d) → latest close + day-over-day %.
// Exported for unit testing.
export function parseDailyClose(text: string): { price: number; changePct: number | null; date: string } | null {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const header = lines[0].toLowerCase().split(",");
  const iDate = header.indexOf("date"), iClose = header.indexOf("close");
  if (iClose < 0) return null;
  // Collect valid (finite-close) rows in file order; Stooq returns oldest→newest.
  const rows: { close: number; date: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const close = num(c[iClose]);
    if (!Number.isFinite(close)) continue;
    rows.push({ close, date: (c[iDate] || "").trim() });
  }
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
  const changePct = prev && prev.close !== 0
    ? Math.round(((last.close - prev.close) / prev.close) * 1000) / 10
    : null;
  return { price: last.close, changePct, date: last.date };
}

async function dailyFallback(stooq: string): Promise<{ price: number; changePct: number | null; date: string } | null> {
  try {
    const res = await fetchWithTimeout(
      `https://stooq.com/q/d/l/?s=${stooq}&i=d`,
      { headers: { "User-Agent": UA }, cache: "no-store" }, 10_000,
    );
    if (!res.ok) return null;
    return parseDailyClose(await res.text());
  } catch {
    return null;
  }
}

export async function getEnergyQuotes(): Promise<EnergyQuote[]> {
  if (cache && cache.expires > Date.now()) return cache.data;

  let snapshot = new Map<string, { open: number; close: number; date: string }>();
  try {
    const ids = SYMBOLS.map((s) => s.stooq).join(",");
    const url = `https://stooq.com/q/l/?s=${ids}&f=sd2t2ohlc&h&e=csv`;
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA }, cache: "no-store" }, 10_000);
    if (res.ok) snapshot = parseLightQuotes(await res.text());
  } catch { /* fall through to per-symbol daily fallback below */ }

  // Build from the snapshot; for any symbol with no finite close, fetch its daily
  // history (in parallel). This is what un-blanks the panel when ".f" symbols
  // come back "N/D" on the light endpoint.
  const out: EnergyQuote[] = await Promise.all(SYMBOLS.map(async (s) => {
    const row = snapshot.get(s.stooq);
    if (row && Number.isFinite(row.close)) {
      const changePct = Number.isFinite(row.open) && row.open !== 0
        ? Math.round(((row.close - row.open) / row.open) * 1000) / 10
        : null;
      return { symbol: s.symbol, label: s.label, price: row.close, changePct, asOf: row.date };
    }
    const daily = await dailyFallback(s.stooq);
    if (daily) return { symbol: s.symbol, label: s.label, price: daily.price, changePct: daily.changePct, asOf: daily.date };
    return { symbol: s.symbol, label: s.label, price: null, changePct: null, asOf: "" };
  }));

  // Only cache if at least one symbol resolved (don't pin an all-empty result).
  if (out.some((q) => q.price != null)) cache = { data: out, expires: Date.now() + TTL };
  return cache?.data ?? out;
}
