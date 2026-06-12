import { gmail as gmailApi } from "@googleapis/gmail";
import { OAuth2Client } from "google-auth-library";

// CSRF state cookie for the secondary-Gmail OAuth round-trip.
export const STATE_COOKIE = "gmail_oauth_state";

// Path-based callback — NO query string. Google's authorize endpoint rejects
// some query-string redirect_uri values as malformed (which renders on mobile as
// a bare "400 … malformed" page), and every other OAuth callback we run —
// including our own primary NextAuth callback — is a clean path. Keep this shape.
export const CALLBACK_PATH = "/api/auth/gmail-secondary/callback";

// The redirect_uri must match a registered "Authorized redirect URI"
// byte-for-byte. We derive it from the request origin so it follows whatever
// host the user reached the app on (never a localhost default in production). An
// explicit GMAIL_SECONDARY_REDIRECT_URI override is honored but normalized to the
// clean callback path on its own origin — so a legacy `?step=callback` value (the
// thing Google was rejecting) is transparently upgraded without an env edit, and
// stray whitespace from the hosting UI can't break the exact match.
export function resolveRedirectUri(origin: string): string {
  const env = process.env.GMAIL_SECONDARY_REDIRECT_URI?.trim();
  if (env) {
    try {
      return `${new URL(env).origin}${CALLBACK_PATH}`;
    } catch {
      /* not a valid absolute URL — fall through to the request origin */
    }
  }
  return `${origin}${CALLBACK_PATH}`;
}

export function buildOAuth2Client(redirectUri: string): OAuth2Client {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID?.trim(),
    process.env.GOOGLE_CLIENT_SECRET?.trim(),
    redirectUri,
  );
}

// Resolve the account's email from its access token via the Gmail profile —
// needs only the gmail.modify scope we already request (no openid/userinfo).
export async function getEmailFromToken(accessToken: string): Promise<string> {
  try {
    const client = new OAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const gmail = gmailApi({ version: "v1", auth: client });
    const profile = await gmail.users.getProfile({ userId: "me" });
    return profile.data.emailAddress ?? "";
  } catch {
    return "";
  }
}
