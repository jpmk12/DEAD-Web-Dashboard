import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { getUsageToday, getUsageLastNDays, getUsageMonthToDate, getUsageByDay } from "@/lib/anthropicLog";

export const dynamic = "force-dynamic";

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

  return NextResponse.json({ tz, today, last7, last30, monthToDate, byDay });
}
