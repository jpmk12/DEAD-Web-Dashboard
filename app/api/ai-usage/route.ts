import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOwner } from "@/lib/allowlist";
import { getUserPrefs } from "@/lib/userPrefs";
import { getUsageToday, getUsageLastNDays, getUsageMonthToDate, getUsageByDay } from "@/lib/anthropicLog";

export const dynamic = "force-dynamic";

// Last 4 characters of the live API key, owner-only. Rotating the key means
// pasting it into the hosting UI and hoping the process picked it up; without
// this the only way to confirm which key is actually in use is to spend money
// and go look in the Console. Four characters identify a key against the
// Console's own masked display without being usable for anything.
function keyTail(): string | null {
  const k = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  return k.length >= 8 ? k.slice(-4) : k ? "????" : null;
}

// Today + last-7 + last-30 summaries for the AI control panel. Cheap enough
// to compute on every drawer open (3 aggregations, all indexed).
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prefs = await getUserPrefs().catch(() => null);
  const tz = prefs?.timezone || "America/Chicago";

  // monthToDate matches an Anthropic Console MONTHLY spend threshold; byDay
  // shows whether a month's total came from a steady rate or one bad day.
  const [today, last7, last30, monthToDate, byDay] = await Promise.all([
    getUsageToday(tz),
    getUsageLastNDays(tz, 7),
    getUsageLastNDays(tz, 30),
    getUsageMonthToDate(tz),
    getUsageByDay(tz, 14),
  ]);

  const owner = isOwner(session.user?.email);
  return NextResponse.json({
    tz, today, last7, last30, monthToDate, byDay,
    ...(owner ? { keyTail: keyTail() } : {}),
  });
}
