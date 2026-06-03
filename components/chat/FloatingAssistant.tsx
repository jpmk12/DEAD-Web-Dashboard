"use client";

import { useEffect, useState } from "react";
import { CalendarEvent, GoogleTask, NewsItem, NewsletterSummary } from "@/lib/types";
import ChatPanel from "./ChatPanel";

interface FloatingAssistantProps {
  calendarEvents: CalendarEvent[];
  tasks: GoogleTask[];
  articles: NewsItem[];
  newsletters: NewsletterSummary[];
  onTaskAdded: () => void;
}

// Global AI assistant available on every tab: a fixed launcher button that opens
// the same ChatPanel (calendar/tasks/news context, can create events & tasks) in
// a right-side slide-over. The Calendar tab keeps its inline rail assistant too.
export default function FloatingAssistant({ calendarEvents, tasks, articles, newsletters, onTaskAdded }: FloatingAssistantProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Launcher — fixed bottom-right, on every tab. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Open AI assistant"
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold uppercase tracking-wider px-4 py-3 rounded-full shadow-lg glow-green transition-all"
        >
          <span className="text-base leading-none">◈</span>
          Assistant
        </button>
      )}

      {/* Slide-over */}
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] bg-slate-950 border-l border-slate-800 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-200 flex items-center gap-2">
                <span className="text-emerald-400">◈</span> AI Assistant
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all text-lg leading-none"
                title="Close (Esc)"
              >
                ×
              </button>
            </div>
            <div className="flex-1 min-h-0 p-3">
              <ChatPanel
                calendarEvents={calendarEvents}
                tasks={tasks}
                articles={articles}
                newsletters={newsletters}
                onTaskAdded={onTaskAdded}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}
