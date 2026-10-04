import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { PRIMARY_HINT_COOKIE, PRIMARY_HINT_MAX_AGE, normalizeHint } from "@/lib/primaryHint";

export const dynamic = "force-dynamic";

// Remember, on THIS device, which account is the primary — so the next primary
// sign-in (weekly, when the refresh token lapses) names it to Google instead
// of taking whatever account happens to be active in the browser (which, after
// connecting a second Gmail, is the second Gmail). Server-set and httpOnly on
// purpose: iOS caps script-written cookies at 7 days, which is exactly the
// cadence this has to outlive. The value is the signed-in email, nothing else.
export async function POST() {
  const session = await auth();
  const email = normalizeHint(session?.user?.email);
  if (!session || !email) return NextResponse.json({ ok: false }, { status: 401 });
  const store = await cookies();
  store.set(PRIMARY_HINT_COOKIE, email, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: PRIMARY_HINT_MAX_AGE,
    path: "/",
  });
  return NextResponse.json({ ok: true });
}
