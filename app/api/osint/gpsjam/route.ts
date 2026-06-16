import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getGpsInterference } from "@/lib/gpsjam";

export const dynamic = "force-dynamic";

// GPS interference / EW awareness via GPSJam, proxied server-side (CSP-safe).
// The fetch/parse/cache now lives in lib/gpsjam.ts (shared with the Force
// Protection scorer); this route just exposes elevated cells for the map's
// "GPS" layer as { h3, level } (1 = moderate, 2 = high).
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ hexes: [] }, { status: 401 });
  const { ok, hexes, date } = await getGpsInterference();
  return NextResponse.json({ ok, hexes, date });
}
