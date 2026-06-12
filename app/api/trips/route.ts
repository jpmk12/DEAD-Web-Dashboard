import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { todayInTz } from "@/lib/date";
import { geocodePlace } from "@/lib/geocode";
import { listTrips, getActiveTrip, createTrip, deleteTrip } from "@/lib/trips";

export const dynamic = "force-dynamic";

// TDY / travel trips. The active trip becomes the user's effective location
// (overrides home for weather + local news + the morning brief).
//   GET    → { trips, active }
//   POST   → { location, startDate, endDate, label?, notes? } — geocoded server-side
//   DELETE → ?id=<id>

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const prefs = await getUserPrefs().catch(() => null);
  const tz = prefs?.timezone || "America/Chicago";
  const [trips, active] = await Promise.all([
    listTrips().catch(() => []),
    getActiveTrip(todayInTz(tz)).catch(() => null),
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

  const trip = await createTrip({
    label: label || geo.label,
    location,
    lat: geo.lat,
    lon: geo.lon,
    startDate,
    endDate,
    notes,
  });
  return NextResponse.json({ ok: true, trip });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await deleteTrip(id);
  return NextResponse.json({ ok: true });
}
