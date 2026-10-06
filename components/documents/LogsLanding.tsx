"use client";

import { useEffect, useState } from "react";
import { openAppend } from "@/lib/appendClient";

// The Docs landing (REVIEW-2026-10 §9 D6): the running logs with their
// newest entry, instead of "No document selected". Open · ⧉ append · ⇩
// export per log; ＋ New log starts one.

interface LogRow { id: string; title: string; entries: number; pinned: boolean; updatedAt: string; latest: { date: string; source: string; excerpt: string } | null }

const ago = (ymd: string) => { const d = Math.round((Date.now() - Date.parse(`${ymd}T12:00:00`)) / 86_400_000); return !Number.isFinite(d) ? ymd : d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} d ago`; };

export default function LogsLanding({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/documents/logs").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive) setLogs(Array.isArray(d?.logs) ? d.logs : []); }).catch(() => { if (alive) setLogs([]); });
    load();
    window.addEventListener("docs:changed", load);
    return () => { alive = false; window.removeEventListener("docs:changed", load); };
  }, []);

  return (
    <div className="hidden lg:flex flex-1 flex-col min-w-0 overflow-y-auto">
      <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-3 flex-wrap">
        <p className="text-[10px] font-bold uppercase tracking-widest text-amber-200">📓 Running logs</p>
        <span className="text-[10px] text-slate-500">one doc per subject you keep coming back to — newest entry first, appended from anywhere (select text → ⧉, a Thesis, ⌘K “Append to a log”)</span>
        <span className="ml-auto flex gap-2">
          <button onClick={onNew} className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded border border-slate-700 text-slate-300 hover:border-emerald-500/50">＋ New log</button>
        </span>
      </div>
      <div className="p-4">
        {logs === null && <p className="text-[11px] text-slate-600">Loading…</p>}
        {logs && logs.length === 0 && (
          <div className="text-center px-8 py-8">
            <p className="text-2xl mb-2">📓</p>
            <p className="text-sm font-bold text-slate-300 mb-1">No running logs yet</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">Select any text in the app and tap <span className="text-emerald-400">⧉ Append to…</span>, or press <span className="text-emerald-400">⧉ Append</span> on a Thesis — the picker offers “New log” and the entry becomes its first line. Or <button onClick={onNew} className="text-emerald-400 hover:underline">start one here</button>.</p>
            <p className="text-[10px] text-slate-700 font-mono mt-4">Tip: write <code className="text-emerald-400">[[Other Doc]]</code> in any note to link to another doc.</p>
          </div>
        )}
        {logs && logs.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {logs.map((l) => (
              <div key={l.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                <div className="flex items-center gap-2">
                  <span>📓</span>
                  <button onClick={() => onOpen(l.id)} className="text-[12.5px] font-bold text-slate-100 hover:text-emerald-300 truncate text-left flex-1">{l.pinned ? "★ " : ""}{l.title}</button>
                  <span className="text-[9px] font-mono text-slate-500 whitespace-nowrap">{l.entries} entr{l.entries === 1 ? "y" : "ies"}{l.latest ? ` · ${ago(l.latest.date)}` : ""}</span>
                </div>
                {l.latest ? (
                  <p className="mt-1.5 text-[11px] text-slate-300 leading-snug line-clamp-3">{l.latest.excerpt}<span className="block text-[10px] text-slate-500 mt-0.5">{ago(l.latest.date)} · from {l.latest.source}</span></p>
                ) : <p className="mt-1.5 text-[11px] text-slate-500">no entries yet</p>}
                <div className="mt-2 flex gap-1.5">
                  <button onClick={() => onOpen(l.id)} className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:border-slate-500">open</button>
                  <button onClick={() => openAppend({ text: "", source: "note", targetId: l.id })} className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10">⧉ append</button>
                  <a href={`/api/documents/${l.id}/export`} download className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:border-slate-500">⇩ export</a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
