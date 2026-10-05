"use client";

import { useEffect, useMemo, useState } from "react";
import { clientCache, CACHE_TTL } from "@/lib/clientCache";
import type { TrendMover, NewPair } from "@/lib/trends";
import { groupMovers } from "@/lib/newsLanes";

const CACHE_KEY = "trends:movers";
const PAIRS_KEY = "trends:pairs";

// Week-over-week movers strip (NEXT-LEVEL-PLAN P2), SORTED AND GROUPED the
// way the operator asked (REVIEW-2026-10 N7): ▲ rising by velocity, ✦ new,
// ▼ fading — each chip with its count and ×velocity, and a chip filters
// the lanes below (`onPick`). Renders nothing until the trend layer has
// something to say — movers below the noise floor never reach the API.
//
// Two reads over the longer window (PLAN §7 E3): a ◆ on a term whose week is
// above every prior 7-day window in 90 days, and pair chips for two terms
// seen together for the first time in 60 days.

const KIND_HINT: Record<string, string> = {
  topic: "topic", region: "region", aor: "AOR", watch: "watchlist term", label: "thread", category: "category",
};

const GROUP = {
  rising: { head: "▲ rising", headCls: "text-emerald-400", chip: "bg-emerald-500/10 text-emerald-300 border-emerald-500/40", on: "bg-emerald-500/30 text-emerald-100 border-emerald-400" },
  fresh:  { head: "✦ new",    headCls: "text-rose-300",    chip: "bg-rose-500/10 text-rose-300 border-rose-500/40",         on: "bg-rose-500/30 text-rose-100 border-rose-400" },
  fading: { head: "▼ fading", headCls: "text-slate-500",   chip: "bg-slate-800/60 text-slate-500 border-slate-700",         on: "bg-slate-700 text-slate-200 border-slate-500" },
} as const;

export default function TrendStrip({ picked, onPick }: { picked?: string | null; onPick?: (term: string | null) => void }) {
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

  const groups = useMemo(() => groupMovers(movers), [movers]);
  const shownPairs = pairs.slice(0, 3);
  const total = groups.rising.length + groups.fresh.length + groups.fading.length;
  if (total === 0 && shownPairs.length === 0) return null;

  const chip = (m: TrendMover, key: keyof typeof GROUP) => {
    const g = GROUP[key];
    const isOn = picked === m.term;
    const vel = m.prev > 0 ? `×${((m.cur + 1) / (m.prev + 1)).toFixed(1)}` : "";
    return (
      <button
        key={`${m.kind}|${m.term}`}
        onClick={() => onPick?.(isOn ? null : m.term)}
        className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${isOn ? g.on : g.chip}`}
        title={`${m.state} ${KIND_HINT[m.kind] ?? m.kind}: ${m.cur} mentions this week vs ${m.prev} last week${m.high90 ? " · a 90-day high" : ""} — click to filter the lanes`}
      >
        {m.term}
        <span className="opacity-60"> {m.cur}{vel ? ` · ${vel}` : ""}</span>
        {m.high90 && <span className="ml-1 text-amber-300" title="Above every prior 7-day window in 90 days">◆</span>}
      </button>
    );
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap mb-4 bg-slate-900/40 border border-slate-800 rounded-lg px-2.5 py-1.5">
      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 flex-shrink-0" title="Week-over-week movement across your monitored feeds (news · OSINT · crisis) — deterministic counts, not AI">Trending</span>
      {(["rising", "fresh", "fading"] as const).map((key) => {
        const list = groups[key].slice(0, key === "fading" ? 3 : 5);
        if (list.length === 0) return null;
        return (
          <span key={key} className="inline-flex items-center gap-1.5 flex-wrap">
            <span className={`text-[9px] font-bold uppercase tracking-wider ml-1 ${GROUP[key].headCls}`}>{GROUP[key].head}</span>
            {list.map((m) => chip(m, key))}
          </span>
        );
      })}
      {shownPairs.map((p) => (
        <span key={`${p.a}|${p.b}`} className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-sky-500/10 text-sky-200 border-sky-500/40" title={p.label}>
          ⧉ {p.a.split("|")[1] ?? p.a} + {p.b.split("|")[1] ?? p.b}
        </span>
      ))}
      {picked && <button onClick={() => onPick?.(null)} className="ml-auto text-[10px] text-slate-500 hover:text-slate-300 font-mono">✕ clear filter</button>}
    </div>
  );
}
