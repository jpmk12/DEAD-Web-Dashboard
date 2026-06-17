"use client";

import { useEffect, useMemo, useState } from "react";
import { NewsItem } from "@/lib/types";
import EconomicAccessPanel from "./EconomicAccessPanel";
import { scoreChokepoints } from "@/lib/chokepoints";
import { EconomyIcon } from "@/lib/icons";

interface EnergyQuote { symbol: string; label: string; price: number | null; changePct: number | null; asOf: string }

// News that bears on access/basing/overflight via the economic/coercive levers.
const ACCESS_NEWS = /sanction|export control|embargo|tariff|overflight|airspace clos|basing|base rights|status of forces|sofa|nationali[sz]|expropriat|currency|devalu|default|imf bailout|debt crisis/i;

function pctColor(p: number | null): string {
  if (p == null) return "text-slate-500";
  return p > 0 ? "text-emerald-400" : p < 0 ? "text-red-400" : "text-slate-400";
}
function ago(iso: string): string {
  const d = Date.parse(iso);
  if (!Number.isFinite(d)) return "";
  const h = Math.round((Date.now() - d) / 3.6e6);
  return h < 1 ? "now" : h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

export default function MarketsTab({ articles = [] }: { articles?: NewsItem[] }) {
  const [energy, setEnergy] = useState<EnergyQuote[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetch("/api/markets/energy")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.quotes)) setEnergy(d.quotes); })
      .catch(() => {});
  }, [refreshKey]);

  const chokepoints = useMemo(() => scoreChokepoints(articles), [articles]);
  const activeChokes = chokepoints.filter((c) => c.count > 0);
  const accessNews = useMemo(
    () => articles.filter((a) => ACCESS_NEWS.test(`${a.title} ${a.summary ?? ""}`)).slice(0, 6),
    [articles],
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
            <EconomyIcon size={15} strokeWidth={2.25} className="text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-200">Strategic Economics</h2>
            <p className="text-[10px] text-slate-600 font-mono">economic trends affecting access · basing · overflight</p>
          </div>
        </div>
        <button onClick={() => setRefreshKey((k) => k + 1)} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-400 font-mono transition-colors">
          <span className="text-base leading-none">↻</span> Refresh
        </button>
      </div>

      {/* Energy / fuel strip — Brent drives jet-fuel/sustainment cost */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-2">Energy &amp; fuel — sustainment-cost signal</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {energy.length === 0 && <p className="text-[11px] text-slate-600 font-mono col-span-full">Loading prices…</p>}
          {energy.map((q) => (
            <div key={q.symbol} className="min-w-0">
              <div className="text-[10px] text-slate-500 truncate" title={q.label}>{q.label}</div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-mono font-bold text-slate-200">{q.price != null ? `$${q.price.toLocaleString()}` : "—"}</span>
                {q.changePct != null && <span className={`text-[10px] font-mono ${pctColor(q.changePct)}`}>{q.changePct >= 0 ? "+" : ""}{q.changePct}%</span>}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[9px] text-slate-700 mt-2">Session change · Stooq · for context, not trading.</p>
      </div>

      {/* AI Economic Access Read */}
      <EconomicAccessPanel articles={articles} />

      {/* Chokepoint watch */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-2">Strategic chokepoints — transit &amp; overflight</p>
        {activeChokes.length === 0 ? (
          <p className="text-[11px] text-slate-600">No chokepoint activity in today&apos;s news. {chokepoints.length} points monitored (Hormuz, Bab-el-Mandeb, Suez, Turkish Straits, Malacca, Taiwan, Panama, Russian overflight).</p>
        ) : (
          <ul className="space-y-1.5">
            {activeChokes.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-[12px]">
                <span className="text-amber-400 mt-0.5 flex-shrink-0">◆</span>
                <div className="min-w-0">
                  <span className="text-slate-200 font-semibold">{c.name}</span>
                  <span className="text-slate-600 text-[10px]"> · {c.count} item{c.count === 1 ? "" : "s"} · {c.why}</span>
                  {c.latest && (
                    <div className="text-[11px] text-slate-400 truncate">
                      <a href={c.latest.link} target="_blank" rel="noopener noreferrer" className="hover:text-sky-300">{c.latest.title}</a>
                      <span className="text-slate-600"> · {c.latest.source}{ago(c.latest.pubDate) ? ` · ${ago(c.latest.pubDate)}` : ""}</span>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Sanctions / overflight / basing news */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-2">Sanctions · overflight · basing — in the news</p>
        {accessNews.length === 0 ? (
          <p className="text-[11px] text-slate-600">Nothing matching sanctions / export-controls / overflight / basing in today&apos;s feed.</p>
        ) : (
          <ul className="space-y-1.5">
            {accessNews.map((a) => (
              <li key={a.id} className="flex items-start gap-2.5">
                <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-[12px] text-sky-200/90 hover:text-sky-100 leading-snug flex-1 min-w-0">{a.title}</a>
                <span className="text-[9px] font-mono text-slate-600 flex-shrink-0 mt-0.5">{a.source}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[9px] text-slate-700 text-right">Energy via Stooq · chokepoint/news signals from your feeds · economic SA, not market advice.</p>
    </div>
  );
}
