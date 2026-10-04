import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { COOKIE_NAME, decryptToken } from "@/lib/secondaryAuth";
import { resolveRedirectUri } from "@/lib/secondaryOAuth";
import { beginSecondaryOAuth } from "@/lib/secondaryStart";

// Never let a browser cache these responses — mobile Safari in particular caches
// redirects, and a cached `initiate` → Google redirect pins a stale authorize URL
// (with a one-time state and a possibly-outdated redirect_uri), so the flow keeps
// replaying an old request instead of building a fresh one.
export const dynamic = "force-dynamic";

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
    // Both callbacks this app ever sends to Google, as THIS request would
    // build them. Google's bare "400 … malformed" page on a phone carries no
    // detail; a redirect-URI mismatch is the usual cause, and these two
    // strings are what must appear byte-for-byte under the OAuth client's
    // "Authorized redirect URIs". `requestOrigin` shows what the proxy
    // presented, so a host mismatch between devices is visible too.
    const authBase = (process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "").trim();
    const primaryRedirectUri = `${authBase ? new URL(authBase).origin : request.nextUrl.origin}/api/auth/callback/google`;
    return NextResponse.json({
      redirectUri: resolveRedirectUri(request.nextUrl.origin),
      fromEnv: !!process.env.GMAIL_SECONDARY_REDIRECT_URI?.trim(),
      primaryRedirectUri,
      primaryFromEnv: !!authBase,
      requestOrigin: request.nextUrl.origin,
      clientIdSet: !!process.env.GOOGLE_CLIENT_ID?.trim(),
      clientSecretSet: !!process.env.GOOGLE_CLIENT_SECRET?.trim(),
    });
  }

  // ── Initiate (legacy query form) ──────────────────────────────────────────
  // The UI links to the clean /api/auth/gmail-secondary/start path (see
  // lib/secondaryStart.ts for why); this form is kept for old bookmarks.
  if (step === "initiate") return beginSecondaryOAuth(request);

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
