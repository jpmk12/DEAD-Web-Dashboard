import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTrendMovers, getNewPairs } from "@/lib/trends";

export const dynamic = "force-dynamic";

// Week-over-week movers from the deterministic trend layer (P1) for the
// TrendStrip, with the 90-day-high flag on new/rising terms and the pairs
// seen together for the first time in 60 days (PLAN §7 E3). Pure SQL — no
// AI cost, no upstream fetches.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ movers: [] }, { status: 401 });
  const [movers, pairs] = await Promise.all([getTrendMovers({ limit: 18, highWater: true }), getNewPairs()]);
  return NextResponse.json({ movers, pairs });
}
