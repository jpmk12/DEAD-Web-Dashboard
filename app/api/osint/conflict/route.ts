import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getConflictPoints, getConflictHealth } from "@/lib/conflictEvents";

export const dynamic = "force-dynamic";

// Recent armed-conflict / kinetic events for the Crisis map's "Conflict" layer,
// sourced from UCDP (lib/conflictEvents) so the AI crisis read shares the same
// cache. Returns simplified points { lat, lon, name, count, title?, url? }.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ points: [] }, { status: 401 });
  const points = await getConflictPoints();
  // ok=false means UCDP was unreachable / returned nothing — "source down",
  // not "the world is quiet". stale=true means we're serving recent cached
  // points after a failed refresh (a transient blip, not down). The map shows a
  // source badge from these.
  const h = getConflictHealth();
  return NextResponse.json({ points, ok: h.ok, stale: h.stale ?? false, source: h.source ?? null });
}
