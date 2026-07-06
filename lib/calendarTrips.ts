import type { CalendarEvent } from "./types";
import { getUpcomingEvents } from "./calendar";
import { geocodePlace } from "./geocode";
import { detectTripEvents } from "./tripSuggest";
import { upsertCalendarTrip, listActiveCalendarTrips, deleteTrip } from "./trips";

// Auto-activate TDY from the calendar: a trip-like event (multi-day OR a travel
// keyword) with a geocodable location that covers today becomes an active trip
// with no manual entry. Calendar trips are kept reconciled with the calendar —
// moved/deleted events update or drop their trip — and never touch hand-entered
// (source='manual') trips. Server-only (DB + Google API).

// In-process throttle. The sync is triggered opportunistically from multiple
// routes (/api/trips, /api/news) on a single dashboard load; without this each
// would re-fetch the calendar and re-geocode. We only really run it every
// SYNC_INTERVAL_MS — concurrent callers share the in-flight promise, and later
// callers inside the window no-op (the DB writes from the last run still stand).
const SYNC_INTERVAL_MS = 10 * 60 * 1000;
// Throttle state is PER USER — a global window would let one user's poll
// starve every other user's calendar-trip auto-activation indefinitely
// (and hand user B a promise that is syncing user A's calendar).
const syncState = new Map<string, { lastSyncAt: number; inFlight: Promise<void> | null }>();

export async function syncCalendarTripsThrottled(email: string, accessToken: string, today: string): Promise<void> {
  const st = syncState.get(email) ?? { lastSyncAt: 0, inFlight: null };
  syncState.set(email, st);
  if (st.inFlight) return st.inFlight;
  if (Date.now() - st.lastSyncAt < SYNC_INTERVAL_MS) return;
  st.inFlight = (async () => {
    try {
      const events = await getUpcomingEvents(accessToken);
      await syncCalendarTrips(email, events, today);
      st.lastSyncAt = Date.now();
    } catch {
      // Best-effort: auto-activation must never break the page that triggered it.
    } finally {
      st.inFlight = null;
    }
  })();
  return st.inFlight;
}

// Reconcile calendar-derived trips with the calendar for `today`: upsert every
// qualifying event, then drop any calendar trip covering today whose source
// event no longer qualifies (deleted, moved off today, or location removed).
export async function syncCalendarTrips(email: string, events: CalendarEvent[], today: string): Promise<void> {
  const qualifying = detectTripEvents(events, today);
  const wantIds = new Set<string>();
  for (const q of qualifying) {
    if (!q.eventId) continue;
    const geo = await geocodePlace(q.location);
    if (!geo) continue; // un-geocodable today → just skip; pruning handles removal
    wantIds.add(q.eventId);
    await upsertCalendarTrip(email, {
      eventId: q.eventId,
      label: q.label || geo.label,
      location: q.location,
      lat: geo.lat,
      lon: geo.lon,
      startDate: q.startDate,
      endDate: q.endDate,
    });
  }
  const active = await listActiveCalendarTrips(email, today);
  for (const t of active) {
    if (!t.eventId || !wantIds.has(t.eventId)) await deleteTrip(email, t.id);
  }
}
