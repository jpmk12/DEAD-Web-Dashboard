"use client";

import { useSession, signIn } from "next-auth/react";

// When the Google token can't be refreshed (revoked/expired refresh token, or a
// session predating offline access), the session carries
// error: "RefreshAccessTokenError" and every Google-backed API route 401s. That
// used to fail silently — the app just looked broken. This turns it into a
// clear, one-click re-sign-in prompt.
export default function SessionExpiredBanner() {
  const { data, status } = useSession();
  if (status !== "authenticated" || data?.error !== "RefreshAccessTokenError") return null;

  return (
    <div className="bg-red-500/15 border-b border-red-500/40 text-red-200 text-xs px-4 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
      <span>
        Your Google session expired — calendar, email, weather and OSINT data can&apos;t load until you sign in again.
      </span>
      <button
        onClick={() => signIn("google")}
        className="font-bold uppercase tracking-wider bg-red-500 hover:bg-red-400 text-slate-950 px-2.5 py-1 rounded-md transition-colors touch-manipulation"
      >
        Sign in again
      </button>
    </div>
  );
}
