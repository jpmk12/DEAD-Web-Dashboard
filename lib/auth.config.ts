import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// Edge-compatible auth config — no Node.js built-ins (googleapis etc.)
// Used only by middleware for session checking.
export const authConfig = {
  // Trust the proxy-forwarded host in production (GoDaddy managed proxy).
  trustHost: true,
  // Use our own App Router sign-in page instead of next-auth's built-in
  // /api/auth/signin page (which renders "NOT FOUND" on this platform).
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      // Always allow the root (so the platform health check on / sees 200, not
      // a 307 redirect) and the login page (avoids an unauth redirect loop).
      // The root page itself renders the sign-in UI when there's no session.
      if (path === "/" || path === "/login") return true;
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
