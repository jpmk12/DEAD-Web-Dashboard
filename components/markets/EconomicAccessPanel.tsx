"use client";

import { useEffect, useState } from "react";
import { NewsItem } from "@/lib/types";
import { clientCache, CACHE_TTL } from "@/lib/clientCache";
import { BriefIcon } from "@/lib/icons";

interface ActorCall { actor: string; level: "calm" | "watch" | "warning" | "alert"; boardLevel: string; call: string; falsifier: string; decisionLinkage: string }
interface AccessBrief {
  read: string;
  actors: ActorCall[];
  fuelLogistics: string;
  watchItems: string[];
}

// v2: the shape changed with the economic-warfare reframe; an older cached
// object must not render as an empty card.
const CACHE_KEY = "markets:brief:v2";

const LEVEL_CHIP: Record<ActorCall["level"], string> = {
  calm: "text-slate-400 border-slate-600 bg-slate-500/10",
  watch: "text-amber-300 border-amber-500/55 bg-amber-500/[0.12]",
  warning: "text-orange-300 border-orange-500/55 bg-orange-500/[0.12]",
  alert: "text-white border-red-500 bg-red-500/80",
};

// AI "Economic Warfare Read" for the Economy tab — the deterministic actor
// board handed to the model as evidence; per actor a level call (agreeing or
// dissenting from the board, with the reason), a falsifier and the decision
// it bears on. Cached per day server-side; the client cache mirrors it.
export default function EconomicAccessPanel({ articles }: { articles: NewsItem[] }) {
  const [brief, setBrief] = useState<AccessBrief | null>(() => clientCache.peek<AccessBrief>(CACHE_KEY));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async (force = false) => {
    if (loading) return;
    if (!force && clientCache.isFresh(CACHE_KEY)) { setBrief(clientCache.peek<AccessBrief>(CACHE_KEY)); return; }
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
      if (d.error) setError(d.disabled ? "Economic Warfare Read is off (Preferences → AI Controls)." : d.error);
      else if (d.brief) { setBrief(d.brief); clientCache.set(CACHE_KEY, d.brief, CACHE_TTL.NEWS); }
    } catch {
      setError("Couldn't generate the economic read.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!brief && articles.length > 0) generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articles.length]);

  const list = (label: string, items: string[]) => items.length > 0 && (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-1">{label}</p>
      <ul className="space-y-1">
        {items.map((w, i) => (
          <li key={i} className="flex gap-2 text-[11px] text-slate-400"><span className="text-emerald-500 flex-shrink-0">▸</span><span>{w}</span></li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="bg-slate-900/60 border border-emerald-500/20 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 flex items-center gap-1.5">
          <BriefIcon size={13} strokeWidth={2.5} className="leading-none" /> Economic Warfare Read
        </h3>
        <div className="flex items-center gap-2">
          {loading && <span className="text-[9px] text-slate-600 font-mono animate-pulse">analysing…</span>}
          <button onClick={() => generate(true)} disabled={loading || articles.length === 0} className="text-[10px] font-mono text-slate-500 hover:text-emerald-400 transition-colors disabled:opacity-40">↻ refresh</button>
        </div>
      </div>

      {error && <p className="text-[11px] text-slate-500 italic">{error}</p>}
      {!error && !brief && <p className="text-[11px] text-slate-600 font-mono">{articles.length === 0 ? "Waiting for today's news to load…" : "Generating…"}</p>}

      {brief && (
        <div className="space-y-3">
          <p className="text-xs text-slate-300 leading-relaxed">{brief.read}</p>
          {brief.actors.length > 0 && (
            <div className="divide-y divide-slate-800/60 border border-slate-800 rounded-lg">
              {brief.actors.map((a) => (
                <div key={a.actor} className="px-2.5 py-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-slate-100">{a.actor}</span>
                    <span className={`text-[8.5px] font-extrabold font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded border ${LEVEL_CHIP[a.level]}`}>{a.level}</span>
                    {a.boardLevel !== a.level && <span className="text-[9px] text-slate-500 font-mono">board says {a.boardLevel}{a.boardLevel !== "unknown" ? " — dissent" : ""}</span>}
                  </div>
                  <p className="text-[11px] text-slate-300 leading-snug">{a.call}</p>
                  {a.falsifier && <p className="text-[10px] text-slate-500 leading-snug"><span className="text-slate-600 uppercase tracking-wider text-[8.5px] font-bold mr-1">falsifier</span>{a.falsifier}</p>}
                  {a.decisionLinkage && <p className="text-[10px] text-slate-500 leading-snug"><span className="text-slate-600 uppercase tracking-wider text-[8.5px] font-bold mr-1">decision</span>{a.decisionLinkage}</p>}
                </div>
              ))}
            </div>
          )}
          {brief.fuelLogistics && (
            <p className="text-[11px] text-slate-400 border-l-2 border-amber-500/40 pl-2"><span className="text-amber-500 font-bold uppercase text-[9px] tracking-wider mr-1">Fuel</span>{brief.fuelLogistics}</p>
          )}
          {list("Watch", brief.watchItems)}
          <p className="text-[9px] text-slate-700 italic">The model reads the deterministic board; a call that dissents from the board level says so. Coarse open-source, not authoritative.</p>
        </div>
      )}
    </div>
  );
}
