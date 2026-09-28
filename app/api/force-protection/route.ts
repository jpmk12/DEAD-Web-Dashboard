import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { getForceProtectionCached } from "@/lib/forceProtectionCached";

export const dynamic = "force-dynamic";

// Force Protection Watch board: per-location fused threat posture for the user's
// watched force locations. Same upstream data as the Crisis map. The 10-min,
// signature-keyed cache lives in lib/forceProtectionCached.ts so the alert
// check, the assistant and the demand horizon share this gather.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const prefs = await getUserPrefs().catch(() => null);
    const countries = prefs?.countriesOfInterest ?? [];
    const bases = prefs?.forceLocations ?? [];
    if (countries.length === 0 && bases.length === 0) {
      return NextResponse.json({ assessments: [], generatedAt: new Date().toISOString(), sources: { gps: false, acled: false, aviationWx: false, notams: "off", conflict: "none" }, empty: true });
    }
    const result = await getForceProtectionCached(countries, bases);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "force-protection read failed" }, { status: 502 });
  }
}
