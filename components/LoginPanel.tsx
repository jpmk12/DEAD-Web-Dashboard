"use client";

import { signIn } from "next-auth/react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function LoginPanelContent({ signInSlot, hint }: { signInSlot?: React.ReactNode; hint?: string | null }) {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/";
  const error = params.get("error");
  // Link that drops the hint and forces Google's account chooser, keeping the
  // callback the user was heading to.
  const otherHref = `/login?hint=none${callbackUrl !== "/" ? `&callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`;

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
          {error === "SecondaryNoSession" && (
            <p>
              Google came back from the “Add second Gmail” step but your dashboard sign-in wasn’t there to attach it to.
              Sign in with your <span className="font-bold">primary</span> account below, then add the second one again from the Email tab.
            </p>
          )}
        </div>
      )}

      {hint && (
        <p className="text-[11px] text-slate-500 font-mono">
          Signing in as <span className="text-slate-300">{hint}</span>
          {" · "}
          <a href={otherHref} className="text-emerald-500 hover:text-emerald-400 underline-offset-2 hover:underline">
            use a different account
          </a>
        </p>
      )}

      {/* Prefer the server-action form (works with no client JS); fall back to
          the client call only when no server form was supplied. */}
      {signInSlot ?? (
        <button
          onClick={() => signIn("google", { callbackUrl })}
          className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold uppercase tracking-wider px-5 py-2.5 rounded-md transition-colors"
        >
          Sign in with Google
        </button>
      )}
    </div>
  );
}

export default function LoginPanel({ signInSlot, hint = null }: { signInSlot?: React.ReactNode; hint?: string | null }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <LoginPanelContent signInSlot={signInSlot} hint={hint} />
    </Suspense>
  );
}
