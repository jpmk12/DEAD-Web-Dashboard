import { NextRequest, NextResponse } from "next/server";
import { gmail as gmailApi } from "@googleapis/gmail";
import { OAuth2Client } from "google-auth-library";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { COOKIE_NAME, encryptToken, decryptToken } from "@/lib/secondaryAuth";

const STATE_COOKIE = "gmail_oauth_state";

// The redirect_uri MUST be byte-for-byte one of the "Authorized redirect URIs"
// registered on the Google OAuth client, or Google rejects the authorize
// request (shown as "redirect_uri_mismatch" on desktop, but as a bare generic
// "400 … malformed" page on mobile browsers — same error, different rendering).
//
// Resolve it per-request so it follows whatever host the user actually reached
// the app on, instead of a hardcoded localhost default that's never valid in
// production. An explicit GMAIL_SECONDARY_REDIRECT_URI still wins (trimmed, so a
// stray newline pasted into the hosting env UI can't break the exact match).
// Both the initiate and callback legs call this with the same request origin, so
// the two redirect_uri values always agree (a requirement for the token swap).
function resolveRedirectUri(request: NextRequest): string {
  const env = process.env.GMAIL_SECONDARY_REDIRECT_URI?.trim();
  if (env) return env;
  return `${request.nextUrl.origin}/api/auth/gmail-secondary?step=callback`;
}

function buildOAuth2Client(redirectUri: string) {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID?.trim(),
    process.env.GOOGLE_CLIENT_SECRET?.trim(),
    redirectUri
  );
}

// Use Gmail API to get the email — requires only gmail.modify scope which we already request.
// The userinfo/tokeninfo endpoints require the openid+email scope which we don't request.
async function getEmailFromToken(accessToken: string): Promise<string> {
  try {
    const auth = new OAuth2Client();
    auth.setCredentials({ access_token: accessToken });
    const gmail = gmailApi({ version: "v1", auth });
    const profile = await gmail.users.getProfile({ userId: "me" });
    return profile.data.emailAddress ?? "";
  } catch {
    return "";
  }
}

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
  // "Authorized redirect URIs". Surfaces config mismatches without decoding a
  // cryptic Google error page.
  if (step === "debug") {
    return NextResponse.json({
      redirectUri: resolveRedirectUri(request),
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
    const authUrl = buildOAuth2Client(resolveRedirectUri(request)).generateAuthUrl({
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

  // ── Callback ───────────────────────────────────────────────────────────────
  if (step === "callback") {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const savedState = cookieStore.get(STATE_COOKIE)?.value;

    // Clear state cookie immediately to prevent replay
    cookieStore.set(STATE_COOKIE, "", { maxAge: 0, path: "/" });

    if (!code || !state || !savedState || state !== savedState) {
      return new NextResponse("Invalid OAuth state", { status: 400 });
    }

    const oauth2Client = buildOAuth2Client(resolveRedirectUri(request));
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
      // `account=secondary` fetches 401 ("switches to the other account and
      // errors out"). Matches the refresh write-backs in the gmail/newsletters/
      // calendar routes and NextAuth's own session cookie.
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });

    return NextResponse.redirect(
      new URL("/?tab=email", process.env.NEXTAUTH_URL ?? "http://localhost:3000")
    );
  }

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
