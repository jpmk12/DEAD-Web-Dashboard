"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { GoogleTask } from "@/lib/types";

interface TasksPanelProps {
  refreshKey?: number;
  onTasksLoaded?: (tasks: GoogleTask[]) => void;
}

function dateGroup(due: string | undefined): "overdue" | "today" | "week" | "later" | "none" {
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

interface TaskRowProps {
  task: GoogleTask;
  onToggle: (t: GoogleTask) => void;
  onDelete: (t: GoogleTask) => void;
  onReschedule: (t: GoogleTask, due: string | null) => void;
}

function TaskRow({ task, onToggle, onDelete, onReschedule }: TaskRowProps) {
  // Inline due-date editing — click the date (or "+ date") to open a native
  // picker. The PATCH API always supported this; the UI finally exposes it.
  const [editingDue, setEditingDue] = useState(false);
  return (
    <div className="flex items-start gap-2 group py-1.5 px-2 rounded-lg hover:bg-slate-800/60 transition-colors">
      <button
        onClick={() => onToggle(task)}
        className="mt-0.5 w-4 h-4 rounded border border-slate-600 hover:border-emerald-500 flex-shrink-0 flex items-center justify-center transition-colors"
        aria-label="Mark complete"
      >
        {task.status === "completed" && (
          <span className="text-emerald-400 text-[10px] leading-none">✓</span>
        )}
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200 leading-snug">{task.title}</p>
        {editingDue ? (
          <input
            type="date"
            autoFocus
            defaultValue={task.due ? task.due.substring(0, 10) : ""}
            onBlur={() => setEditingDue(false)}
            onKeyDown={(e) => { if (e.key === "Escape") setEditingDue(false); }}
            onChange={(e) => {
              const v = e.target.value; // "" = clear the date
              setEditingDue(false);
              onReschedule(task, v ? `${v}T00:00:00.000Z` : null);
            }}
            className="mt-0.5 bg-slate-800/60 border border-slate-600 rounded px-1.5 py-0.5 text-[11px] text-slate-300 focus:outline-none focus:border-emerald-500/60"
          />
        ) : (
          <button
            onClick={() => setEditingDue(true)}
            title="Change due date"
            className={`text-[10px] font-mono transition-colors ${task.due ? "text-slate-500 hover:text-emerald-400" : "text-slate-700 hover:text-emerald-400 opacity-0 group-hover:opacity-100"}`}
          >
            {task.due ? formatDue(task.due) : "+ date"}
          </button>
        )}
        {task.notes && (
          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug truncate">{task.notes}</p>
        )}
      </div>
      <button
        onClick={() => onDelete(task)}
        className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 text-xs transition-all flex-shrink-0 mt-0.5"
        aria-label="Delete task"
      >
        ×
      </button>
    </div>
  );
}

interface GroupProps {
  label: string;
  tasks: GoogleTask[];
  accent?: string;
  onToggle: (t: GoogleTask) => void;
  onDelete: (t: GoogleTask) => void;
  onReschedule: (t: GoogleTask, due: string | null) => void;
}

function TaskGroup({ label, tasks, accent = "text-slate-500", onToggle, onDelete, onReschedule }: GroupProps) {
  if (tasks.length === 0) return null;
  return (
    <div className="mb-3">
      <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 px-2 ${accent}`}>{label}</p>
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} onToggle={onToggle} onDelete={onDelete} onReschedule={onReschedule} />
      ))}
    </div>
  );
}

export default function TasksPanel({ refreshKey = 0, onTasksLoaded }: TasksPanelProps) {
  const [tasks, setTasks] = useState<GoogleTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reauthNeeded, setReauthNeeded] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDue, setNewDue] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks");
      if (res.status === 403) { setReauthNeeded(true); return; }
      if (!res.ok) throw new Error("Failed");
      const data = await res.json() as { tasks: GoogleTask[] };
      setTasks(data.tasks);
      onTasksLoaded?.(data.tasks);
    } catch {
      setError("Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchTasks(); }, [fetchTasks, refreshKey]);

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim(), due: newDue || undefined }),
      });
      if (!res.ok) throw new Error("Failed");
      const { task } = await res.json() as { task: GoogleTask };
      setTasks((prev) => [...prev, task]);
      setNewTitle("");
      setNewDue("");
      inputRef.current?.focus();
    } catch {
      // silent
    } finally {
      setAdding(false);
    }
  };

  const toggleTask = async (task: GoogleTask) => {
    // Optimistic: remove completed tasks immediately
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, status: "completed" }),
      });
    } catch {
      setTasks((prev) => [...prev, task]);
    }
  };

  const deleteTask = async (task: GoogleTask) => {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    try {
      await fetch(`/api/tasks?id=${encodeURIComponent(task.id)}`, { method: "DELETE" });
    } catch {
      setTasks((prev) => [...prev, task]);
    }
  };

  // Optimistic due-date change (null clears the date); the task jumps to its
  // new group immediately and reverts if the PATCH fails.
  const rescheduleTask = async (task: GoogleTask, due: string | null) => {
    const apply = (d: string | undefined) =>
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, due: d } : t)));
    apply(due ?? undefined);
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, due }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      apply(task.due);
    }
  };

  const overdue = tasks.filter((t) => dateGroup(t.due) === "overdue");
  const today = tasks.filter((t) => dateGroup(t.due) === "today");
  const week = tasks.filter((t) => dateGroup(t.due) === "week");
  const later = tasks.filter((t) => dateGroup(t.due) === "later");
  const none = tasks.filter((t) => dateGroup(t.due) === "none");

  if (reauthNeeded) {
    return (
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 text-sm text-amber-400">
        <p className="font-bold mb-1">Sign in required</p>
        <p className="text-xs text-slate-400">Sign out and back in to enable Google Tasks access.</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800/80">
        <div className="w-6 h-6 rounded-md bg-slate-700/60 border border-slate-600/40 flex items-center justify-center flex-shrink-0">
          <span className="text-slate-400 text-xs">◎</span>
        </div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-300">Tasks</h2>
        {tasks.length > 0 && (
          <span className="ml-auto text-[10px] text-slate-600 font-mono">{tasks.length}</span>
        )}
      </div>

      {/* Add task form */}
      <form onSubmit={addTask} className="px-3 pt-3 pb-2 border-b border-slate-800/60">
        <div className="flex gap-1.5">
          <input
            ref={inputRef}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Add a task…"
            className="flex-1 bg-slate-800/60 border border-slate-700/80 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500/60 transition-colors"
          />
          <button
            type="submit"
            disabled={!newTitle.trim() || adding}
            className="bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
          >
            +
          </button>
        </div>
        <input
          type="date"
          value={newDue}
          onChange={(e) => setNewDue(e.target.value)}
          className="mt-1.5 w-full bg-slate-800/40 border border-slate-700/60 rounded-lg px-3 py-1 text-xs text-slate-400 focus:outline-none focus:border-emerald-500/60 transition-colors"
        />
      </form>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading && (
          <div className="space-y-2 pt-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-8 bg-slate-800/60 rounded-lg animate-pulse" />
            ))}
          </div>
        )}

        {error && !loading && (
          <div className="text-xs text-red-400 p-3 text-center">
            {error}
            <button onClick={fetchTasks} className="ml-2 underline hover:text-red-300">Retry</button>
          </div>
        )}

        {!loading && !error && tasks.length === 0 && (
          <div className="text-center py-10 text-slate-600 text-xs font-mono uppercase tracking-wider">
            No pending tasks
          </div>
        )}

        {!loading && !error && (
          <>
            <TaskGroup label="Overdue" tasks={overdue} accent="text-red-400" onToggle={toggleTask} onDelete={deleteTask} onReschedule={rescheduleTask} />
            <TaskGroup label="Today" tasks={today} accent="text-emerald-500" onToggle={toggleTask} onDelete={deleteTask} onReschedule={rescheduleTask} />
            <TaskGroup label="This Week" tasks={week} accent="text-blue-400" onToggle={toggleTask} onDelete={deleteTask} onReschedule={rescheduleTask} />
            <TaskGroup label="Later" tasks={later} accent="text-slate-500" onToggle={toggleTask} onDelete={deleteTask} onReschedule={rescheduleTask} />
            <TaskGroup label="No Date" tasks={none} accent="text-slate-600" onToggle={toggleTask} onDelete={deleteTask} onReschedule={rescheduleTask} />
          </>
        )}
      </div>
    </div>
  );
}
