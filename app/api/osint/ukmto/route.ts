import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/allowlist";
import { getUkmtoIncidents, diagnoseUkmto } from "@/lib/ukmto";

export const dynamic = "force-dynamic";

// UKMTO recent incidents for the Crisis map's Maritime layer (and anything
// else that wants the merged list). 15-min cache in the lib; the chokepoint
// read joins the same body. `?diag=1` (owner-only) runs the real fetch from
// production and returns status + snippet — the host could not be reached
// from the dev sandbox, so this is how "blocked" or "markup changed" is
// told apart from "quiet".
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ incidents: [], ok: false }, { status: 401 });

  if (new URL(req.url).searchParams.get("diag") === "1") {
    if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });
    return NextResponse.json(await diagnoseUkmto());
  }

  const body = await getUkmtoIncidents();
  return NextResponse.json(body, { headers: { "Cache-Control": "private, max-age=300" } });
}
