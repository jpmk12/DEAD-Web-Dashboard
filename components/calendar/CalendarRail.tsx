"use client";

import { useState } from "react";
import TasksPanel from "./TasksPanel";
import ChatPanel from "@/components/chat/ChatPanel";
import { CalendarEvent, GoogleTask, NewsItem, NewsletterSummary } from "@/lib/types";

interface CalendarRailProps {
  calendarEvents: CalendarEvent[];
  articles: NewsItem[];
  newsletters: NewsletterSummary[];
  onTaskAdded: () => void;
  tasksRefreshKey: number;
  // Bubble loaded tasks up so the global floating assistant shares this context.
  onTasksLoaded?: (tasks: GoogleTask[]) => void;
}

type RailTab = "tasks" | "assistant";

export default function CalendarRail({
  calendarEvents,
  articles,
  newsletters,
  onTaskAdded,
  tasksRefreshKey,
  onTasksLoaded,
}: CalendarRailProps) {
  const [open, setOpen] = useState(true);
  const [railTab, setRailTab] = useState<RailTab>("tasks");
  // Populated by TasksPanel via onTasksLoaded — avoids a duplicate /api/tasks fetch
  const [tasksForChat, setTasksForChat] = useState<GoogleTask[]>([]);

  const tabBar = (
    <div className="flex bg-slate-800/60 border border-slate-700/80 rounded-lg p-1 gap-1 flex-shrink-0">
      <button
        onClick={() => setRailTab("tasks")}
        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all ${
          railTab === "tasks"
            ? "bg-slate-700 text-slate-100 shadow-sm"
            : "text-slate-500 hover:text-slate-300"
        }`}
      >
        <span className="text-sm leading-none">◎</span>
        Tasks
      </button>
      <button
        onClick={() => setRailTab("assistant")}
        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all ${
          railTab === "assistant"
            ? "bg-emerald-500 text-slate-950 shadow-sm glow-green"
            : "text-slate-500 hover:text-slate-300"
        }`}
      >
        <span className="text-sm leading-none">◈</span>
        Assistant
      </button>
    </div>
  );

  const panels = (
    <div className="flex-1 min-h-0">
      {/* Keep both panels mounted so state is preserved on tab switch */}
      <div className={`h-full ${railTab !== "tasks" ? "hidden" : ""}`}>
        <TasksPanel
          refreshKey={tasksRefreshKey}
          onTasksLoaded={(t) => { setTasksForChat(t); onTasksLoaded?.(t); }}
        />
      </div>
      <div className={`h-full ${railTab !== "assistant" ? "hidden" : ""}`}>
        <ChatPanel
          calendarEvents={calendarEvents}
          tasks={tasksForChat}
          articles={articles}
          newsletters={newsletters}
          onTaskAdded={onTaskAdded}
        />
      </div>
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
              {tabBar}
              {panels}
            </div>
          </>
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="w-full text-xs text-slate-600 hover:text-slate-300 border border-slate-800 hover:border-slate-700 rounded-lg py-2 font-mono uppercase tracking-wider transition-all"
          >
            ◎ Tasks &amp; ◈ Assistant
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
          {tabBar}
          {panels}
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          title="Open Tasks & Assistant"
          className="hidden lg:flex flex-col items-center justify-start w-10 flex-shrink-0 pt-4 pb-6 gap-3 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-emerald-500/30 hover:bg-slate-900 cursor-pointer transition-all group"
        >
          <span className="text-emerald-400 text-sm group-hover:scale-110 transition-transform">◎</span>
          <span
            className="text-[10px] font-bold uppercase tracking-widest text-slate-600 group-hover:text-emerald-500/70 transition-colors"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            Tasks &amp; AI
          </span>
        </button>
      )}
    </>
  );
}
