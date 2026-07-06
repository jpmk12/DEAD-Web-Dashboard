import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedEmail } from "./allowlist";

// Refresh the Google access token directly against the OAuth token endpoint.
// Done as a plain fetch (rather than google-auth-library's deprecated
// refreshAccessToken()) so it's library-version-proof and surfaces Google's
// actual error code — notably "invalid_grant", which means the refresh token
// was revoked/expired and the user must re-consent (sign in again).
async function refreshAccessToken(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string; expires_in?: number; refresh_token?: string;
    error?: string; error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error ? `${data.error}: ${data.error_description ?? ""}` : `refresh HTTP ${res.status}`);
  }
  return {
    accessToken: data.access_token,
    accessTokenExpires: Date.now() + (data.expires_in ?? 3600) * 1000,
    // Google normally omits a new refresh token on refresh — keep the old one.
    refreshToken: data.refresh_token ?? refreshToken,
  };
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  // Required in production behind a managed proxy (GoDaddy): Auth.js otherwise
  // rejects the forwarded host with UntrustedHost and 500s every auth route.
  trustHost: true,
  // Custom App Router sign-in page (next-auth's built-in page 404s on this host).
  // Route errors there too so the error code is shown on-screen (logs aren't reliable here).
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/tasks",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ profile }) {
      // Owner + the small crew allowlist (ALLOWED_EMAILS, comma-separated).
      // Case-insensitive; no owner configured -> nobody signs in.
      return isAllowedEmail(profile?.email, process.env.OWNER_EMAIL, process.env.ALLOWED_EMAILS);
    },
    async jwt({ token, account }) {
      // Fresh sign-in: capture the tokens and clear any prior error.
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: account.expires_at
            ? account.expires_at * 1000
            : Date.now() + 3600 * 1000,
          error: undefined,
        };
      }
      // Still valid — refresh 5 min early so a token never expires mid-request.
      if (token.accessTokenExpires && Date.now() < token.accessTokenExpires - 5 * 60 * 1000) {
        return token;
      }
      // Needs refreshing. With no refresh token we can't recover — make it
      // explicit (drop the stale access token + flag) so the UI prompts a
      // re-sign-in instead of silently 401-ing every API route.
      if (!token.refreshToken) {
        return { ...token, accessToken: undefined, error: "RefreshAccessTokenError" };
      }
      try {
        const refreshed = await refreshAccessToken(token.refreshToken);
        return { ...token, ...refreshed, error: undefined };
      } catch (err) {
        console.error("Google token refresh failed:", err instanceof Error ? err.message : err);
        return { ...token, accessToken: undefined, error: "RefreshAccessTokenError" };
      }
    },
    async session({ session, token }) {
      if (token.error === "RefreshAccessTokenError") {
        session.accessToken = undefined;
        session.error = "RefreshAccessTokenError";
      } else {
        session.accessToken = token.accessToken;
      }
      return session;
    },
  },
});
