"use client";

import { useEffect, useState } from "react";
import { NewsItem } from "@/lib/types";
import { clientCache, CACHE_TTL } from "@/lib/clientCache";
import { BriefIcon } from "@/lib/icons";

interface MacroBrief {
  marketRead: string;
  themes: string[];
  watchItems: string[];
  defenseAngle: string;
}

const CACHE_KEY = "markets:brief";

// AI macro read for the Markets tab. News-driven (no price feed): synthesises
// the day's drivers + what to watch from the loaded news, cached per day.
export default function MacroBriefPanel({ articles }: { articles: NewsItem[] }) {
  const [brief, setBrief] = useState<MacroBrief | null>(() => clientCache.peek<MacroBrief>(CACHE_KEY));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async (force = false) => {
    if (loading) return;
    if (!force && clientCache.isFresh(CACHE_KEY)) { setBrief(clientCache.peek<MacroBrief>(CACHE_KEY)); return; }
    if (articles.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/markets/brief${force ? "?refresh=1" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articles }),
      });
      const d = await res.json();
      if (d.error) setError(d.disabled ? "Markets brief is off (Preferences → AI Controls)." : d.error);
      else if (d.brief) { setBrief(d.brief); clientCache.set(CACHE_KEY, d.brief, CACHE_TTL.NEWS); }
    } catch {
      setError("Couldn't generate the macro brief.");
    } finally {
      setLoading(false);
    }
  };

  // Auto-generate once news is available and nothing is cached yet.
  useEffect(() => {
    if (!brief && articles.length > 0) generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articles.length]);

  return (
    <div className="bg-slate-900/60 border border-emerald-500/20 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 flex items-center gap-1.5">
          <BriefIcon size={13} strokeWidth={2.5} className="leading-none" /> Macro Brief
        </h3>
        <div className="flex items-center gap-2">
          {loading && <span className="text-[9px] text-slate-600 font-mono animate-pulse">analysing…</span>}
          <button
            onClick={() => generate(true)}
            disabled={loading || articles.length === 0}
            className="text-[10px] font-mono text-slate-500 hover:text-emerald-400 transition-colors disabled:opacity-40"
          >
            ↻ refresh
          </button>
        </div>
      </div>

      {error && <p className="text-[11px] text-slate-500 italic">{error}</p>}

      {!error && !brief && (
        <p className="text-[11px] text-slate-600 font-mono">
          {articles.length === 0 ? "Waiting for today's news to load…" : "Generating…"}
        </p>
      )}

      {brief && (
        <div className="space-y-3">
          <p className="text-xs text-slate-300 leading-relaxed">{brief.marketRead}</p>

          {brief.themes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {brief.themes.map((t, i) => (
                <span key={i} className="text-[10px] text-slate-300 bg-slate-800/70 border border-slate-700 rounded px-1.5 py-0.5">
                  {t}
                </span>
              ))}
            </div>
          )}

          {brief.watchItems.length > 0 && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-1">Watch</p>
              <ul className="space-y-1">
                {brief.watchItems.map((w, i) => (
                  <li key={i} className="flex gap-2 text-[11px] text-slate-400">
                    <span className="text-emerald-500 flex-shrink-0">▸</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {brief.defenseAngle && (
            <p className="text-[11px] text-slate-400 border-l-2 border-emerald-500/40 pl-2">
              <span className="text-emerald-500 font-bold uppercase text-[9px] tracking-wider mr-1">Defense</span>
              {brief.defenseAngle}
            </p>
          )}

          <p className="text-[9px] text-slate-700 italic">
            News-driven synthesis — no live price data; describes themes, not moves.
          </p>
        </div>
      )}
    </div>
  );
}
