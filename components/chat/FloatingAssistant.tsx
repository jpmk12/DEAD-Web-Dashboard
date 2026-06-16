"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarEvent, GoogleTask, NewsItem, NewsletterSummary } from "@/lib/types";
import ChatPanel from "./ChatPanel";
import { AssistantIcon } from "@/lib/icons";

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
  // A prompt to prefill the composer with, seeded from elsewhere (e.g. a Glance
  // "reschedule" click dispatches `assistant:open` with a starter sentence).
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(null);
  // Fetch tasks independently so the assistant has them even if the Calendar
  // tab (and its background TasksPanel) hasn't loaded yet. Falls back to the
  // prop until the fetch lands.
  const [fetchedTasks, setFetchedTasks] = useState<GoogleTask[] | null>(null);

  // Any component can open the assistant pre-seeded:
  //   window.dispatchEvent(new CustomEvent("assistant:open", { detail: { prompt } }))
  useEffect(() => {
    const onOpen = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt?: string }>).detail?.prompt ?? "";
      setSeed({ text: prompt, nonce: Date.now() });
      setOpen(true);
    };
    window.addEventListener("assistant:open", onOpen as EventListener);
    return () => window.removeEventListener("assistant:open", onOpen as EventListener);
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.tasks)) setFetchedTasks(data.tasks);
    } catch { /* keep the prop fallback */ }
  }, []);

  // Refresh tasks each time the assistant is opened.
  useEffect(() => { if (open) loadTasks(); }, [open, loadTasks]);

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
          style={{ bottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
          className="fixed right-5 z-40 flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold uppercase tracking-wider px-4 py-3 rounded-full shadow-lg glow-green transition-all touch-manipulation"
        >
          <AssistantIcon size={16} strokeWidth={2.5} className="leading-none" />
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
                <AssistantIcon size={15} strokeWidth={2.25} className="inline-block align-[-2px] text-emerald-400" /> AI Assistant
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
                tasks={fetchedTasks ?? tasks}
                articles={articles}
                newsletters={newsletters}
                onTaskAdded={() => { onTaskAdded(); loadTasks(); }}
                onEventChanged={() => window.dispatchEvent(new Event("calendar:changed"))}
                initialInput={seed?.text}
                initialInputNonce={seed?.nonce}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}
