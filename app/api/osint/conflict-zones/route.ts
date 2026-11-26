import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/allowlist";
import { getConflictZones, diagnoseConflictZones } from "@/lib/conflictZonesFetch";

export const dynamic = "force-dynamic";

// Conflict-zone airspace restrictions for the Crisis map's "Conflict zones"
// layer: FAA KICZ NOTAMs / SFARs (binding on U.S. operators) and EASA CZIBs
// (recommendations to EU operators). 1-h cache in the lib. `live:false` =
// UNKNOWN, never "no restrictions". `?diag=1` (owner-only) runs every door
// from production (all hosts are blocked from the dev sandbox).
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ live: false, zones: [] }, { status: 401 });
  if (new URL(req.url).searchParams.get("diag") === "1") {
    if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });
    return NextResponse.json(await diagnoseConflictZones());
  }
  return NextResponse.json(await getConflictZones(), { headers: { "Cache-Control": "private, max-age=600" } });
}
