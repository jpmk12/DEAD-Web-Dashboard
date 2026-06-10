import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getConflictPoints } from "@/lib/conflictEvents";

export const dynamic = "force-dynamic";

// Recent armed-conflict / kinetic-event density for the Crisis map's "Conflict"
// layer. The fetch/parse/cache lives in lib/conflictEvents so the AI crisis read
// can share the same query and cache. Returns simplified points
// { lat, lon, name, count, title?, url? }. Coarse OSINT, not a curated product.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ points: [] }, { status: 401 });
  const points = await getConflictPoints();
  return NextResponse.json({ points });
}
