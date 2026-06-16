import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { getForceProtection } from "@/lib/forceProtection";

export const dynamic = "force-dynamic";

// Force Protection Watch board: per-location fused threat posture for the user's
// watched force locations. Same upstream data as the Crisis map; cached 10 min.
const TTL = 10 * 60 * 1000;
let cache: { body: unknown; expires: number } | null = null;

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (cache && cache.expires > Date.now()) return NextResponse.json(cache.body);

  try {
    const prefs = await getUserPrefs().catch(() => null);
    const locations = prefs?.forceLocations ?? [];
    if (locations.length === 0) {
      return NextResponse.json({ assessments: [], generatedAt: new Date().toISOString(), sources: { gps: false, acled: false, conflict: "none" }, empty: true });
    }
    const result = await getForceProtection(locations);
    cache = { body: result, expires: Date.now() + TTL };
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "force-protection read failed" }, { status: 502 });
  }
}
