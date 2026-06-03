"use client";

import { useState } from "react";
import TasksPanel from "./TasksPanel";
import { GoogleTask } from "@/lib/types";

interface CalendarRailProps {
  tasksRefreshKey: number;
  // Bubble loaded tasks up so the global floating assistant shares this context.
  onTasksLoaded?: (tasks: GoogleTask[]) => void;
}

// Calendar-tab side rail. Tasks only — the AI assistant is now global (the
// floating launcher available on every tab), so it no longer lives here.
export default function CalendarRail({ tasksRefreshKey, onTasksLoaded }: CalendarRailProps) {
  const [open, setOpen] = useState(true);

  const panel = (
    <div className="flex-1 min-h-0">
      <TasksPanel refreshKey={tasksRefreshKey} onTasksLoaded={(t) => onTasksLoaded?.(t)} />
    </div>
  );

  return (
    <>
      {/* ── Mobile ──────────────────────────────────────────────────────── */}
      <div className="lg:hidden mt-4">
        {open ? (
          <>
            <div className="flex justify-end mb-2">
              <button
                onClick={() => setOpen(false)}
                className="text-xs text-slate-600 hover:text-slate-400 font-mono transition-colors"
              >
                Hide ▲
              </button>
            </div>
            <div className="flex flex-col gap-2" style={{ height: "60vh" }}>
              {panel}
            </div>
          </>
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="w-full text-xs text-slate-600 hover:text-slate-300 border border-slate-800 hover:border-slate-700 rounded-lg py-2 font-mono uppercase tracking-wider transition-all"
          >
            ◎ Tasks
          </button>
        )}
      </div>

      {/* ── Desktop ─────────────────────────────────────────────────────── */}
      {open ? (
        <div className="hidden lg:flex flex-col lg:w-80 xl:w-96 flex-shrink-0 gap-2">
          <div className="flex justify-end">
            <button
              onClick={() => setOpen(false)}
              className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-400 font-mono transition-colors"
            >
              <span>◁</span> collapse
            </button>
          </div>
          {panel}
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          title="Open Tasks"
          className="hidden lg:flex flex-col items-center justify-start w-10 flex-shrink-0 pt-4 pb-6 gap-3 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-emerald-500/30 hover:bg-slate-900 cursor-pointer transition-all group"
        >
          <span className="text-emerald-400 text-sm group-hover:scale-110 transition-transform">◎</span>
          <span
            className="text-[10px] font-bold uppercase tracking-widest text-slate-600 group-hover:text-emerald-500/70 transition-colors"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            Tasks
          </span>
        </button>
      )}
    </>
  );
}
