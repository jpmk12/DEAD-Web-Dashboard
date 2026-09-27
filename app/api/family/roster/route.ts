import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/allowlist";
import { getFamilyProfile, saveFamilyProfile } from "@/lib/familyStore";
import { sanitizeFamilyProfile } from "@/lib/familyProfile";
import { resetFamilyCache } from "@/lib/family";

export const dynamic = "force-dynamic";

// Roster CRUD. Deliberately its own route rather than a field on the
// user-prefs POST: the pane never round-trips the whole prefs object, so a
// Preferences save can't wipe the roster (the lesson from sitrep_bases).
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Owner-only on READ as well as write: this names the user's children and
  // the schools they attend.
  if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  return NextResponse.json({ profile: await getFamilyProfile() });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Owner-only: the roster is household config, not a per-crew preference.
  if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  try {
    const saved = await saveFamilyProfile(sanitizeFamilyProfile((body as { profile?: unknown })?.profile));
    resetFamilyCache();   // the roster is part of the digest cache key AND its query
    return NextResponse.json({ profile: saved });
  } catch (err) {
    // Without this the route throws, Next returns an HTML 500, the client's
    // res.json() fails and the user sees only "Save failed" — the same opaque
    // degradation the AI routes had. This is owner-only, so naming the real
    // database error is useful rather than a disclosure.
    console.error("Family roster save failed:", err);
    const msg = err instanceof Error ? err.message : "Unknown database error";
    return NextResponse.json({ error: `Could not save the roster: ${msg}` }, { status: 500 });
  }
}
