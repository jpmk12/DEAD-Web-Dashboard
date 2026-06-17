// Energy & commodity prices via Stooq's keyless quote CSV — the fuel/sustainment
// and macro-stress signals that bear on mobility (Brent ≈ jet-fuel cost driver;
// natgas/gold as macro stress). Keyless, HTTPS, cached. Server-only.

import { fetchWithTimeout } from "./fetchTimeout";

export interface EnergyQuote {
  symbol: string;   // our short id
  label: string;
  price: number | null;
  changePct: number | null; // session change (close vs open)
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

export async function getEnergyQuotes(): Promise<EnergyQuote[]> {
  if (cache && cache.expires > Date.now()) return cache.data;

  const ids = SYMBOLS.map((s) => s.stooq).join(",");
  const url = `https://stooq.com/q/l/?s=${ids}&f=sd2t2ohlc&h&e=csv`;
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)" }, cache: "no-store" }, 10_000);
    if (!res.ok) throw new Error(`stooq ${res.status}`);
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error("empty");
    const header = lines[0].toLowerCase().split(",");
    const iSym = header.indexOf("symbol"), iDate = header.indexOf("date"),
      iOpen = header.indexOf("open"), iClose = header.indexOf("close");
    const bySymbol = new Map<string, { open: number; close: number; date: string }>();
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(",");
      const sym = (c[iSym] || "").toLowerCase();
      const open = Number(c[iOpen]), close = Number(c[iClose]);
      if (!sym) continue;
      bySymbol.set(sym, { open, close, date: c[iDate] || "" });
    }
    const out: EnergyQuote[] = SYMBOLS.map((s) => {
      const row = bySymbol.get(s.stooq);
      const price = row && Number.isFinite(row.close) ? row.close : null;
      const changePct = row && Number.isFinite(row.open) && Number.isFinite(row.close) && row.open !== 0
        ? Math.round(((row.close - row.open) / row.open) * 1000) / 10
        : null;
      return { symbol: s.symbol, label: s.label, price, changePct, asOf: row?.date ?? "" };
    });
    // Only cache if at least one symbol resolved (don't pin an all-empty result).
    if (out.some((q) => q.price != null)) cache = { data: out, expires: Date.now() + TTL };
    return cache?.data ?? out;
  } catch {
    return cache?.data ?? SYMBOLS.map((s) => ({ symbol: s.symbol, label: s.label, price: null, changePct: null, asOf: "" }));
  }
}
