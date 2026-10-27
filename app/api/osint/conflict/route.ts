import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getConflictPoints, getConflictHealth, type ConflictPoint } from "@/lib/conflictEvents";
import { getCapturedEvents } from "@/lib/eventStore";
import { kineticEvents } from "@/lib/kineticEvents";

export const dynamic = "force-dynamic";

// Recent armed-conflict / kinetic events for the Crisis map's "Conflict" layer,
// sourced from UCDP (lib/conflictEvents) so the AI crisis read shares the same
// cache, PLUS the user's own browser-captured map events (LiveUAMap) read as
// kinetic acts with a REPORTED position (lib/kineticEvents) — the timeliest
// points the app holds while ACLED's free tier embargoes the last year. A
// country-centroid placement is never drawn here (the map is a map).
// Returns simplified points { lat, lon, name, count, title?, url?, src, date? }.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ points: [] }, { status: 401 });
  const [points, captured] = await Promise.all([
    getConflictPoints(),
    getCapturedEvents(300).catch(() => []),
  ]);
  const capturedPoints: ConflictPoint[] = kineticEvents(captured, Date.now())
    .filter((e) => e.placement === "reported")
    .map((e) => ({ lat: e.lat, lon: e.lon, name: e.country ?? e.region, count: 1, title: e.title, url: e.url, src: "liveuamap" as const, date: e.pubDate.slice(0, 10), country: e.country ?? undefined }));
  // ok=false means UCDP was unreachable / returned nothing — "source down",
  // not "the world is quiet". stale=true means we're serving recent cached
  // points after a failed refresh (a transient blip, not down). The map shows a
  // source badge from these.
  const h = getConflictHealth();
  // The lib caches points in-memory for 30 min; let the browser reuse the
  // response for 5 min too (private — it's behind auth) so repeat map opens /
  // the 5-min client poll don't round-trip to the server every time.
  return NextResponse.json(
    { points: [...points, ...capturedPoints], ok: h.ok, stale: h.stale ?? false, source: h.source ?? null, captured: capturedPoints.length },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
