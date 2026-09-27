import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { getUserPrefs } from "@/lib/userPrefs";
import { assembleFamilyDigest } from "@/lib/family";

export const dynamic = "force-dynamic";

// The Family digest: school + household mail read once and reported as
// deadlines, per-person summaries, and dated items awaiting confirmation.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const email = normEmail(session.user?.email);
  const prefs = await getUserPrefs(email).catch(() => null);
  const digest = await assembleFamilyDigest(session.accessToken as string, prefs, email);
  return NextResponse.json(digest);
}
