import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GPS interference / EW awareness via GPSJam (gpsjam.org), proxied server-side
// (CSP-safe). GPSJam aggregates ADS-B navigation-accuracy degradation into H3
// resolution-4 hexes daily. We return elevated cells as { h3, level } (1 = mod,
// 2 = high) for the Crisis map's "GPS" layer.
//
// NOTE: the upstream JSON key names couldn't be confirmed from the build sandbox
// (host blocked), so the parser is deliberately shape-tolerant — arrays
// [h3,good,bad] or objects with several common key spellings, or a direct bad
// fraction. If a deploy shows the layer empty while gpsjam.org has data, the
// only fix is matching the real keys here. Coarse OSINT, not authoritative.
const TTL = 60 * 60 * 1000; // daily data → 1 h cache
let cache: { hexes: Hex[]; date: string; expires: number } | null = null;

interface Hex { h3: string; level: number }
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function fetchDay(date: string): Promise<unknown> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`https://gpsjam.org/data/${date}-h3_4.json`, {
      signal: ctrl.signal, headers: { "User-Agent": "DEAD-Dashboard (github.com/jpmk12/dead-web-dashboard)" }, cache: "no-store",
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

function parse(data: unknown): Hex[] {
  let arr: unknown[] = [];
  if (Array.isArray(data)) arr = data;
  else if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    arr = (Array.isArray(o.data) ? o.data : Array.isArray(o.hexes) ? o.hexes : Array.isArray(o.cells) ? o.cells : Array.isArray(o.features) ? o.features : []) as unknown[];
  }
  const out: Hex[] = [];
  for (const e of arr) {
    let h3 = "", good = NaN, bad = NaN, frac = NaN;
    if (Array.isArray(e)) {
      h3 = String(e[0] ?? ""); good = Number(e[1]); bad = Number(e[2]);
    } else if (e && typeof e === "object") {
      const r = e as Record<string, unknown>;
      const props = (typeof r.properties === "object" && r.properties) ? (r.properties as Record<string, unknown>) : r;
      h3 = String(props.hex ?? props.h3 ?? props.h ?? props.cell ?? props.index ?? props.id ?? "");
      good = Number(props.good ?? props.g ?? props.count_good ?? props.numGood);
      bad = Number(props.bad ?? props.b ?? props.count_bad ?? props.numBad);
      frac = Number(props.frac ?? props.bad_frac ?? props.badFrac ?? props.f);
    }
    if (!h3 || h3.length < 8) continue;
    const bf = Number.isFinite(frac) ? frac
      : Number.isFinite(good) && Number.isFinite(bad) && good + bad > 0 ? bad / (good + bad)
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
  let data = await fetchDay(today);
  if (!data) { data = await fetchDay(yesterday); date = yesterday; }
  if (!data) return NextResponse.json({ ok: false, hexes: [] }); // upstream unreachable — NOT "no interference"

  const hexes = parse(data);
  cache = { hexes, date, expires: Date.now() + TTL };
  return NextResponse.json({ ok: true, hexes, date });
}
