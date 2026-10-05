import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { normEmail } from "@/lib/allowlist";
import { getActiveTrip } from "@/lib/trips";
import { ensureTripTz } from "@/lib/timezoneLookup";
import { resolveZone, zoneLabel, DEFAULT_ZONE } from "@/lib/effectiveZone";
import { isValidTz } from "@/lib/worldClocks";
import { todayInTz } from "@/lib/date";

export const dynamic = "force-dynamic";

// The effective zone for THIS request: the client passes its device zone,
// the server adds the saved preference and the active trip, and one rule
// (lib/effectiveZone) decides. Glance, the brief prefetch and the modal all
// read this so the rail, the schedule and the prose agree on what "today"
// and "3:00 AM" mean.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = normEmail(session.user?.email);
  const device = new URL(request.url).searchParams.get("device") ?? "";
  const deviceOk = device && isValidTz(device) ? device : null;
  const prefs = await getUserPrefs(email).catch(() => null);
  const lookupDay = todayInTz(deviceOk ?? prefs?.timezone ?? DEFAULT_ZONE);
  const trip = await getActiveTrip(email, lookupDay).catch(() => null);
  const tripTz = await ensureTripTz(email, trip);
  const r = resolveZone({ mode: prefs?.timezoneMode, pref: prefs?.timezone, device: deviceOk, trip: tripTz });
  return NextResponse.json({
    zone: r.zone,
    source: r.source,
    label: zoneLabel(r.zone),
    device: deviceOk,
    trip: trip ? { label: trip.label, endDate: trip.endDate, tz: tripTz } : null,
  });
}
