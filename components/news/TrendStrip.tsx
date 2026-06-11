"use client";

import { useEffect, useState } from "react";
import { clientCache, CACHE_TTL } from "@/lib/clientCache";
import type { TrendMover } from "@/lib/trends";

const CACHE_KEY = "trends:movers";

// Compact week-over-week movers strip (NEXT-LEVEL-PLAN P2). Renders nothing
// until the trend layer has accumulated enough history to say something —
// movers below the noise floor never reach the API response, so early days
// the strip simply stays absent rather than showing junk.
const STATE_STYLE: Record<TrendMover["state"], { glyph: string; cls: string }> = {
  new:    { glyph: "✦", cls: "bg-rose-500/10 text-rose-300 border-rose-500/40" },
  rising: { glyph: "▲", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/40" },
  fading: { glyph: "▼", cls: "bg-slate-800/60 text-slate-500 border-slate-700" },
  steady: { glyph: "•", cls: "bg-slate-800/60 text-slate-500 border-slate-700" },
};

const KIND_HINT: Record<string, string> = {
  topic: "topic", region: "region", aor: "AOR", watch: "watchlist term", label: "thread", category: "category",
};

export default function TrendStrip() {
  const [movers, setMovers] = useState<TrendMover[]>(() => clientCache.peek<TrendMover[]>(CACHE_KEY) ?? []);

  useEffect(() => {
    if (clientCache.isFresh(CACHE_KEY)) return;
    fetch("/api/trends")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { movers?: TrendMover[] } | null) => {
        if (!Array.isArray(d?.movers)) return;
        clientCache.set(CACHE_KEY, d!.movers, CACHE_TTL.NEWS);
        setMovers(d!.movers);
      })
      .catch(() => {});
  }, []);

  const interesting = movers.filter((m) => m.state !== "steady").slice(0, 10);
  if (interesting.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap mb-4 bg-slate-900/40 border border-slate-800 rounded-lg px-2.5 py-1.5">
      <span
        className="text-[9px] font-bold uppercase tracking-widest text-slate-500 flex-shrink-0"
        title="Week-over-week movement across your monitored feeds (news · OSINT · crisis) — deterministic counts, not AI"
      >
        Trending
      </span>
      {interesting.map((m) => {
        const s = STATE_STYLE[m.state];
        return (
          <span
            key={`${m.kind}|${m.term}`}
            className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${s.cls}`}
            title={`${m.state} ${KIND_HINT[m.kind] ?? m.kind}: ${m.cur} mentions this week vs ${m.prev} last week`}
          >
            {s.glyph} {m.term}
            <span className="opacity-60"> {m.cur}</span>
          </span>
        );
      })}
    </div>
  );
}
