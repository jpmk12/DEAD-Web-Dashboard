import { NextResponse } from "next/server";
import { normEmail } from "@/lib/allowlist";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { todayInTz } from "@/lib/date";
import { geocodePlace } from "@/lib/geocode";
import { listTrips, getActiveTrip, createTrip, updateTrip, deleteTrip, getTripById } from "@/lib/trips";
import { syncCalendarTripsThrottled } from "@/lib/calendarTrips";
import { clearBriefingCache } from "@/lib/briefingCache";

export const dynamic = "force-dynamic";

// TDY / travel trips. The active trip becomes the user's effective location
// (overrides home for weather + local news + the morning brief).
//   GET    → { trips, active }
//   POST   → { location, startDate, endDate, label?, notes? } — geocoded server-side
//   PATCH  → { id, startDate?, endDate?, label? } — edit a manual trip in place
//   DELETE → ?id=<id>

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// A trip change moves the user's effective location, which feeds the Morning
// Brief (cached per date+tz). Drop that cache so the brief reflects the change
// today instead of replaying this morning's version. Best-effort.
function invalidateBrief() {
  clearBriefingCache().catch((err) => console.error("Briefing cache invalidation failed:", err));
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const prefs = await getUserPrefs().catch(() => null);
  const tz = prefs?.timezone || "America/Chicago";
  // Auto-activate TDY from trip-like calendar events before reading (throttled,
  // best-effort) so an active trip appears without a manual entry.
  await syncCalendarTripsThrottled(normEmail(session.user?.email), session.accessToken as string, todayInTz(tz)).catch(() => {});
  const [trips, active] = await Promise.all([
    listTrips(normEmail(session.user?.email)).catch(() => []),
    getActiveTrip(normEmail(session.user?.email), todayInTz(tz)).catch(() => null),
  ]);
  return NextResponse.json({ trips, active });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { location?: unknown; startDate?: unknown; endDate?: unknown; label?: unknown; notes?: unknown } = {};
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const location = String(body.location ?? "").trim().slice(0, 200);
  const startDate = String(body.startDate ?? "").trim();
  const endDate = String(body.endDate ?? "").trim();
  const label = String(body.label ?? "").trim().slice(0, 120);
  const notes = body.notes ? String(body.notes).slice(0, 500) : null;

  if (!location) return NextResponse.json({ error: "A location is required" }, { status: 400 });
  if (!YMD.test(startDate) || !YMD.test(endDate)) return NextResponse.json({ error: "Start and end dates are required (YYYY-MM-DD)" }, { status: 400 });
  if (endDate < startDate) return NextResponse.json({ error: "End date can't be before the start date" }, { status: 400 });

  const geo = await geocodePlace(location);
  if (!geo) return NextResponse.json({ error: `Couldn't locate "${location}" — try a city + state/country.` }, { status: 422 });

  const trip = await createTrip(normEmail(session.user?.email), {
    label: label || geo.label,
    location,
    lat: geo.lat,
    lon: geo.lon,
    startDate,
    endDate,
    notes,
  });
  invalidateBrief();
  return NextResponse.json({ ok: true, trip });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { id?: unknown; startDate?: unknown; endDate?: unknown; label?: unknown } = {};
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await getTripById(normEmail(session.user?.email), id);
  if (!existing) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  // Calendar-derived trips mirror a calendar event; editing them here would be
  // undone by the next sync. Point the user at the real source instead.
  if (existing.source === "calendar") {
    return NextResponse.json(
      { error: "This trip is synced from a calendar event — change the event's dates and it'll update automatically." },
      { status: 409 },
    );
  }

  // Merge supplied fields over the existing values, then validate the result.
  const startDate = body.startDate !== undefined ? String(body.startDate).trim() : existing.startDate;
  const endDate = body.endDate !== undefined ? String(body.endDate).trim() : existing.endDate;
  const label = body.label !== undefined ? String(body.label).trim().slice(0, 120) : undefined;
  if (!YMD.test(startDate) || !YMD.test(endDate)) return NextResponse.json({ error: "Dates must be YYYY-MM-DD" }, { status: 400 });
  if (endDate < startDate) return NextResponse.json({ error: "End date can't be before the start date" }, { status: 400 });
  if (label !== undefined && !label) return NextResponse.json({ error: "Label can't be empty" }, { status: 400 });

  const trip = await updateTrip(normEmail(session.user?.email), id, { startDate, endDate, ...(label !== undefined ? { label } : {}) });
  invalidateBrief();
  return NextResponse.json({ ok: true, trip });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await deleteTrip(normEmail(session.user?.email), id);
  invalidateBrief();
  return NextResponse.json({ ok: true });
}
