import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { getUserPrefs } from "@/lib/userPrefs";
import { assembleFamilyDigest } from "@/lib/family";

export const dynamic = "force-dynamic";

// The Family digest: school + household mail read once and reported as
// deadlines, per-person summaries, and dated items awaiting confirmation.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // OWNER ONLY. The digest embeds the roster — the user's children's names,
  // grades and schools — and would otherwise run the owner's roster as a
  // search against a crew member's own mailbox. Neither is acceptable.
  if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const email = normEmail(session.user?.email);
  const prefs = await getUserPrefs(email).catch(() => null);
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const digest = await assembleFamilyDigest(session.accessToken as string, prefs, email, { refresh });
  return NextResponse.json(digest);
}
