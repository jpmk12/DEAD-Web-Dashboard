import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLaunches } from "@/lib/spaceSources";

export const dynamic = "force-dynamic";

// Crisis-map "Launches" layer (REVIEW-CYBER-SPACE §4.4): pads with a launch
// in the last 7 or next 14 days (Launch Library 2), with T-minus/T-plus,
// provider country and status. A launch window closes airspace and sea
// lanes the same way a TFR does — that is why it sits on the crisis map.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = await getLaunches();
  const now = Date.now();
  const day = 86_400_000;
  const launches = r.launches
    .filter((l) => l.lat != null && l.lon != null)
    .map((l) => ({ ...l, tMs: Date.parse(l.net) }))
    .filter((l) => Number.isFinite(l.tMs) && l.tMs >= now - 7 * day && l.tMs <= now + 14 * day)
    .sort((a, b) => a.tMs - b.tMs)
    .slice(0, 80)
    .map((l) => ({ name: l.name, net: l.net, provider: l.provider, country: l.country, padName: l.padName, lat: l.lat, lon: l.lon, status: l.status, hoursFromNow: Math.round((l.tMs - now) / 3_600_000) }));
  return NextResponse.json({ live: r.live, launches });
}
