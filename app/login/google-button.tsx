"use client";

import { signIn } from "next-auth/react";

export default function GoogleButton({ callbackUrl }: { callbackUrl: string }) {
  return (
    <button
      onClick={() => signIn("google", { callbackUrl })}
      className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold uppercase tracking-wider px-5 py-2.5 rounded-md transition-colors"
    >
      Sign in with Google
    </button>
  );
}
