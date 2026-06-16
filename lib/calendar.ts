import { calendar as calendarApi, type calendar_v3 } from "@googleapis/calendar";
import { OAuth2Client } from "google-auth-library";
import { CalendarEvent } from "./types";

type TaggedEvent = { item: calendar_v3.Schema$Event; calendarId: string };

export interface CreateEventParams {
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  timeZone?: string;  // IANA timezone e.g. "America/New_York"; defaults to "UTC"
}

export async function getUpcomingEvents(
  accessToken: string,
  accountEmail?: string
): Promise<CalendarEvent[]> {
  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const calendar = calendarApi({ version: "v3", auth: oauth2Client });
  const timeMin = new Date().toISOString();

  // List all calendars for this account
  let calendarIds: string[];
  try {
    const listRes = await calendar.calendarList.list({ maxResults: 50 });
    calendarIds = (listRes.data.items ?? [])
      .map((c) => c.id)
      .filter((id): id is string => Boolean(id));
  } catch {
    calendarIds = ["primary"];
  }

  if (calendarIds.length === 0) calendarIds = ["primary"];

  // Fetch events from all calendars in parallel; ignore failures per calendar.
  // Tag each event with the calendarId it came from — needed to patch/delete it
  // later (Google's events.patch/delete require calendarId + eventId).
  const allResults = await Promise.all(
    calendarIds.map((calendarId) =>
      calendar.events
        .list({
          calendarId,
          timeMin,
          maxResults: 30,
          singleEvents: true,
          orderBy: "startTime",
        })
        .then((res) => (res.data.items ?? []).map((item) => ({ item, calendarId })))
        .catch(() => [] as TaggedEvent[])
    )
  );

  // Deduplicate by event ID (same event may appear across multiple calendars)
  const seen = new Set<string>();
  const merged = allResults.flat().filter(({ item: e }) => {
    const key = e.id ?? e.iCalUID ?? "";
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  merged.sort((a, b) => {
    const aTime = a.item.start?.dateTime ?? a.item.start?.date ?? "";
    const bTime = b.item.start?.dateTime ?? b.item.start?.date ?? "";
    return aTime.localeCompare(bTime);
  });

  return merged.slice(0, 40).map(({ item: event, calendarId }) => {
    // Pull non-self attendee emails. Used by /api/meeting-prep to find
    // recent mail from each attendee.
    const attendeeEmails = (event.attendees ?? [])
      .filter((a) => a.email && !a.self)
      .map((a) => a.email!.toLowerCase())
      .filter((e) => /^[^@\s]+@[^@\s]+/.test(e))
      .slice(0, 10);
    return {
      id: event.id ?? "",
      title: event.summary ?? "Untitled Event",
      start: event.start?.dateTime ?? event.start?.date ?? "",
      end: event.end?.dateTime ?? event.end?.date ?? "",
      description: event.description?.slice(0, 500) ?? undefined,
      location: event.location ?? undefined,
      isAllDay: !event.start?.dateTime,
      ...(accountEmail ? { account: accountEmail } : {}),
      calendarId,
      ...(attendeeEmails.length ? { attendees: attendeeEmails } : {}),
    };
  });
}

export interface UpdateEventParams {
  eventId: string;
  calendarId?: string;     // defaults to "primary"
  summary?: string;
  start?: string;
  end?: string;
  description?: string;
  location?: string;
  timeZone?: string;
}

// Patch an existing event — used to move (start/end) or edit (title/location/
// description) it. Only the supplied fields change. start/end must be supplied
// together (Google rejects a half-moved event). Returns the updated event.
export async function updateEvent(accessToken: string, params: UpdateEventParams): Promise<CalendarEvent> {
  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });
  const calendar = calendarApi({ version: "v3", auth: oauth2Client });

  const calendarId = params.calendarId || "primary";
  const tz = params.timeZone ?? "UTC";
  const hasOffset = (dt: string) => /Z$|[+-]\d{2}:\d{2}$/.test(dt);

  const requestBody: calendar_v3.Schema$Event = {};
  if (params.summary !== undefined) requestBody.summary = params.summary;
  if (params.description !== undefined) requestBody.description = params.description;
  if (params.location !== undefined) requestBody.location = params.location;
  if (params.start) {
    const isAllDay = !params.start.includes("T");
    requestBody.start = isAllDay ? { date: params.start } : { dateTime: params.start, ...(hasOffset(params.start) ? {} : { timeZone: tz }) };
  }
  if (params.end) {
    const isAllDay = !params.end.includes("T");
    requestBody.end = isAllDay ? { date: params.end } : { dateTime: params.end, ...(hasOffset(params.end) ? {} : { timeZone: tz }) };
  }

  const res = await calendar.events.patch({ calendarId, eventId: params.eventId, requestBody });
  const e = res.data;
  return {
    id: e.id ?? "",
    title: e.summary ?? "Untitled Event",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    description: e.description?.slice(0, 500) ?? undefined,
    location: e.location ?? undefined,
    isAllDay: !e.start?.dateTime,
    calendarId,
  };
}

// Delete (cancel) an event. calendarId defaults to "primary".
export async function deleteEvent(accessToken: string, eventId: string, calendarId?: string): Promise<void> {
  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });
  const calendar = calendarApi({ version: "v3", auth: oauth2Client });
  await calendar.events.delete({ calendarId: calendarId || "primary", eventId });
}

export async function createEvent(accessToken: string, params: CreateEventParams): Promise<CalendarEvent> {
  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });
  const calendar = calendarApi({ version: "v3", auth: oauth2Client });

  const isAllDay = !params.start.includes("T");
  // Google Calendar requires timeZone on dateTime fields unless the string already
  // carries offset info (ends with Z or ±HH:MM). Fall back to UTC if not supplied.
  const tz = params.timeZone ?? "UTC";
  const hasOffset = (dt: string) => /Z$|[+-]\d{2}:\d{2}$/.test(dt);

  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: params.summary,
      ...(params.description ? { description: params.description } : {}),
      ...(params.location ? { location: params.location } : {}),
      start: isAllDay
        ? { date: params.start }
        : { dateTime: params.start, ...(hasOffset(params.start) ? {} : { timeZone: tz }) },
      end: isAllDay
        ? { date: params.end }
        : { dateTime: params.end, ...(hasOffset(params.end) ? {} : { timeZone: tz }) },
    },
  });

  const e = res.data;
  return {
    id: e.id ?? "",
    title: e.summary ?? "Untitled Event",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    description: e.description?.slice(0, 500) ?? undefined,
    location: e.location ?? undefined,
    isAllDay: !e.start?.dateTime,
  };
}
