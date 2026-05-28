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
      // Always allow the login page through, otherwise unauthenticated users
      // get redirected to /login on /login → infinite loop.
      if (request.nextUrl.pathname === "/login") return true;
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
