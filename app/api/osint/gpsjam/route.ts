import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GPS interference / EW awareness via GPSJam (gpsjam.org), proxied server-side
// (CSP-safe). GPSJam aggregates ADS-B navigation-accuracy degradation into H3
// resolution-4 hexes daily. We return elevated cells as { h3, level } (1 = mod,
// 2 = high) for the Crisis map's "GPS" layer.
//
// The daily file is CSV (not JSON — an earlier .json guess 404'd): one row per
// H3 cell. Columns vary in spelling across GPSJam's history, so the header is
// parsed and columns matched by fuzzy name: an h3/hex id, and either a bad
// fraction directly or good+bad counts to derive it. Coarse OSINT, not
// authoritative. GPSJam publishes the prior day's file ~04:00 UTC, so today's
// may 404 early — we fall back to yesterday.
const TTL = 60 * 60 * 1000; // daily data → 1 h cache
let cache: { hexes: Hex[]; date: string; expires: number } | null = null;

interface Hex { h3: string; level: number }
const ymd = (d: Date) => d.toISOString().slice(0, 10);

// Returns the CSV text, or null on failure.
async function fetchDay(date: string): Promise<string | null> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`https://gpsjam.org/data/${date}-h3_4.csv`, {
      signal: ctrl.signal, headers: { "User-Agent": "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)", Accept: "text/csv,*/*" }, cache: "no-store",
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

// Minimal CSV split that tolerates quoted fields (GPSJam's hex ids and counts
// are unquoted, but be safe).
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function colIndex(headers: string[], names: string[]): number {
  return headers.findIndex((h) => names.includes(h.trim().toLowerCase()));
}

function parse(csv: string): Hex[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const hexCol = colIndex(headers, ["hex", "h3", "cell", "index", "id"]);
  const badCol = colIndex(headers, ["bad", "bad_count", "count_bad", "numbad", "b"]);
  const goodCol = colIndex(headers, ["good", "good_count", "count_good", "numgood", "g"]);
  const totalCol = colIndex(headers, ["count", "total", "n", "num"]);
  const fracCol = colIndex(headers, ["frac", "bad_frac", "badfrac", "fraction", "f"]);
  if (hexCol < 0) return []; // no recognizable id column → bail (the diag shows the header)

  const out: Hex[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const h3 = String(cells[hexCol] ?? "").trim();
    if (!h3 || h3.length < 8) continue;
    const bad = badCol >= 0 ? Number(cells[badCol]) : NaN;
    const good = goodCol >= 0 ? Number(cells[goodCol]) : NaN;
    const total = totalCol >= 0 ? Number(cells[totalCol]) : NaN;
    const fracDirect = fracCol >= 0 ? Number(cells[fracCol]) : NaN;
    const denom = Number.isFinite(total) ? total : (Number.isFinite(good) && Number.isFinite(bad) ? good + bad : NaN);
    const bf = Number.isFinite(fracDirect) ? fracDirect
      : Number.isFinite(bad) && Number.isFinite(denom) && denom > 0 ? bad / denom
      : NaN;
    if (!Number.isFinite(bf)) continue;
    const level = bf >= 0.5 ? 2 : bf >= 0.15 ? 1 : 0;
    if (level >= 1) out.push({ h3, level });
  }
  return out.slice(0, 2500);
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ hexes: [] }, { status: 401 });
  if (cache && cache.expires > Date.now()) return NextResponse.json({ ok: true, hexes: cache.hexes, date: cache.date });

  const today = ymd(new Date());
  const yesterday = ymd(new Date(Date.now() - 86_400_000));
  let date = today;
  let csv = await fetchDay(today);
  if (csv == null) { csv = await fetchDay(yesterday); date = yesterday; }
  if (csv == null) return NextResponse.json({ ok: false, hexes: [] }); // upstream unreachable — NOT "no interference"

  const hexes = parse(csv);
  // Only cache a parse that actually yielded cells — an empty parse may mean the
  // CSV columns shifted, and we don't want to pin that for an hour.
  if (hexes.length > 0) cache = { hexes, date, expires: Date.now() + TTL };
  return NextResponse.json({ ok: true, hexes, date });
}
