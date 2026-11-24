import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTrendMovers, getNewPairs } from "@/lib/trends";

export const dynamic = "force-dynamic";

// Week-over-week movers from the deterministic trend layer (P1) for the
// TrendStrip, with the 90-day-high flag on new/rising terms and the pairs
// seen together for the first time in 60 days (PLAN §7 E3). Pure SQL — no
// AI cost, no upstream fetches.
// Week-over-week movers do not move in five minutes; the pair read pulls 66
// days of rows into memory. One shared read, kept 5 min (2026-11-24, the
// load-time review — every page load re-ran both queries).
const MEMO_MS = 5 * 60 * 1000;
let memo: { at: number; p: Promise<{ movers: Awaited<ReturnType<typeof getTrendMovers>>; pairs: Awaited<ReturnType<typeof getNewPairs>> }> } | null = null;

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ movers: [] }, { status: 401 });
  if (!memo || Date.now() - memo.at > MEMO_MS) {
    const p = Promise.all([getTrendMovers({ limit: 18, highWater: true }), getNewPairs()]).then(([movers, pairs]) => ({ movers, pairs }));
    memo = { at: Date.now(), p };
    p.catch(() => { if (memo?.p === p) memo = null; });
  }
  return NextResponse.json(await memo.p);
}
