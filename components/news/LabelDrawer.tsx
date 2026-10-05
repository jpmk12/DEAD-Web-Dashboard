"use client";

import { useEffect, useState } from "react";
import type { LabelOccurrence, StoredThread } from "@/lib/threadHistory";

// The History tab's label timeline and search, as a drawer opened from a
// thread card's trajectory or the Moving rail (REVIEW-2026-10 N2). Same
// routes as before (/api/thread-history view=label | search).

const TREND = {
  rising: { icon: "↑", cls: "text-red-400", dot: "bg-red-500 border-red-500" },
  stable: { icon: "→", cls: "text-slate-400", dot: "bg-slate-600 border-slate-600" },
  fading: { icon: "↓", cls: "text-slate-600", dot: "bg-slate-800 border-slate-700" },
} as const;

const dateLabel = (ymd: string) => new Date(ymd + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export default function LabelDrawer({ label, query, days, onClose, onOpenLabel }: {
  label: string | null; query: string | null; days: number; onClose: () => void; onOpenLabel: (label: string) => void;
}) {
  const [history, setHistory] = useState<LabelOccurrence[] | null>(null);
  const [results, setResults] = useState<Array<StoredThread & { date: string }> | null>(null);

  useEffect(() => {
    setHistory(null); setResults(null);
    if (label) {
      fetch(`/api/thread-history?view=label&label=${encodeURIComponent(label)}&days=${days}`)
        .then((r) => r.json()).then((d) => setHistory(d.history ?? [])).catch(() => setHistory([]));
    } else if (query) {
      fetch(`/api/thread-history?view=search&q=${encodeURIComponent(query)}&days=${days}`)
        .then((r) => r.json()).then((d) => setResults(d.results ?? [])).catch(() => setResults([]));
    }
  }, [label, query, days]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!label && !query) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-slate-950 border-l border-slate-800 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label ? "Thread history" : "Search all threads"}</div>
            <div className="text-sm font-bold font-mono text-slate-100 truncate">{label ?? `“${query}”`}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-slate-600">{days}d</span>
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 text-lg leading-none" title="Close (Esc)" aria-label="Close">×</button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {label && (
            history === null ? <p className="text-xs text-slate-600 font-mono">Loading…</p>
            : history.length === 0 ? <p className="text-xs text-slate-600 font-mono">No history in this window.</p>
            : (
              <div className="relative">
                <div className="absolute left-[5px] top-3 bottom-3 w-px bg-slate-800" />
                {history.map((occ, i) => {
                  const tr = TREND[occ.trend];
                  const gap = i > 0 ? Math.round((Date.parse(occ.date) - Date.parse(history[i - 1].date)) / 86_400_000) : 0;
                  return (
                    <div key={`${occ.date}-${i}`}>
                      {gap > 1 && <div className="pl-6 py-1 text-[9px] text-slate-700 font-mono italic">{gap - 1}d gap</div>}
                      <div className="flex gap-3 py-2.5">
                        <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 mt-0.5 z-10 ${tr.dot}`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[10px] font-mono text-slate-500">{dateLabel(occ.date)}</span>
                            <span className={`text-[10px] font-bold font-mono ${tr.cls}`}>{tr.icon} {occ.trend}</span>
                          </div>
                          <p className="text-xs text-slate-300 leading-snug">{occ.headline}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
          {query && (
            results === null ? <p className="text-xs text-slate-600 font-mono">Searching…</p>
            : results.length === 0 ? <p className="text-xs text-slate-600 font-mono">No results.</p>
            : (
              <div className="space-y-2">
                {results.map((r) => {
                  const tr = TREND[r.trend];
                  return (
                    <div key={r.id} className="bg-slate-900 rounded-lg border border-slate-800 p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <button onClick={() => onOpenLabel(r.label)} className="text-[10px] font-bold font-mono text-slate-300 hover:text-white">{r.label}</button>
                        <span className={`text-[10px] font-mono ${tr.cls}`}>{tr.icon}</span>
                        <span className="text-[10px] font-mono text-slate-600 ml-auto">{r.date.slice(5)}</span>
                      </div>
                      <p className="text-xs text-slate-300 leading-snug">{r.headline}</p>
                      <p className="text-[11px] text-slate-500 leading-relaxed mt-1">{r.summary}</p>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      </div>
    </>
  );
}
