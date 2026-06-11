import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTrendMovers } from "@/lib/trends";

export const dynamic = "force-dynamic";

// Week-over-week movers from the deterministic trend layer (P1) for the
// TrendStrip. Pure SQL — no AI cost, no upstream fetches.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ movers: [] }, { status: 401 });
  const movers = await getTrendMovers({ limit: 18 });
  return NextResponse.json({ movers });
}
