import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/allowlist";
import { getMaradAdvisories, diagnoseMarad } from "@/lib/marad";

export const dynamic = "force-dynamic";

// MARAD MSCI advisories — the U.S. government's standing statement of threat
// to shipping by region. 1-h cache in the lib; the chokepoint read joins the
// same body. `?diag=1` (owner-only) runs the real fetch from production and
// returns status + snippet + what parsed — the host is unreachable from the
// dev sandbox, so this is how "blocked" or "title shape changed" is told
// apart from "nothing in effect".
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ advisories: [], live: false }, { status: 401 });

  if (new URL(req.url).searchParams.get("diag") === "1") {
    if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });
    return NextResponse.json(await diagnoseMarad());
  }

  const body = await getMaradAdvisories();
  return NextResponse.json(body, { headers: { "Cache-Control": "private, max-age=600" } });
}
