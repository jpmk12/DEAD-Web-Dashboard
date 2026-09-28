import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { getFamilyProfile } from "@/lib/familyStore";
import { listDeadlines } from "@/lib/familyDeadlineStore";
import { getSightings } from "@/lib/householdStore";
import { familyDates } from "@/lib/familyCalendar";

export const dynamic = "force-dynamic";

// Family dates for the Calendar tab. Read-only, over data already stored — no
// Gmail read, no model call. Owner-only like the rest of the Family tab: the
// rows name the user's children and their bills.
export async function GET() {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(email)) return NextResponse.json({ items: [] });   // crew: quietly nothing, not an error

  const profile = await getFamilyProfile().catch(() => null);
  const [deadlines, sightings] = await Promise.all([
    listDeadlines(email).catch(() => []),
    profile ? getSightings(profile.billers.map((b) => b.id)).catch(() => []) : Promise.resolve([]),
  ]);

  const items = familyDates({
    deadlines,
    billers: profile?.billers ?? [],
    sightings: sightings.map((s) => ({ billerId: s.billerId, seenISO: s.seenISO, dueISO: s.dueISO ?? null })),
    documents: profile?.documents ?? [],
    expectations: profile?.expectations ?? [],
  }, new Date().toISOString().slice(0, 10));

  return NextResponse.json({ items }, { headers: { "Cache-Control": "private, max-age=120" } });
}
