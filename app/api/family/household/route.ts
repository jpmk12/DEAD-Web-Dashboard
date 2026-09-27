import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { getUserPrefs } from "@/lib/userPrefs";
import { assembleHouseholdDigest } from "@/lib/household";

export const dynamic = "force-dynamic";

// Household pane: bills, silence watch, document runway, wellbeing admin.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Owner-only for the same reason as the school digest, and more so: this
  // reads financial mail and reports amounts and account tails.
  if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const email = normEmail(session.user?.email);
  const prefs = await getUserPrefs(email).catch(() => null);
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  try {
    const digest = await assembleHouseholdDigest(session.accessToken as string, prefs, email, { refresh });
    return NextResponse.json(digest);
  } catch (err) {
    console.error("Household digest failed:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Household digest failed: ${msg}` }, { status: 500 });
  }
}
