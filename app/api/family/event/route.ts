import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createEvent } from "@/lib/calendar";
import { getUserPrefs } from "@/lib/userPrefs";
import { normEmail } from "@/lib/allowlist";
import { isAnchoredDate, endForEvent, type ProposedEvent } from "@/lib/familyDates";
import { checkRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Write ONE confirmed date to the calendar. Nothing else in this feature
// writes: the digest proposes, this route is the human's tap. A payload whose
// date is not explicitly anchored is refused outright — that guard is the
// whole reason relative dates ("next Friday") are surfaced rather than
// resolved, and it must hold at the write boundary too, not just in the UI.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Throttled because this writes to an external service the user cannot
  // easily un-write in bulk. A client-side retry loop reaching this route
  // would otherwise fill a real calendar before anyone noticed.
  if (!checkRateLimit("family-event", 2_000)) {
    return NextResponse.json({ error: "Too fast — one event at a time." }, { status: 429 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const ev = (body as { event?: ProposedEvent })?.event;
  if (!ev || typeof ev.title !== "string" || !ev.title.trim()) {
    return NextResponse.json({ error: "Missing event" }, { status: 400 });
  }
  if (!isAnchoredDate(ev.startISO)) {
    return NextResponse.json(
      { error: "This date was never confirmed — open the email and set a date first." },
      { status: 422 },
    );
  }

  const end = endForEvent(ev);
  if (!end) return NextResponse.json({ error: "Could not derive an end time" }, { status: 422 });

  const prefs = await getUserPrefs(normEmail(session.user?.email)).catch(() => null);
  try {
    const created = await createEvent(session.accessToken as string, {
      summary: ev.title.slice(0, 200),
      description: ev.sourceLabel ? `From family mail — ${ev.sourceLabel}` : "Added from the Family tab",
      start: ev.startISO as string,
      end,
      timeZone: prefs?.timezone || "America/Chicago",
    });
    return NextResponse.json({ ok: true, event: created });
  } catch (err) {
    console.error("Family calendar insert failed:", err);
    return NextResponse.json({ error: "Calendar rejected the event" }, { status: 502 });
  }
}
