"use client";

import { signIn } from "next-auth/react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function LoginPanelContent() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/";
  const error = params.get("error");

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-slate-950 text-slate-100 px-6 text-center">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
          <span className="text-emerald-400 text-sm">◆</span>
        </div>
        <h1 className="text-lg font-bold tracking-widest uppercase">DEAD&apos;s Dashboard</h1>
      </div>

      <p className="text-slate-400 text-sm max-w-sm">
        Sign in with the authorized Google account to access your dashboard.
      </p>

      {error && (
        <div className="text-red-400 text-xs max-w-sm space-y-1 border border-red-500/30 bg-red-500/5 rounded-md px-4 py-3">
          <p className="font-bold">Sign-in failed</p>
          <p className="font-mono text-red-300">Error: {error}</p>
          {error === "AccessDenied" && (
            <p>This Google account isn’t the authorized OWNER_EMAIL.</p>
          )}
          {error === "Configuration" && (
            <p>Server is missing an auth setting (secret or Google credentials), or NEXTAUTH_URL is wrong.</p>
          )}
          {error === "OAuthCallback" && (
            <p>The OAuth callback failed — usually a redirect-URI mismatch in Google Cloud Console.</p>
          )}
        </div>
      )}

      <button
        onClick={() => signIn("google", { callbackUrl })}
        className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold uppercase tracking-wider px-5 py-2.5 rounded-md transition-colors"
      >
        Sign in with Google
      </button>
    </div>
  );
}

export default function LoginPanel() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <LoginPanelContent />
    </Suspense>
  );
}
