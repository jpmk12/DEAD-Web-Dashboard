import { NextResponse } from "next/server";
import { normEmail } from "@/lib/allowlist";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { getVipSuggestions } from "@/lib/replySignals";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const primaryEmail = (session as { user?: { email?: string } }).user?.email ?? "";
  const prefs = await getUserPrefs(normEmail(session.user?.email)).catch(() => null);

  // Exclude anything the user has already classified or dismissed.
  const exclude = new Set<string>();
  for (const s of prefs?.vipSenders ?? []) exclude.add(s.trim().toLowerCase());
  for (const s of prefs?.muteSenders ?? []) exclude.add(s.trim().toLowerCase());
  for (const s of prefs?.dismissedVipSuggestions ?? []) exclude.add(s.trim().toLowerCase());

  try {
    const suggestions = await getVipSuggestions(
      session.accessToken as string,
      primaryEmail,
      exclude
    );
    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error("VIP suggestions failed:", err);
    return NextResponse.json({ suggestions: [] });
  }
}
