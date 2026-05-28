import { NextResponse } from "next/server";
import { calendar as calendarApi } from "@googleapis/calendar";
import { OAuth2Client } from "google-auth-library";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { generateIcal } from "@/lib/ical";
import type { CalendarEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

// Returns an RFC 5545 iCalendar feed of the user's upcoming Google Calendar
// events (90-day window across all of the user's calendars), suitable for
// download or for the "Open in Apple Calendar" webcal:// link in Settings.
// Session-authenticated — the URL only works from a logged-in browser.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: session.accessToken });
  const cal = calendarApi({ version: "v3", auth: oauth2Client });

  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  // Discover calendars; fall back to "primary" if listing fails.
  let calendarIds: string[];
  try {
    const list = await cal.calendarList.list({ maxResults: 50 });
    calendarIds = (list.data.items ?? [])
      .map((c) => c.id)
      .filter((id): id is string => Boolean(id));
  } catch {
    calendarIds = ["primary"];
  }
  if (calendarIds.length === 0) calendarIds = ["primary"];

  // Fetch events from every calendar in parallel; ignore per-calendar failures.
  const allEvents = await Promise.all(
    calendarIds.map((id) =>
      cal.events
        .list({
          calendarId: id,
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 250,
        })
        .then((r) => r.data.items ?? [])
        .catch(() => [])
    )
  );

  // Deduplicate (same event may appear under multiple calendars) and map to
  // the internal CalendarEvent shape used by the iCal generator.
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];
  for (const raw of allEvents.flat()) {
    const key = raw.id ?? raw.iCalUID ?? "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    events.push({
      id: raw.id ?? "",
      title: raw.summary ?? "Untitled Event",
      start: raw.start?.dateTime ?? raw.start?.date ?? "",
      end: raw.end?.dateTime ?? raw.end?.date ?? "",
      description: raw.description?.slice(0, 2000),
      location: raw.location ?? undefined,
      isAllDay: !raw.start?.dateTime,
    });
  }

  // Use the user's preferred timezone for X-WR-TIMEZONE + TZID parameters.
  const prefs = await getUserPrefs().catch(() => null);
  const tz = prefs?.timezone || "UTC";

  const body = generateIcal(events, {
    calendarName: "DEAD’s Dashboard",
    defaultTimeZone: tz,
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="calendar.ics"',
      "Cache-Control": "no-store",
    },
  });
}
