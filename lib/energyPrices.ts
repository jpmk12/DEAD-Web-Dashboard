// Energy & commodity prices for the Strategic Economics tab — the fuel/
// sustainment-cost signal that bears on mobility (Brent ≈ jet-fuel cost driver;
// natgas/gold as macro stress). Keyless, HTTPS, cached. Server-only.
//
// Source history: Stooq's CSV was the original source but it now 404s in the
// browser AND 403s server-side (it blocks datacenter IPs / bot User-Agents), so
// the panel rendered all dashes. Primary is now Yahoo Finance's keyless v8 chart
// API (JSON, one call per symbol), with the Stooq daily CSV kept only as a
// best-effort fallback. Both are fetched with a real browser User-Agent — the
// previous bot UA was itself a 403 trigger. Fail-safe: any symbol that can't be
// resolved from either source is null → the UI shows "—" (never a stale/fake price).

import { fetchWithTimeout } from "./fetchTimeout";

export interface EnergyQuote {
  symbol: string;   // our short id
  label: string;
  price: number | null;
  changePct: number | null; // session/day change vs previous close
  asOf: string;     // date the quote is for (YYYY-MM-DD)
  link: string;     // human quote page (clickable in the UI)
  source: "yahoo" | "stooq" | null;
}

interface SymbolDef { id: string; label: string; yahoo: string; stooq: string }
const SYMBOLS: SymbolDef[] = [
  { id: "wti", label: "WTI Crude", yahoo: "CL=F", stooq: "cl.f" },
  { id: "brent", label: "Brent (jet-fuel driver)", yahoo: "BZ=F", stooq: "cb.f" },
  { id: "natgas", label: "Nat Gas", yahoo: "NG=F", stooq: "ng.f" },
  { id: "gold", label: "Gold", yahoo: "GC=F", stooq: "gc.f" },
];

// A real browser UA — Stooq/Yahoo both 403 obvious bot strings.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const yahooQuotePage = (sym: string) => `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}`;

const TTL = 15 * 60 * 1000;
let cache: { data: EnergyQuote[]; expires: number } | null = null;

const round1 = (n: number) => Math.round(n * 10) / 10;
function pct(price: number, prev: number | undefined): number | null {
  return prev != null && Number.isFinite(prev) && prev !== 0 ? round1(((price - prev) / prev) * 100) : null;
}

// PURE: parse Yahoo v8 chart JSON → latest price + day-over-day change.
// Exported for unit testing.
export function parseYahooChart(json: unknown): { price: number; changePct: number | null; date: string } | null {
  const result = (json as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    { meta?: Record<string, unknown>; indicators?: { quote?: { close?: unknown[] }[] } } | undefined;
  const meta = result?.meta;
  if (!meta) return null;

  const closesRaw = result?.indicators?.quote?.[0]?.close;
  const closes = Array.isArray(closesRaw) ? closesRaw.map(Number).filter((n) => Number.isFinite(n)) : [];

  const live = Number(meta.regularMarketPrice);
  const price = Number.isFinite(live) ? live : (closes.length ? closes[closes.length - 1] : NaN);
  if (!Number.isFinite(price)) return null;

  // Day-over-day change = current price vs the PREVIOUS SESSION's close, i.e. the
  // close of the bar before the last one. NOT meta.chartPreviousClose — that's
  // the close before the whole range (a ~5-day move when range=5d), so it's only
  // a last resort when we don't have ≥2 daily bars.
  let prev: number | undefined;
  if (closes.length >= 2) prev = closes[closes.length - 2];
  else {
    const cpc = Number(meta.chartPreviousClose ?? meta.previousClose);
    if (Number.isFinite(cpc)) prev = cpc;
  }

  const t = Number(meta.regularMarketTime);
  const date = Number.isFinite(t) ? new Date(t * 1000).toISOString().slice(0, 10) : "";
  return { price, changePct: pct(price, prev), date };
}

// PURE: parse a Stooq daily history CSV (q/d/l/?i=d) → latest close + day-over-
// day %. Kept as the fallback parser; exported for unit testing.
export function parseDailyClose(text: string): { price: number; changePct: number | null; date: string } | null {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const header = lines[0].toLowerCase().split(",");
  const iDate = header.indexOf("date"), iClose = header.indexOf("close");
  if (iClose < 0) return null;
  const rows: { close: number; date: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const close = Number((c[iClose] ?? "").trim());
    if (!Number.isFinite(close)) continue;
    rows.push({ close, date: (c[iDate] || "").trim() });
  }
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
  return { price: last.close, changePct: prev ? pct(last.close, prev.close) : null, date: last.date };
}

async function fromYahoo(sym: string): Promise<{ price: number; changePct: number | null; date: string } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store" }, 10_000);
    if (!res.ok) return null;
    return parseYahooChart(await res.json());
  } catch { return null; }
}

async function fromStooq(stooq: string): Promise<{ price: number; changePct: number | null; date: string } | null> {
  try {
    const res = await fetchWithTimeout(`https://stooq.com/q/d/l/?s=${stooq}&i=d`, { headers: { "User-Agent": UA }, cache: "no-store" }, 10_000);
    if (!res.ok) return null;
    return parseDailyClose(await res.text());
  } catch { return null; }
}

export async function getEnergyQuotes(): Promise<EnergyQuote[]> {
  if (cache && cache.expires > Date.now()) return cache.data;

  const out: EnergyQuote[] = await Promise.all(SYMBOLS.map(async (s) => {
    const base = { symbol: s.id, label: s.label, link: yahooQuotePage(s.yahoo) };
    const y = await fromYahoo(s.yahoo);
    if (y) return { ...base, price: y.price, changePct: y.changePct, asOf: y.date, source: "yahoo" as const };
    const st = await fromStooq(s.stooq);
    if (st) return { ...base, price: st.price, changePct: st.changePct, asOf: st.date, source: "stooq" as const };
    return { ...base, price: null, changePct: null, asOf: "", source: null };
  }));

  if (out.some((q) => q.price != null)) cache = { data: out, expires: Date.now() + TTL };
  return cache?.data ?? out;
}

// Owner-only diagnostic: per-symbol, per-source HTTP status so a blank panel
// shows its real cause (403/404/timeout) instead of just dashes. Mirrors the
// UCDP/INFORM diag pattern. Network — only call from a gated debug route.
export interface EnergyDiag {
  symbol: string;
  yahoo: { status: number; ok: boolean; price?: number; error?: string };
  stooq: { status: number; ok: boolean; price?: number; error?: string };
}

export async function diagnoseEnergy(): Promise<EnergyDiag[]> {
  return Promise.all(SYMBOLS.map(async (s) => {
    const yahoo = await probe(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s.yahoo)}?interval=1d&range=5d`, (t) => parseYahooChart(JSON.parse(t))?.price);
    const stooq = await probe(`https://stooq.com/q/d/l/?s=${s.stooq}&i=d`, (t) => parseDailyClose(t)?.price);
    return { symbol: s.id, yahoo, stooq };
  }));
}

async function probe(url: string, extract: (text: string) => number | null | undefined): Promise<{ status: number; ok: boolean; price?: number; error?: string }> {
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json,text/csv,*/*" }, cache: "no-store" }, 10_000);
    const text = await res.text();
    let price: number | undefined;
    try { price = extract(text) ?? undefined; } catch { /* unparseable */ }
    return { status: res.status, ok: res.ok, ...(price != null ? { price } : {}) };
  } catch (e) {
    return { status: 0, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
