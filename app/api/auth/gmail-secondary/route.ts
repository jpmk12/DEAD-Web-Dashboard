import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { COOKIE_NAME, decryptToken } from "@/lib/secondaryAuth";
import { STATE_COOKIE, resolveRedirectUri, buildOAuth2Client } from "@/lib/secondaryOAuth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const step = request.nextUrl.searchParams.get("step");
  const cookieStore = await cookies();

  // ── Status check ──────────────────────────────────────────────────────────
  if (step === "status") {
    const raw = cookieStore.get(COOKIE_NAME)?.value;
    if (!raw) return NextResponse.json({ connected: false });
    const payload = await decryptToken(raw);
    if (!payload) return NextResponse.json({ connected: false });
    return NextResponse.json({ connected: true, email: payload.email });
  }

  // ── Debug ────────────────────────────────────────────────────────────────
  // Owner-only (the whole GET is behind auth()): returns the exact redirect_uri
  // the flow will send to Google so it can be matched against the OAuth client's
  // "Authorized redirect URIs" without decoding a cryptic Google error page.
  if (step === "debug") {
    return NextResponse.json({
      redirectUri: resolveRedirectUri(request.nextUrl.origin),
      fromEnv: !!process.env.GMAIL_SECONDARY_REDIRECT_URI?.trim(),
      clientIdSet: !!process.env.GOOGLE_CLIENT_ID?.trim(),
      clientSecretSet: !!process.env.GOOGLE_CLIENT_SECRET?.trim(),
    });
  }

  // ── Initiate ───────────────────────────────────────────────────────────────
  if (step === "initiate") {
    if (!process.env.GOOGLE_CLIENT_ID?.trim() || !process.env.GOOGLE_CLIENT_SECRET?.trim()) {
      return new NextResponse(
        "Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing).",
        { status: 500 },
      );
    }
    const state = crypto.randomUUID();
    const authUrl = buildOAuth2Client(resolveRedirectUri(request.nextUrl.origin)).generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/calendar.readonly",
      ],
      state,
    });
    cookieStore.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      sameSite: "lax",
      path: "/",
    });
    return NextResponse.redirect(authUrl);
  }

  // The OAuth callback now lives at /api/auth/gmail-secondary/callback (a clean
  // path, not ?step=callback) — see that route.
  return new NextResponse("Unknown step", { status: 400 });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const step = request.nextUrl.searchParams.get("step");
  if (step !== "revoke") return new NextResponse("Unknown step", { status: 400 });

  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;

  if (raw) {
    const payload = await decryptToken(raw);
    if (payload?.access_token) {
      // Token in POST body — never in the URL
      fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: payload.access_token }),
      }).catch(() => {});
    }
  }

  cookieStore.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return NextResponse.json({ ok: true });
}
