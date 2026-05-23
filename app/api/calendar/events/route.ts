import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createEvent } from "@/lib/calendar";
import { checkRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!checkRateLimit("calendar-write", 500)) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

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
