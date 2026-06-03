"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarEvent, ChatMessage as ChatMessageType, GoogleTask, NewsItem, NewsletterSummary } from "@/lib/types";
import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";

interface ChatPanelProps {
  calendarEvents: CalendarEvent[];
  tasks?: GoogleTask[];
  articles?: NewsItem[];
  newsletters?: NewsletterSummary[];
  onTaskAdded?: () => void;
}

const WELCOME: ChatMessageType = {
  role: "assistant",
  content:
    "I'm your scheduling and task assistant. I can see your calendar events and tasks — ask me to find free time, add an event, or create a task.",
};

// ── Action block types ──────────────────────────────────────────────────────

interface EventPayload {
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  timeZone?: string;
}

interface TaskPayload {
  title: string;
  due?: string;
  notes?: string;
}

type ActionStatus = "pending" | "loading" | "done" | "dismissed" | "error";

interface EventAction {
  type: "event";
  data: EventPayload;
  status: ActionStatus;
  errorMsg?: string;
}

interface TaskAction {
  type: "task";
  data: TaskPayload;
  status: ActionStatus;
  errorMsg?: string;
}

type PendingAction = EventAction | TaskAction;

// ── Helpers ────────────────────────────────────────────────────────────────

function stripActionBlocks(text: string): string {
  return text
    .replace(/^\[ADD_EVENT:.*\]$/gm, "")
    .replace(/^\[ADD_TASK:.*\]$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseActionBlocks(text: string): PendingAction[] {
  const blocks: PendingAction[] = [];
  const eventRe = /^\[ADD_EVENT:(.*)\]$/gm;
  const taskRe = /^\[ADD_TASK:(.*)\]$/gm;

  let m: RegExpExecArray | null;
  while ((m = eventRe.exec(text)) !== null) {
    try {
      const data = JSON.parse(m[1]) as EventPayload;
      if (data.summary && data.start && data.end) {
        blocks.push({ type: "event", data, status: "pending" });
      }
    } catch { /* skip malformed */ }
  }
  while ((m = taskRe.exec(text)) !== null) {
    try {
      const data = JSON.parse(m[1]) as TaskPayload;
      if (data.title) {
        blocks.push({ type: "task", data, status: "pending" });
      }
    } catch { /* skip malformed */ }
  }
  return blocks;
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    if (!iso.includes("T")) {
      return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    }
    return d.toLocaleString([], {
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch { return iso; }
}

// ── Action card components ─────────────────────────────────────────────────

interface ActionCardProps<T extends PendingAction> {
  action: T;
  onConfirm: () => void;
  onDismiss: () => void;
}

function EventActionCard({ action, onConfirm, onDismiss }: ActionCardProps<EventAction>) {
  const { data, status } = action;
  return (
    <div className="ml-0 mt-1 bg-slate-800/80 border border-emerald-500/30 rounded-xl p-3 text-sm">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-emerald-400 text-xs">📅</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">Add to Calendar</span>
      </div>
      <p className="text-slate-100 font-semibold leading-snug">{data.summary}</p>
      <p className="text-[11px] text-slate-400 mt-0.5">
        {formatDateTime(data.start)} → {formatDateTime(data.end)}
      </p>
      {data.location && <p className="text-[11px] text-slate-500 mt-0.5">📍 {data.location}</p>}
      {data.description && <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{data.description}</p>}
      {status === "done" ? (
        <p className="text-[11px] text-emerald-400 mt-2 font-mono">✓ Added to calendar</p>
      ) : status === "error" ? (
        <p className="text-[11px] text-red-400 mt-2">
          {action.errorMsg ?? "Failed to add event"}
          <button onClick={onConfirm} className="ml-2 underline hover:text-red-300">Retry</button>
        </p>
      ) : (
        <div className="flex gap-2 mt-2">
          <button
            onClick={onConfirm}
            disabled={status === "loading"}
            className="flex items-center gap-1 bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-50 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg transition-colors"
          >
            {status === "loading" ? "Adding…" : "Add to Calendar"}
          </button>
          <button
            onClick={onDismiss}
            className="text-[11px] text-slate-500 hover:text-slate-300 px-2 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function TaskActionCard({ action, onConfirm, onDismiss }: ActionCardProps<TaskAction>) {
  const { data, status } = action;
  return (
    <div className="ml-0 mt-1 bg-slate-800/80 border border-blue-500/30 rounded-xl p-3 text-sm">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-blue-400 text-xs">◎</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400">Create Task</span>
      </div>
      <p className="text-slate-100 font-semibold leading-snug">{data.title}</p>
      {data.due && <p className="text-[11px] text-slate-400 mt-0.5">Due {data.due}</p>}
      {data.notes && <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{data.notes}</p>}
      {status === "done" ? (
        <p className="text-[11px] text-emerald-400 mt-2 font-mono">✓ Task created</p>
      ) : status === "error" ? (
        <p className="text-[11px] text-red-400 mt-2">
          {action.errorMsg ?? "Failed to create task"}
          <button onClick={onConfirm} className="ml-2 underline hover:text-red-300">Retry</button>
        </p>
      ) : (
        <div className="flex gap-2 mt-2">
          <button
            onClick={onConfirm}
            disabled={status === "loading"}
            className="flex items-center gap-1 bg-blue-600/80 hover:bg-blue-600 disabled:opacity-50 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg transition-colors"
          >
            {status === "loading" ? "Creating…" : "Create Task"}
          </button>
          <button
            onClick={onDismiss}
            className="text-[11px] text-slate-500 hover:text-slate-300 px-2 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function ChatPanel({
  calendarEvents,
  tasks = [],
  articles = [],
  newsletters = [],
  onTaskAdded,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>([WELCOME]);
  const [streaming, setStreaming] = useState(false);
  const [streamedIdx, setStreamedIdx] = useState(-1);
  const [actionMap, setActionMap] = useState<Map<number, PendingAction[]>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const msgCountRef = useRef(messages.length);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const countIncreased = messages.length > msgCountRef.current;
    msgCountRef.current = messages.length;
    if (countIncreased) {
      pinnedRef.current = true;
      el.scrollTop = el.scrollHeight;
    } else if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // Parse action blocks once streaming ends
  useEffect(() => {
    if (!streaming && streamedIdx >= 0) {
      setMessages((prev) => {
        const msg = prev[streamedIdx];
        if (!msg) return prev;
        const blocks = parseActionBlocks(msg.content);
        if (blocks.length > 0) {
          setActionMap((m) => {
            const next = new Map(m);
            next.set(streamedIdx, blocks);
            return next;
          });
        }
        return prev;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  const updateAction = (msgIdx: number, actionIdx: number, patch: Partial<PendingAction>) => {
    setActionMap((m) => {
      const next = new Map(m);
      const arr = [...(next.get(msgIdx) ?? [])];
      arr[actionIdx] = { ...arr[actionIdx], ...patch } as PendingAction;
      next.set(msgIdx, arr);
      return next;
    });
  };

  const confirmEvent = async (msgIdx: number, actionIdx: number, data: EventPayload) => {
    updateAction(msgIdx, actionIdx, { status: "loading" });
    try {
      const res = await fetch("/api/calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Failed");
      }
      updateAction(msgIdx, actionIdx, { status: "done" });
    } catch (err) {
      updateAction(msgIdx, actionIdx, {
        status: "error",
        errorMsg: err instanceof Error ? err.message : "Failed to add event",
      });
    }
  };

  const confirmTask = async (msgIdx: number, actionIdx: number, data: TaskPayload) => {
    updateAction(msgIdx, actionIdx, { status: "loading" });
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Failed");
      }
      updateAction(msgIdx, actionIdx, { status: "done" });
      onTaskAdded?.();
    } catch (err) {
      updateAction(msgIdx, actionIdx, {
        status: "error",
        errorMsg: err instanceof Error ? err.message : "Failed to create task",
      });
    }
  };

  const sendMessage = async (text: string) => {
    const userMsg: ChatMessageType = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    const assistantIdx = newMessages.length;
    setStreamedIdx(assistantIdx);
    setMessages([...newMessages, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.filter((m) => m.role !== "assistant" || m.content),
          calendarContext: calendarEvents,
          tasks,
          articles,
          newsletters,
        }),
      });

      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: updated[updated.length - 1].content + chunk,
          };
          return updated;
        });
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: "Sorry, something went wrong. Please try again.",
        };
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-slate-900/80">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
            <span className="text-emerald-400 text-xs">❖</span>
          </div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-300">AI Assistant</h2>
        </div>
        <div className="flex items-center gap-1.5">
          {calendarEvents.length > 0 && (
            <span className="text-[10px] text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-md font-mono font-bold">
              {calendarEvents.length} ev
            </span>
          )}
          {tasks.length > 0 && (
            <span className="text-[10px] text-blue-400 bg-blue-500/10 border border-blue-500/30 px-2 py-0.5 rounded-md font-mono font-bold">
              {tasks.length} tasks
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-1"
      >
        {messages.map((msg, i) => {
          const actions = actionMap.get(i) ?? [];
          const displayContent = actions.length > 0
            ? { ...msg, content: stripActionBlocks(msg.content) }
            : msg;
          return (
            <div key={i}>
              <ChatMessage message={displayContent} />
              {actions.map((action, j) =>
                action.type === "event" ? (
                  <EventActionCard
                    key={j}
                    action={action}
                    onConfirm={() => confirmEvent(i, j, action.data)}
                    onDismiss={() => updateAction(i, j, { status: "dismissed" })}
                  />
                ) : (
                  <TaskActionCard
                    key={j}
                    action={action}
                    onConfirm={() => confirmTask(i, j, action.data)}
                    onDismiss={() => updateAction(i, j, { status: "dismissed" })}
                  />
                )
              )}
            </div>
          );
        })}
        {streaming && messages[messages.length - 1]?.content === "" && (
          <div className="flex justify-start">
            <div className="bg-slate-800 rounded-2xl rounded-bl-sm px-4 py-2.5">
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:300ms]" />
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="px-3 pb-3 pt-1 border-t border-slate-800/60">
        <ChatInput onSend={sendMessage} disabled={streaming} />
      </div>
    </div>
  );
}
