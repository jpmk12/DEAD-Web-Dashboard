"use client";

import { signIn } from "next-auth/react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function LoginContent() {
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
        <p className="text-red-400 text-xs max-w-sm">
          Sign-in failed{error === "AccessDenied" ? " — this account isn’t authorized." : "."} Please try again.
        </p>
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

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <LoginContent />
    </Suspense>
  );
}
