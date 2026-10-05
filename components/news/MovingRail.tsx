"use client";

import { useEffect, useMemo, useState } from "react";
import type { LabelSummary, StoredSession } from "@/lib/threadHistory";
import { movingGroups, type Trend } from "@/lib/threadTrajectory";

// The History tab, folded into the Threads view (REVIEW-2026-10 N2 / N7):
// labels sorted sustained escalation → rising → re-emerging → steady →
// fading, each with its run and sparkline; past days to re-open; search.
// Click a label → the timeline drawer; click a day → that session renders
// in place of today's board.

const DAYS = [7, 14, 30, 60] as const;
export type Days = (typeof DAYS)[number];

const GROUP_CLS: Record<string, string> = {
  sustained: "text-red-300", rising: "text-emerald-300", reemerging: "text-amber-300", steady: "text-slate-400", fading: "text-slate-500",
};
const T_CLS: Record<Trend, string> = { rising: "text-red-400", stable: "text-slate-400", fading: "text-slate-600" };
const T_GLYPH: Record<Trend, string> = { rising: "↑", stable: "→", fading: "↓" };

/** The stored sparkline is "↑ → ↑ ↑" — render it as bars. */
function Spark({ s }: { s: string }) {
  const cells = s.split(" ").filter(Boolean).slice(-10);
  return (
    <span className="inline-flex items-end gap-[2px] h-3" aria-hidden>
      {cells.map((c, i) => (
        <i key={i} className={`block w-[3px] rounded-[1px] ${c === "↑" ? "h-3 bg-red-400" : c === "→" ? "h-2 bg-slate-500" : "h-1 bg-slate-700"}`} />
      ))}
    </span>
  );
}

function runText(l: LabelSummary): string {
  const cells = l.trendSparkline.split(" ").filter(Boolean);
  let n = 0;
  for (let i = cells.length - 1; i >= 0 && cells[i] === cells[cells.length - 1]; i--) n++;
  const ord = n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
  return l.occurrences === 1 ? "once" : `${ord} day`;
}

export default function MovingRail({ selectedDate, onOpenLabel, onSelectSession, onSearch }: {
  selectedDate: string | null;
  onOpenLabel: (label: string, days: Days) => void;
  onSelectSession: (s: StoredSession | null) => void;
  onSearch: (q: string, days: Days) => void;
}) {
  const [days, setDays] = useState<Days>(30);
  const [labels, setLabels] = useState<LabelSummary[] | null>(null);
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    setLabels(null);
    fetch(`/api/thread-history?view=labels&days=${days}`).then((r) => r.json()).then((d) => setLabels(d.labels ?? [])).catch(() => setLabels([]));
  }, [days]);
  useEffect(() => {
    fetch("/api/thread-history?view=sessions&days=10").then((r) => r.json()).then((d) => setSessions(Array.isArray(d.sessions) ? d.sessions : [])).catch(() => {});
  }, []);

  const groups = useMemo(() => movingGroups(labels ?? []), [labels]);
  const today = new Date().toISOString().slice(0, 10);
  const past = sessions.filter((s) => s.date !== today).slice(0, 5);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 bg-slate-800/30">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Moving</span>
        <div className="ml-auto flex items-center gap-0.5">
          {DAYS.map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${days === d ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}>{d}d</button>
          ))}
        </div>
      </div>
      <form className="px-3 py-2 border-b border-slate-800" onSubmit={(e) => { e.preventDefault(); if (q.trim()) onSearch(q.trim(), days); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search every past thread…" className="w-full bg-slate-950/60 border border-slate-800 rounded-md px-2 py-1 text-[11px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-slate-600 font-mono" />
      </form>
      {labels === null && <p className="px-3 py-3 text-[11px] text-slate-600 font-mono">Loading…</p>}
      {labels !== null && groups.length === 0 && <p className="px-3 py-3 text-[11px] text-slate-600">No thread history in this window yet — it builds one session per day.</p>}
      {groups.map((g) => (
        <div key={g.key}>
          <div className={`px-3 py-1 text-[9px] font-bold uppercase tracking-widest border-t border-slate-800 bg-slate-950/40 ${GROUP_CLS[g.key]}`}>{g.title}</div>
          {g.labels.map((l) => (
            <button key={l.label} onClick={() => onOpenLabel(l.label, days)} title={`${l.occurrences} session${l.occurrences === 1 ? "" : "s"} · last ${l.lastSeen} · open the timeline`} className="w-full flex items-center gap-2 px-3 py-1.5 border-t border-slate-800/60 hover:bg-slate-800/40 text-left">
              <span className="text-[10px] font-mono font-bold text-slate-200 w-[112px] flex-shrink-0 truncate">{l.label}</span>
              <span className={`text-[11px] font-bold w-3 text-center ${T_CLS[l.lastTrend]}`}>{T_GLYPH[l.lastTrend]}</span>
              <Spark s={l.trendSparkline} />
              <span className="ml-auto text-[10px] text-slate-500 font-mono whitespace-nowrap">{l.isRemerging ? "back" : runText(l)} · {l.occurrences}×</span>
            </button>
          ))}
        </div>
      ))}
      {(past.length > 0 || selectedDate) && (
        <div>
          <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest border-t border-slate-800 bg-slate-950/40 text-slate-500">▦ Past days</div>
          {selectedDate && (
            <button onClick={() => onSelectSession(null)} className="w-full px-3 py-1.5 border-t border-slate-800/60 text-left text-[10px] font-mono text-emerald-300 hover:bg-slate-800/40">← back to today</button>
          )}
          {past.map((s) => (
            <button key={s.id} onClick={() => onSelectSession(s)} className={`w-full flex items-center gap-2 px-3 py-1.5 border-t border-slate-800/60 hover:bg-slate-800/40 text-left ${selectedDate === s.date ? "bg-slate-800/40" : ""}`} title={s.throughLine}>
              <span className="text-[10px] font-mono text-slate-400 w-[112px] flex-shrink-0">{new Date(s.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" })}</span>
              <span className="text-[10px] text-slate-500 truncate flex-1">{s.throughLine}</span>
              <span className="text-[10px] font-mono text-slate-600 whitespace-nowrap">{s.threads.length} thr</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
