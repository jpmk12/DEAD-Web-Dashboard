import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { getUpcomingEvents } from "@/lib/calendar";
import { COOKIE_NAME, getValidSecondaryToken } from "@/lib/secondaryAuth";
import { CalendarEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const secondaryRaw = cookieStore.get(COOKIE_NAME)?.value;

  let secondaryToken: string | null = null;
  let secondaryEmail: string | undefined;
  if (secondaryRaw) {
    const result = await getValidSecondaryToken(secondaryRaw);
    if (result) {
      secondaryToken = result.payload.access_token;
      secondaryEmail = result.payload.email;
      if (result.refreshedJwe) {
        cookieStore.set(COOKIE_NAME, result.refreshedJwe, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 60 * 60 * 24 * 30,
          path: "/",
        });
      }
    }
  }

  const primaryEmail = session.user?.email ?? undefined;

  try {
    const [primaryEvents, secondaryResult] = await Promise.all([
      getUpcomingEvents(session.accessToken as string, primaryEmail),
      secondaryToken
        ? getUpcomingEvents(secondaryToken, secondaryEmail)
            .then((events) => ({ events, error: undefined as string | undefined }))
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              const isScope = /insufficient.*scope|scope.*insufficient|forbidden|PERMISSION_DENIED/i.test(msg);
              return {
                events: [] as CalendarEvent[],
                error: isScope
                  ? "scope_error"
                  : "fetch_error",
              };
            })
        : Promise.resolve({ events: [] as CalendarEvent[], error: undefined as string | undefined }),
    ]);

    // Deduplicate across accounts by event ID
    const seen = new Set<string>();
    const events = [...primaryEvents, ...secondaryResult.events]
      .filter((e) => {
        if (!e.id || seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      })
      .sort((a, b) => a.start.localeCompare(b.start));

    return NextResponse.json({
      events,
      ...(secondaryResult.error ? { secondaryError: secondaryResult.error, secondaryEmail } : {}),
    });
  } catch {
    console.error("Calendar API: failed to fetch events");
    return NextResponse.json({ error: "Failed to fetch calendar" }, { status: 500 });
  }
}
