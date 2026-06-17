"use client";

import { useEffect, useState } from "react";
import { NewsItem } from "@/lib/types";
import { clientCache, CACHE_TTL } from "@/lib/clientCache";
import { BriefIcon } from "@/lib/icons";

interface AccessBrief {
  accessRead: string;
  fuelLogistics: string;
  chokepoints: string[];
  basingOverflight: string[];
  watchItems: string[];
}

const CACHE_KEY = "markets:brief";

// AI "Economic Access Read" for the Strategic Economics tab — reads global
// economics through the mobility lens (fuel cost, sanctions, host-nation stress,
// transit/overflight). News + real energy prices + chokepoint signals, cached/day.
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
      if (d.error) setError(d.disabled ? "Economic Access Read is off (Preferences → AI Controls)." : d.error);
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
          <BriefIcon size={13} strokeWidth={2.5} className="leading-none" /> Economic Access Read
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
          <p className="text-xs text-slate-300 leading-relaxed">{brief.accessRead}</p>
          {brief.fuelLogistics && (
            <p className="text-[11px] text-slate-400 border-l-2 border-amber-500/40 pl-2"><span className="text-amber-500 font-bold uppercase text-[9px] tracking-wider mr-1">Fuel</span>{brief.fuelLogistics}</p>
          )}
          {list("Chokepoints / transit", brief.chokepoints)}
          {list("Basing / overflight", brief.basingOverflight)}
          {list("Watch", brief.watchItems)}
          <p className="text-[9px] text-slate-700 italic">Economic SA through the mobility lens — coarse open-source, not authoritative.</p>
        </div>
      )}
    </div>
  );
}
