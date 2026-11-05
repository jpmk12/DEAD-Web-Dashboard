import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/allowlist";
import { getSigmets, diagnoseSigmets } from "@/lib/mapHazards";

export const dynamic = "force-dynamic";

// SIGMETs (NWS Aviation Weather Center — international + domestic U.S.) for
// the Crisis map's "SIGMETs" layer. 10-min cache in the lib. `live:false` =
// UNKNOWN, never "no hazards". `?diag=1` (owner-only) runs the real fetch
// from production (the host is blocked from the dev sandbox).
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ live: false, sigmets: [] }, { status: 401 });
  if (new URL(req.url).searchParams.get("diag") === "1") {
    if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });
    return NextResponse.json(await diagnoseSigmets());
  }
  return NextResponse.json(await getSigmets(), { headers: { "Cache-Control": "private, max-age=300" } });
}
