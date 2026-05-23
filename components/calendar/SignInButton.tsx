"use client";

import { signIn } from "next-auth/react";

export default function SignInButton() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center gap-4 p-6">
      <div className="text-4xl">📅</div>
      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-300">Connect Your Calendar</h2>
      <p className="text-sm text-slate-500 max-w-xs">
        Sign in with Google to view your upcoming events and get AI-powered planning help.
      </p>
      <button
        onClick={() => signIn("google")}
        className="flex items-center gap-2 bg-slate-800 border border-slate-700 text-slate-200 px-5 py-2.5 rounded-lg font-medium hover:border-green-700 hover:text-green-400 transition-all text-sm"
      >
        Sign in with Google
      </button>
    </div>
  );
}
