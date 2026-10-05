"use client";

import { useState } from "react";
import { AssistantIcon } from "@/lib/icons";
import type { ThreadsResult } from "@/lib/types";

// The News tab's door into the ONE assistant (REVIEW-2026-10 N10). The
// separate "News analyst" pane is retired: the floating assistant already
// carries calendar, tasks, the OE picture and memory, and on this surface it
// now receives the whole article set, the newsletters and the threads. This
// card seeds it; the conversation lives in the assistant and survives tab
// changes.

export default function NewsAssistantCard({ threads, articleCount, newsletterCount }: { threads: ThreadsResult | null; articleCount: number; newsletterCount: number }) {
  const [text, setText] = useState("");
  const open = (prompt: string) => window.dispatchEvent(new CustomEvent("assistant:open", { detail: { prompt } }));
  const rising = (threads?.threads ?? []).filter((t) => t.trend === "rising").slice(0, 2);
  const suggestions = [
    ...rising.map((t) => `Explain ${t.label} for my squadron`),
    "What changed since yesterday?",
    "Connect today's threads to the demand horizon",
  ].slice(0, 4);
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-3">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
        <AssistantIcon size={13} strokeWidth={2.5} className="leading-none" /> Assistant · news context loaded
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">
        The same assistant as everywhere else — here it already holds {articleCount} article{articleCount === 1 ? "" : "s"}, {newsletterCount} newsletter{newsletterCount === 1 ? "" : "s"}{threads ? `, the ${threads.threads.length} threads` : ""} and the OE picture.
      </p>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {suggestions.map((s) => (
          <button key={s} onClick={() => open(s)} className="text-[10px] border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-300 text-slate-400 rounded-full px-2 py-0.5 transition-colors">
            {s}
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(e) => { e.preventDefault(); if (text.trim()) { open(text.trim()); setText(""); } }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask about today's reading…"
          className="flex-1 min-w-0 bg-slate-950/60 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500/50"
        />
        <button type="submit" className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-md px-2.5 transition-colors">Ask</button>
      </form>
    </div>
  );
}
