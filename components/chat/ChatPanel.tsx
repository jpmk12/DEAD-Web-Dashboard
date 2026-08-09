"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarEvent, ChatMessage as ChatMessageType, GoogleTask, NewsItem, NewsletterSummary } from "@/lib/types";
import ChatMessage from "./ChatMessage";
import { AssistantIcon } from "@/lib/icons";
import ChatInput from "./ChatInput";

interface ChatPanelProps {
  calendarEvents: CalendarEvent[];
  tasks?: GoogleTask[];
  articles?: NewsItem[];
  newsletters?: NewsletterSummary[];
  onTaskAdded?: () => void;
  onEventChanged?: () => void;   // fired after a successful add/move/edit/delete
  initialInput?: string;         // prefill the composer (e.g. seeded from Glance)
  initialInputNonce?: number;    // bump to re-apply initialInput when already open
}

const WELCOME: ChatMessageType = {
  role: "assistant",
  content:
    "I'm your scheduling and task assistant. I can see your calendar and tasks — ask me to find free time, add an event, or move, reschedule, or cancel something.",
};

// ── Thread persistence ──────────────────────────────────────────────────────
// The slide-over unmounts this panel on close, which used to destroy the
// conversation. The thread now survives close/reopen (module cache) and a
// page reload (sessionStorage — per-tab, clears when the browser tab closes).
// Pending action-confirm cards are deliberately NOT persisted: a stale
// "Add event?" button firing after a reload is worse than re-asking.
const THREAD_KEY = "assistant:thread";
const THREAD_CAP = 40; // messages kept
let threadCache: ChatMessageType[] | null = null;

function loadThread(): ChatMessageType[] {
  if (threadCache && threadCache.length) return threadCache;
  try {
    const raw = sessionStorage.getItem(THREAD_KEY);
    if (raw) {
      const p = JSON.parse(raw) as ChatMessageType[];
      if (Array.isArray(p) && p.length && p.every((m) => m && typeof m.content === "string")) {
        threadCache = p;
        return p;
      }
    }
  } catch { /* corrupted → fresh thread */ }
  return [WELCOME];
}

function saveThread(messages: ChatMessageType[]): void {
  const trimmed = messages.slice(-THREAD_CAP);
  threadCache = trimmed;
  try { sessionStorage.setItem(THREAD_KEY, JSON.stringify(trimmed)); } catch { /* quota — cache still holds it */ }
}

function clearThread(): void {
  threadCache = null;
  try { sessionStorage.removeItem(THREAD_KEY); } catch { /* ignore */ }
}

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

// Mutations target an existing event. The assistant references it by a [N]
// handle; we resolve that to the concrete event (id + calendarId + its current
// time, for the before→after display) on the client from the same list we sent.
interface ResolvedEvent {
  eventId: string;
  calendarId?: string;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
}

interface MovePayload { ref: number; start: string; end: string; timeZone?: string }
interface EditPayload { ref: number; summary?: string; location?: string; description?: string }
interface DeletePayload { ref: number }

type ActionStatus = "pending" | "loading" | "done" | "dismissed" | "error";

interface EventAction { type: "event"; data: EventPayload; status: ActionStatus; errorMsg?: string }
interface TaskAction { type: "task"; data: TaskPayload; status: ActionStatus; errorMsg?: string }
interface MoveAction { type: "move"; data: MovePayload; event?: ResolvedEvent; status: ActionStatus; errorMsg?: string }
interface EditAction { type: "edit"; data: EditPayload; event?: ResolvedEvent; status: ActionStatus; errorMsg?: string }
interface DeleteAction { type: "delete"; data: DeletePayload; event?: ResolvedEvent; status: ActionStatus; errorMsg?: string }

type PendingAction = EventAction | TaskAction | MoveAction | EditAction | DeleteAction;

// ── Helpers ────────────────────────────────────────────────────────────────

function stripActionBlocks(text: string): string {
  return text
    .replace(/^\[ADD_EVENT:.*\]$/gm, "")
    .replace(/^\[ADD_TASK:.*\]$/gm, "")
    .replace(/^\[MOVE_EVENT:.*\]$/gm, "")
    .replace(/^\[EDIT_EVENT:.*\]$/gm, "")
    .replace(/^\[DELETE_EVENT:.*\]$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Resolve a [N] handle (1-based, matching the order we sent to /api/chat) to the
// concrete event. Returns undefined if out of range / lacks an id, so the card
// can show an honest "couldn't identify that event" rather than acting blindly.
function resolveRef(ref: unknown, events: CalendarEvent[]): ResolvedEvent | undefined {
  if (typeof ref !== "number" || !Number.isInteger(ref)) return undefined;
  const e = events[ref - 1];
  if (!e || !e.id) return undefined;
  return { eventId: e.id, calendarId: e.calendarId, title: e.title, start: e.start, end: e.end, isAllDay: e.isAllDay };
}

function parseActionBlocks(text: string, events: CalendarEvent[]): PendingAction[] {
  const blocks: PendingAction[] = [];
  const run = (re: RegExp, fn: (json: string) => PendingAction | null) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      try { const b = fn(m[1]); if (b) blocks.push(b); } catch { /* skip malformed */ }
    }
  };

  run(/^\[ADD_EVENT:(.*)\]$/gm, (j) => {
    const data = JSON.parse(j) as EventPayload;
    return data.summary && data.start && data.end ? { type: "event", data, status: "pending" } : null;
  });
  run(/^\[ADD_TASK:(.*)\]$/gm, (j) => {
    const data = JSON.parse(j) as TaskPayload;
    return data.title ? { type: "task", data, status: "pending" } : null;
  });
  run(/^\[MOVE_EVENT:(.*)\]$/gm, (j) => {
    const data = JSON.parse(j) as MovePayload;
    if (!data.start || !data.end) return null;
    return { type: "move", data, event: resolveRef(data.ref, events), status: "pending" };
  });
  run(/^\[EDIT_EVENT:(.*)\]$/gm, (j) => {
    const data = JSON.parse(j) as EditPayload;
    if (data.summary === undefined && data.location === undefined && data.description === undefined) return null;
    return { type: "edit", data, event: resolveRef(data.ref, events), status: "pending" };
  });
  run(/^\[DELETE_EVENT:(.*)\]$/gm, (j) => {
    const data = JSON.parse(j) as DeletePayload;
    return { type: "delete", data, event: resolveRef(data.ref, events), status: "pending" };
  });
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

// Shared footer (confirm / dismiss / done / error+retry) for the mutation cards,
// so move/edit/delete keep one consistent confirmation UX.
function CardFooter({ status, errorMsg, confirmLabel, busyLabel, doneLabel, danger, onConfirm, onDismiss }: {
  status: ActionStatus; errorMsg?: string; confirmLabel: string; busyLabel: string; doneLabel: string;
  danger?: boolean; onConfirm: () => void; onDismiss: () => void;
}) {
  if (status === "done") return <p className="text-[11px] text-emerald-400 mt-2 font-mono">✓ {doneLabel}</p>;
  if (status === "error") return (
    <p className="text-[11px] text-red-400 mt-2">
      {errorMsg ?? "Failed"}
      <button onClick={onConfirm} className="ml-2 underline hover:text-red-300">Retry</button>
    </p>
  );
  const btn = danger
    ? "bg-red-600/80 hover:bg-red-600"
    : "bg-emerald-600/80 hover:bg-emerald-600";
  return (
    <div className="flex gap-2 mt-2">
      <button onClick={onConfirm} disabled={status === "loading"} className={`flex items-center gap-1 ${btn} disabled:opacity-50 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg transition-colors`}>
        {status === "loading" ? busyLabel : confirmLabel}
      </button>
      <button onClick={onDismiss} className="text-[11px] text-slate-500 hover:text-slate-300 px-2 transition-colors">Dismiss</button>
    </div>
  );
}

function UnresolvedCard({ label }: { label: string }) {
  return (
    <div className="ml-0 mt-1 bg-slate-800/80 border border-amber-500/30 rounded-xl p-3 text-sm">
      <p className="text-[11px] text-amber-400">Couldn&apos;t identify which event to {label} — tell me which one (by title or time) and I&apos;ll try again.</p>
    </div>
  );
}

function MoveEventCard({ action, onConfirm, onDismiss }: ActionCardProps<MoveAction>) {
  const { data, event, status } = action;
  if (!event) return <UnresolvedCard label="move" />;
  return (
    <div className="ml-0 mt-1 bg-slate-800/80 border border-amber-500/30 rounded-xl p-3 text-sm">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-amber-400 text-xs">⇄</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Reschedule</span>
      </div>
      <p className="text-slate-100 font-semibold leading-snug">{event.title}</p>
      <p className="text-[11px] text-slate-500 mt-1 line-through">{formatDateTime(event.start)} → {formatDateTime(event.end)}</p>
      <p className="text-[11px] text-amber-300 mt-0.5">{formatDateTime(data.start)} → {formatDateTime(data.end)}</p>
      <CardFooter status={status} errorMsg={action.errorMsg} confirmLabel="Move event" busyLabel="Moving…" doneLabel="Event moved" onConfirm={onConfirm} onDismiss={onDismiss} />
    </div>
  );
}

function EditEventCard({ action, onConfirm, onDismiss }: ActionCardProps<EditAction>) {
  const { data, event, status } = action;
  if (!event) return <UnresolvedCard label="edit" />;
  return (
    <div className="ml-0 mt-1 bg-slate-800/80 border border-emerald-500/30 rounded-xl p-3 text-sm">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-emerald-400 text-xs">✎</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">Edit event</span>
      </div>
      <p className="text-slate-100 font-semibold leading-snug">{event.title}</p>
      {data.summary !== undefined && <p className="text-[11px] text-slate-300 mt-1">Title → <span className="text-emerald-300">{data.summary}</span></p>}
      {data.location !== undefined && <p className="text-[11px] text-slate-300 mt-0.5">📍 → <span className="text-emerald-300">{data.location}</span></p>}
      {data.description !== undefined && <p className="text-[11px] text-slate-300 mt-0.5 leading-snug">Notes → <span className="text-emerald-300">{data.description}</span></p>}
      <CardFooter status={status} errorMsg={action.errorMsg} confirmLabel="Save changes" busyLabel="Saving…" doneLabel="Event updated" onConfirm={onConfirm} onDismiss={onDismiss} />
    </div>
  );
}

function DeleteEventCard({ action, onConfirm, onDismiss }: ActionCardProps<DeleteAction>) {
  const { event, status } = action;
  if (!event) return <UnresolvedCard label="cancel" />;
  return (
    <div className="ml-0 mt-1 bg-slate-800/80 border border-red-500/40 rounded-xl p-3 text-sm">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-red-400 text-xs">🗑</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-red-400">Cancel event</span>
      </div>
      <p className="text-slate-100 font-semibold leading-snug">{event.title}</p>
      <p className="text-[11px] text-slate-400 mt-0.5">{formatDateTime(event.start)}</p>
      <CardFooter status={status} errorMsg={action.errorMsg} confirmLabel="Delete event" busyLabel="Deleting…" doneLabel="Event deleted" danger onConfirm={onConfirm} onDismiss={onDismiss} />
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
  onEventChanged,
  initialInput,
  initialInputNonce,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>(() => loadThread());
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

  // Persist the thread once a turn settles (not per streamed token).
  useEffect(() => {
    if (!streaming && messages.length > 1) saveThread(messages);
  }, [messages, streaming]);

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
        const blocks = parseActionBlocks(msg.content, calendarEvents);
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

  // Move / edit / delete all hit /api/calendar/events with the resolved event's
  // id + calendarId. Each shows its result in-card and refreshes the calendar.
  const mutateEvent = async (
    msgIdx: number, actionIdx: number,
    method: "PATCH" | "DELETE", body: Record<string, unknown>, failMsg: string,
  ) => {
    updateAction(msgIdx, actionIdx, { status: "loading" });
    try {
      const res = await fetch("/api/calendar/events", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error === "reauth_required" ? "Calendar permission needed — sign out and back in." : (err.error ?? failMsg));
      }
      updateAction(msgIdx, actionIdx, { status: "done" });
      onEventChanged?.();
    } catch (err) {
      updateAction(msgIdx, actionIdx, { status: "error", errorMsg: err instanceof Error ? err.message : failMsg });
    }
  };

  const confirmMove = (msgIdx: number, actionIdx: number, a: MoveAction) => {
    if (!a.event) return;
    mutateEvent(msgIdx, actionIdx, "PATCH", {
      eventId: a.event.eventId, calendarId: a.event.calendarId,
      start: a.data.start, end: a.data.end, timeZone: a.data.timeZone,
    }, "Failed to move event");
  };

  const confirmEdit = (msgIdx: number, actionIdx: number, a: EditAction) => {
    if (!a.event) return;
    mutateEvent(msgIdx, actionIdx, "PATCH", {
      eventId: a.event.eventId, calendarId: a.event.calendarId,
      summary: a.data.summary, location: a.data.location, description: a.data.description,
    }, "Failed to edit event");
  };

  const confirmDelete = (msgIdx: number, actionIdx: number, a: DeleteAction) => {
    if (!a.event) return;
    mutateEvent(msgIdx, actionIdx, "DELETE", { eventId: a.event.eventId, calendarId: a.event.calendarId }, "Failed to delete event");
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
          // Device IANA zone — with timezoneMode "auto" the server uses this
          // (same contract as the morning brief) so scheduling chat matches
          // where the user actually is, not a stale pinned pref.
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
            <AssistantIcon size={13} strokeWidth={2.25} className="text-emerald-400" />
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
        {messages.length > 1 && !streaming && (
          <div className="flex justify-end -mt-1 mb-1">
            <button
              onClick={() => { clearThread(); setMessages([WELCOME]); setActionMap(new Map()); }}
              title="Clear this conversation and start fresh"
              className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 hover:text-slate-300 transition-colors"
            >
              ↺ New chat
            </button>
          </div>
        )}
        {messages.map((msg, i) => {
          const actions = actionMap.get(i) ?? [];
          const displayContent = actions.length > 0
            ? { ...msg, content: stripActionBlocks(msg.content) }
            : msg;
          return (
            <div key={i}>
              <ChatMessage message={displayContent} />
              {actions.map((action, j) => {
                const dismiss = () => updateAction(i, j, { status: "dismissed" });
                switch (action.type) {
                  case "event":
                    return <EventActionCard key={j} action={action} onConfirm={() => confirmEvent(i, j, action.data)} onDismiss={dismiss} />;
                  case "task":
                    return <TaskActionCard key={j} action={action} onConfirm={() => confirmTask(i, j, action.data)} onDismiss={dismiss} />;
                  case "move":
                    return <MoveEventCard key={j} action={action} onConfirm={() => confirmMove(i, j, action)} onDismiss={dismiss} />;
                  case "edit":
                    return <EditEventCard key={j} action={action} onConfirm={() => confirmEdit(i, j, action)} onDismiss={dismiss} />;
                  case "delete":
                    return <DeleteEventCard key={j} action={action} onConfirm={() => confirmDelete(i, j, action)} onDismiss={dismiss} />;
                }
              })}
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
        <ChatInput onSend={sendMessage} disabled={streaming} seedText={initialInput} seedNonce={initialInputNonce} />
      </div>
    </div>
  );
}
