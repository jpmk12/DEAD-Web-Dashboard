"use client";

import { useState, useRef } from "react";
import { GoogleTask } from "@/lib/types";

// Tasks — a controlled panel (REVIEW-2026-10 C4): the Calendar tab owns the
// list and the mutations so the Don't-miss list and this panel act on the
// same rows. The rail no longer collapses; the groups fold instead (Later
// and No date closed by default) and the date field hides behind "+ date".

interface TasksPanelProps {
  tasks: GoogleTask[];
  loading: boolean;
  error: string | null;
  reauthNeeded: boolean;
  onAdd: (title: string, due?: string) => Promise<void>;
  onToggle: (t: GoogleTask) => void;
  onDelete: (t: GoogleTask) => void;
  onReschedule: (t: GoogleTask, due: string | null) => void;
  onRetry: () => void;
}

export function dateGroup(due: string | undefined): "overdue" | "today" | "week" | "later" | "none" {
  if (!due) return "none";
  const taskDate = due.substring(0, 10);
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (taskDate < todayStr) return "overdue";
  if (taskDate === todayStr) return "today";
  const weekOut = new Date(today);
  weekOut.setDate(weekOut.getDate() + 7);
  const weekStr = `${weekOut.getFullYear()}-${String(weekOut.getMonth() + 1).padStart(2, "0")}-${String(weekOut.getDate()).padStart(2, "0")}`;
  if (taskDate <= weekStr) return "week";
  return "later";
}

function formatDue(due: string): string {
  const date = new Date(due.substring(0, 10) + "T12:00:00");
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function TaskRow({ task, onToggle, onDelete, onReschedule }: { task: GoogleTask; onToggle: (t: GoogleTask) => void; onDelete: (t: GoogleTask) => void; onReschedule: (t: GoogleTask, due: string | null) => void }) {
  const [editingDue, setEditingDue] = useState(false);
  return (
    <div className="flex items-start gap-2 group py-1.5 px-2 rounded-lg hover:bg-slate-800/60 transition-colors">
      <button onClick={() => onToggle(task)} className="mt-0.5 w-4 h-4 rounded border border-slate-600 hover:border-emerald-500 flex-shrink-0 flex items-center justify-center transition-colors" aria-label="Mark complete">
        {task.status === "completed" && <span className="text-emerald-400 text-[10px] leading-none">✓</span>}
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200 leading-snug">{task.title}</p>
        {editingDue ? (
          <input
            type="date" autoFocus defaultValue={task.due ? task.due.substring(0, 10) : ""}
            onBlur={() => setEditingDue(false)}
            onKeyDown={(e) => { if (e.key === "Escape") setEditingDue(false); }}
            onChange={(e) => { const v = e.target.value; setEditingDue(false); onReschedule(task, v ? `${v}T00:00:00.000Z` : null); }}
            className="mt-0.5 bg-slate-800/60 border border-slate-600 rounded px-1.5 py-0.5 text-[11px] text-slate-300 focus:outline-none focus:border-emerald-500/60"
          />
        ) : (
          <button onClick={() => setEditingDue(true)} title="Change due date" className={`text-[10px] font-mono transition-colors ${task.due ? "text-slate-500 hover:text-emerald-400" : "text-slate-700 hover:text-emerald-400 opacity-0 group-hover:opacity-100"}`}>
            {task.due ? formatDue(task.due) : "+ date"}
          </button>
        )}
        {task.notes && <p className="text-[11px] text-slate-500 mt-0.5 leading-snug truncate">{task.notes}</p>}
      </div>
      <button onClick={() => onDelete(task)} className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 text-xs transition-all flex-shrink-0 mt-0.5" aria-label="Delete task">×</button>
    </div>
  );
}

const ACCENT: Record<string, string> = { overdue: "text-red-400", today: "text-emerald-500", week: "text-blue-400", later: "text-slate-500", none: "text-slate-600" };
const LABEL: Record<string, string> = { overdue: "Overdue", today: "Today", week: "This week", later: "Later", none: "No date" };

export default function TasksPanel({ tasks, loading, error, reauthNeeded, onAdd, onToggle, onDelete, onReschedule, onRetry }: TasksPanelProps) {
  const [newTitle, setNewTitle] = useState("");
  const [newDue, setNewDue] = useState("");
  const [showDate, setShowDate] = useState(false);
  const [adding, setAdding] = useState(false);
  const [folded, setFolded] = useState<Set<string>>(() => new Set(["later", "none"]));
  const inputRef = useRef<HTMLInputElement>(null);

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || adding) return;
    setAdding(true);
    try { await onAdd(newTitle.trim(), newDue || undefined); setNewTitle(""); setNewDue(""); setShowDate(false); inputRef.current?.focus(); }
    finally { setAdding(false); }
  };

  const groups = (["overdue", "today", "week", "later", "none"] as const).map((k) => ({ k, items: tasks.filter((t) => dateGroup(t.due) === k) }));

  if (reauthNeeded) {
    return (
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 text-sm text-amber-400">
        <p className="font-bold mb-1">Sign in required</p>
        <p className="text-xs text-slate-400">Sign out and back in to enable Google Tasks access.</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800/80">
        <div className="w-6 h-6 rounded-md bg-slate-700/60 border border-slate-600/40 flex items-center justify-center flex-shrink-0"><span className="text-slate-400 text-xs">◎</span></div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-300">Tasks</h2>
        {tasks.length > 0 && <span className="ml-auto text-[10px] text-slate-600 font-mono">{tasks.length}</span>}
      </div>

      <form onSubmit={addTask} className="px-3 pt-3 pb-2 border-b border-slate-800/60">
        <div className="flex gap-1.5 items-center">
          <input ref={inputRef} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Add a task…" className="flex-1 min-w-0 bg-slate-800/60 border border-slate-700/80 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500/60 transition-colors" />
          {!showDate && <button type="button" onClick={() => setShowDate(true)} className="text-[10px] font-mono text-slate-500 hover:text-emerald-400 whitespace-nowrap">+ date</button>}
          <button type="submit" disabled={!newTitle.trim() || adding} className="bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors">+</button>
        </div>
        {showDate && (
          <input type="date" value={newDue} autoFocus onChange={(e) => setNewDue(e.target.value)} className="mt-1.5 w-full bg-slate-800/40 border border-slate-700/60 rounded-lg px-3 py-1 text-xs text-slate-400 focus:outline-none focus:border-emerald-500/60 transition-colors" />
        )}
      </form>

      <div className="p-2 max-h-[60vh] overflow-y-auto">
        {loading && <div className="space-y-2 pt-2">{[1, 2, 3].map((i) => <div key={i} className="h-8 bg-slate-800/60 rounded-lg animate-pulse" />)}</div>}
        {error && !loading && <div className="text-xs text-red-400 p-3 text-center">{error}<button onClick={onRetry} className="ml-2 underline hover:text-red-300">Retry</button></div>}
        {!loading && !error && tasks.length === 0 && <div className="text-center py-10 text-slate-600 text-xs font-mono uppercase tracking-wider">No pending tasks</div>}
        {!loading && !error && groups.map(({ k, items }) => items.length === 0 ? null : (
          <div key={k} className="mb-2">
            <button onClick={() => setFolded((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; })} className={`w-full flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest mb-1 px-2 ${ACCENT[k]}`}>
              {LABEL[k]} <span className="text-slate-600">{items.length}</span>
              <span className="ml-auto text-slate-600">{folded.has(k) ? "▾" : "▴"}</span>
            </button>
            {!folded.has(k) && items.map((t) => <TaskRow key={t.id} task={t} onToggle={onToggle} onDelete={onDelete} onReschedule={onReschedule} />)}
          </div>
        ))}
      </div>
    </div>
  );
}
