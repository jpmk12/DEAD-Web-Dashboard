// Server-only: begin the secondary-Gmail OAuth hop. Shared by the clean
// `/api/auth/gmail-secondary/start` path and the legacy `?step=initiate`
// query so the two cannot drift.
//
// Why a NEW path exists (2026-10-04): the phone kept getting Google's bare
// "400 … malformed" page on "Add second Gmail" while the desktop flow worked
// against the SAME env-pinned redirect_uri. The one thing that differs per
// device is the browser's cache — and mobile Safari had cached the initiate
// → Google redirect from BEFORE the callback moved to a clean path, so every
// tap replayed an authorize URL whose redirect_uri Google rejects. The
// no-store headers only stop RE-caching; a stale entry is keyed by the
// request URL and is never consulted if that URL changes. So the link now
// has a path no browser has ever cached AND a per-tap nonce
// (lib/secondaryStartLink.ts), and this response says no-store three ways.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "./auth";
import { STATE_COOKIE, resolveRedirectUri, buildOAuth2Client } from "./secondaryOAuth";

export async function beginSecondaryOAuth(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  if (!process.env.GOOGLE_CLIENT_ID?.trim() || !process.env.GOOGLE_CLIENT_SECRET?.trim()) {
    return new NextResponse(
      "Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing).",
      { status: 500 },
    );
  }

  const state = crypto.randomUUID();
  const authUrl = buildOAuth2Client(resolveRedirectUri(request.nextUrl.origin)).generateAuthUrl({
    access_type: "offline",
    // `select_account` forces Google's account chooser even when the browser
    // already has an active Google session. This is a "connect a *different*
    // (secondary) account" flow, so without it Google silently reuses the
    // signed-in account (usually the primary) instead of letting the user pick
    // the secondary one. `consent` stays so we always get a refresh token.
    prompt: "select_account consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/calendar.readonly",
    ],
    state,
  });

  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    sameSite: "lax",
    path: "/",
  });

  const res = NextResponse.redirect(authUrl);
  // Belt-and-suspenders against redirect caching (mobile Safari): without this
  // the browser can pin this initiate→Google hop and replay a stale authorize
  // URL whose redirect_uri no longer matches what's registered. `Pragma` and
  // `Expires` cover older WebKit heuristics that ignore Cache-Control alone.
  res.headers.set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  res.headers.set("Vary", "*");
  return res;
}
