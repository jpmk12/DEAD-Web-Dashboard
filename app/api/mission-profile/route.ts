import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { getMissionProfile, saveMissionProfile, applyMissionProfile } from "@/lib/missionProfileApply";
import { sanitizeMissionProfile } from "@/lib/missionProfile";
import { clearBriefingCache } from "@/lib/briefingCache";

export const dynamic = "force-dynamic";

// Mission Profile — the declaration the tracking lists derive from.
//   GET  → { profile, canEdit }   (derivation preview is computed client-side;
//                                  lib/missionProfile is pure and client-safe)
//   PUT  { profile }              → owner-only: save the declaration
//   POST { profile, sitrepPicks } → owner-only: save + derive + MATERIALIZE
//                                   into the existing user_prefs tracking lists
// The materialized fields are team config, so writes are owner-gated like the
// user-prefs POST.

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = normEmail(session.user?.email);
  try {
    return NextResponse.json({ profile: await getMissionProfile(), canEdit: isOwner(email) });
  } catch {
    return NextResponse.json({ profile: null, canEdit: isOwner(email) });
  }
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(normEmail(session.user?.email))) {
    return NextResponse.json({ error: "The Mission Profile is shared team config — owner only." }, { status: 403 });
  }
  let body: { profile?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const profile = sanitizeMissionProfile(body.profile);
  try {
    await saveMissionProfile(profile);
    return NextResponse.json({ ok: true, profile });
  } catch {
    return NextResponse.json({ error: "Could not save — database unavailable." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(normEmail(session.user?.email))) {
    return NextResponse.json({ error: "The Mission Profile is shared team config — owner only." }, { status: 403 });
  }
  let body: { profile?: unknown; sitrepPicks?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const picks = Array.isArray(body.sitrepPicks)
    ? body.sitrepPicks.filter((p): p is string => typeof p === "string").slice(0, 4)
    : [];
  try {
    const result = await applyMissionProfile(body.profile, picks);
    // Materializing changes team tracking config → every user's brief is stale.
    clearBriefingCache().catch((err) => console.error("Briefing cache invalidation failed:", err));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("mission-profile apply failed:", err);
    return NextResponse.json({ error: "Apply failed — database unavailable." }, { status: 500 });
  }
}
