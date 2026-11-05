import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/allowlist";
import { getNavWarnings, diagnoseNavWarnings } from "@/lib/mapHazards";

export const dynamic = "force-dynamic";

// NGA navigational warnings (NAVAREA IV / XII, HYDROLANT / HYDROPAC) for the
// Crisis map's "Nav warnings" layer — operational classes only (firing,
// launch debris, GNSS, mines, security). 30-min cache in the lib.
// `live:false` = UNKNOWN. `?diag=1` (owner-only) runs the real fetch from
// production (the host is blocked from the dev sandbox).
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ live: false, warnings: [] }, { status: 401 });
  if (new URL(req.url).searchParams.get("diag") === "1") {
    if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });
    return NextResponse.json(await diagnoseNavWarnings());
  }
  return NextResponse.json(await getNavWarnings(), { headers: { "Cache-Control": "private, max-age=600" } });
}
