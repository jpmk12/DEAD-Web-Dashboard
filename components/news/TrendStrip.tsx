"use client";

import { useEffect, useState } from "react";
import { clientCache, CACHE_TTL } from "@/lib/clientCache";
import type { TrendMover, NewPair } from "@/lib/trends";

const CACHE_KEY = "trends:movers";
const PAIRS_KEY = "trends:pairs";

// Compact week-over-week movers strip (NEXT-LEVEL-PLAN P2). Renders nothing
// until the trend layer has accumulated enough history to say something —
// movers below the noise floor never reach the API response, so early days
// the strip simply stays absent rather than showing junk.
//
// Two reads over the longer window (PLAN §7 E3): a ◆ on a term whose week is
// above every prior 7-day window in 90 days (only once five weeks of history
// exist), and pair chips for two terms seen together for the first time in
// 60 days — how a new story announces itself.
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
  const [pairs, setPairs] = useState<NewPair[]>(() => clientCache.peek<NewPair[]>(PAIRS_KEY) ?? []);

  useEffect(() => {
    if (clientCache.isFresh(CACHE_KEY)) return;
    fetch("/api/trends")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { movers?: TrendMover[]; pairs?: NewPair[] } | null) => {
        if (!Array.isArray(d?.movers)) return;
        clientCache.set(CACHE_KEY, d!.movers, CACHE_TTL.NEWS);
        setMovers(d!.movers);
        const p = Array.isArray(d?.pairs) ? d!.pairs! : [];
        clientCache.set(PAIRS_KEY, p, CACHE_TTL.NEWS);
        setPairs(p);
      })
      .catch(() => {});
  }, []);

  const interesting = movers.filter((m) => m.state !== "steady").slice(0, 10);
  const shownPairs = pairs.slice(0, 3);
  if (interesting.length === 0 && shownPairs.length === 0) return null;

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
            title={`${m.state} ${KIND_HINT[m.kind] ?? m.kind}: ${m.cur} mentions this week vs ${m.prev} last week${m.high90 ? " · a 90-day high" : ""}`}
          >
            {s.glyph} {m.term}
            <span className="opacity-60"> {m.cur}</span>
            {m.high90 && <span className="ml-1 text-amber-300" title="Above every prior 7-day window in 90 days">◆</span>}
          </span>
        );
      })}
      {shownPairs.map((p) => (
        <span
          key={`${p.a}|${p.b}`}
          className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-sky-500/10 text-sky-200 border-sky-500/40"
          title={p.label}
        >
          ⧉ {p.a.split("|")[1] ?? p.a} + {p.b.split("|")[1] ?? p.b}
        </span>
      ))}
    </div>
  );
}
