import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { COOKIE_NAME, encryptToken } from "@/lib/secondaryAuth";
import { STATE_COOKIE, resolveRedirectUri, buildOAuth2Client, getEmailFromToken } from "@/lib/secondaryOAuth";

export const dynamic = "force-dynamic";

// Google redirects here after the user consents (clean path, no query string —
// see lib/secondaryOAuth.ts for why). Exchanges the code, stores the encrypted
// token in an httpOnly cookie, and returns the user to the Email tab.
export async function GET(request: NextRequest) {
  const base = process.env.NEXTAUTH_URL ?? request.nextUrl.origin;
  const session = await auth();
  if (!session) {
    // The primary session was not present when Google returned (mobile:
    // the OAuth hop can land in a browser context whose cookie jar is not
    // the one that started it). A bare 401 here used to strand the user,
    // who then signed in fresh — and Google, with the second account now
    // active, signed them in AS the second account. Send them to the login
    // page with the reason; it names the primary account to Google.
    const res = NextResponse.redirect(new URL("/login?error=SecondaryNoSession&callbackUrl=%2F%3Ftab%3Demail", base));
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }

  const cookieStore = await cookies();
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const savedState = cookieStore.get(STATE_COOKIE)?.value;

  // Clear state cookie immediately to prevent replay
  cookieStore.set(STATE_COOKIE, "", { maxAge: 0, path: "/" });

  if (!code || !state || !savedState || state !== savedState) {
    return new NextResponse("Invalid OAuth state", { status: 400 });
  }

  // redirect_uri in the token swap must match the one sent at initiate.
  const oauth2Client = buildOAuth2Client(resolveRedirectUri(request.nextUrl.origin));
  let tokens: { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null };
  try {
    ({ tokens } = await oauth2Client.getToken(code));
  } catch {
    return new NextResponse("Token exchange failed", { status: 400 });
  }

  if (!tokens.access_token) {
    return new NextResponse("No access token returned", { status: 400 });
  }

  // Use Authorization header — token never touches a URL
  const email = await getEmailFromToken(tokens.access_token);

  // A "second" account that IS the primary is not a second account. Google's
  // chooser does not know which one we already hold, so a tap on the wrong
  // row (or a browser with only the primary signed in) came back as a
  // duplicate: both chips showed the same address and the user read it as
  // the dashboard having switched accounts. Refuse it, keep the primary
  // untouched, and say so on the Email tab.
  const primary = (session.user?.email ?? "").trim().toLowerCase();
  if (email && primary && email.trim().toLowerCase() === primary) {
    fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.access_token }),
    }).catch(() => {});
    const res = NextResponse.redirect(new URL("/?tab=email&secondary=same", base));
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }

  const encrypted = await encryptToken({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? undefined,
    expiry_date: tokens.expiry_date ?? Date.now() + 3600 * 1000,
    email,
  });

  cookieStore.set(COOKIE_NAME, encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // `lax` (not `strict`) so the cookie survives the cross-site OAuth return:
    // mobile Safari withholds a freshly-set `strict` cookie on the requests
    // immediately following a cross-site redirect, which made the first
    // `account=secondary` fetches 401. Matches the refresh write-backs in the
    // gmail/newsletters/calendar routes and NextAuth's own session cookie.
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });

  const res = NextResponse.redirect(new URL("/?tab=email&secondary=added", base));
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
