import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

async function refreshAccessToken(refreshToken: string) {
  // Dynamic import keeps the Google client out of the Edge/middleware bundle
  const { OAuth2Client } = await import("google-auth-library");
  const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2Client.refreshAccessToken();
  return {
    accessToken: credentials.access_token!,
    accessTokenExpires: credentials.expiry_date ?? Date.now() + 3600 * 1000,
    refreshToken: credentials.refresh_token ?? refreshToken,
  };
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  // Required in production behind a managed proxy (GoDaddy): Auth.js otherwise
  // rejects the forwarded host with UntrustedHost and 500s every auth route.
  trustHost: true,
  // Custom App Router sign-in page (next-auth's built-in page 404s on this host).
  pages: { signIn: "/login" },
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
      if (!process.env.OWNER_EMAIL) return false;
      return profile?.email === process.env.OWNER_EMAIL;
    },
    async jwt({ token, account }) {
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: account.expires_at
            ? account.expires_at * 1000
            : Date.now() + 3600 * 1000,
        };
      }
      if (token.accessTokenExpires && Date.now() < token.accessTokenExpires) {
        return token;
      }
      if (!token.refreshToken) return token;
      try {
        const refreshed = await refreshAccessToken(token.refreshToken);
        return { ...token, ...refreshed };
      } catch {
        return { ...token, error: "RefreshAccessTokenError" };
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
