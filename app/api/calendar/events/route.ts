import { NextResponse } from "next/server";
import { normEmail } from "@/lib/allowlist";
import { auth } from "@/lib/auth";
import { createEvent, updateEvent, deleteEvent } from "@/lib/calendar";
import { checkRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Map a Google write failure to a clean client error. A read-only calendar
// (e.g. the secondary account or a shared/holiday calendar) or a stale event id
// surfaces as 403/404 — tell the client plainly rather than a generic 500.
function writeError(err: unknown): NextResponse {
  const msg = err instanceof Error ? err.message : String(err);
  if (/insufficient.*scope|PERMISSION_DENIED/i.test(msg)) return NextResponse.json({ error: "reauth_required" }, { status: 403 });
  if (/forbidden|read-?only|cannot change|requiredAccessLevel/i.test(msg)) return NextResponse.json({ error: "This calendar is read-only — can't change that event here." }, { status: 403 });
  if (/not found|404|deleted/i.test(msg)) return NextResponse.json({ error: "Event not found — it may have already been moved or deleted." }, { status: 404 });
  console.error("Calendar write failed:", err);
  return NextResponse.json({ error: "Calendar update failed" }, { status: 500 });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!checkRateLimit(`calendar-write:${normEmail(session.user?.email)}`, 500)) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { summary, start, end, description, location, timeZone } = body as Record<string, unknown>;
  if (typeof summary !== "string" || !summary.trim()) {
    return NextResponse.json({ error: "summary is required" }, { status: 400 });
  }
  if (typeof start !== "string" || !start) {
    return NextResponse.json({ error: "start is required" }, { status: 400 });
  }
  if (typeof end !== "string" || !end) {
    return NextResponse.json({ error: "end is required" }, { status: 400 });
  }

  try {
    const event = await createEvent(session.accessToken as string, {
      summary: summary.slice(0, 200),
      start,
      end,
      description: typeof description === "string" ? description.slice(0, 1000) : undefined,
      location: typeof location === "string" ? location.slice(0, 200) : undefined,
      timeZone: typeof timeZone === "string" ? timeZone : undefined,
    });
    return NextResponse.json({ event });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isScope = /insufficient.*scope|forbidden|PERMISSION_DENIED/i.test(msg);
    if (isScope) return NextResponse.json({ error: "reauth_required" }, { status: 403 });
    console.error("Calendar event create failed:", err);
    return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
  }
}

// Move or edit an existing event. Body: { eventId, calendarId?, start?, end?,
// summary?, location?, description?, timeZone? }. Only supplied fields change.
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!checkRateLimit(`calendar-write:${normEmail(session.user?.email)}`, 500)) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { eventId, calendarId, start, end, summary, location, description, timeZone } = body as Record<string, unknown>;

  if (typeof eventId !== "string" || !eventId) return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  // A move must carry both ends so the event can't end up with a start after its end.
  if ((typeof start === "string") !== (typeof end === "string")) {
    return NextResponse.json({ error: "start and end must be supplied together" }, { status: 400 });
  }
  if (start === undefined && summary === undefined && location === undefined && description === undefined) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  try {
    const event = await updateEvent(session.accessToken as string, {
      eventId,
      calendarId: typeof calendarId === "string" ? calendarId : undefined,
      start: typeof start === "string" ? start : undefined,
      end: typeof end === "string" ? end : undefined,
      summary: typeof summary === "string" ? summary.slice(0, 200) : undefined,
      location: typeof location === "string" ? location.slice(0, 200) : undefined,
      description: typeof description === "string" ? description.slice(0, 1000) : undefined,
      timeZone: typeof timeZone === "string" ? timeZone : undefined,
    });
    return NextResponse.json({ event });
  } catch (err) {
    return writeError(err);
  }
}

// Delete (cancel) an event. Body: { eventId, calendarId? }.
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!checkRateLimit(`calendar-write:${normEmail(session.user?.email)}`, 500)) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { eventId, calendarId } = body as Record<string, unknown>;
  if (typeof eventId !== "string" || !eventId) return NextResponse.json({ error: "eventId is required" }, { status: 400 });

  try {
    await deleteEvent(session.accessToken as string, eventId, typeof calendarId === "string" ? calendarId : undefined);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return writeError(err);
  }
}
