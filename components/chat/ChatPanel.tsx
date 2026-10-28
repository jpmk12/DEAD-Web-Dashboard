"use client";

import { useEffect, useRef, useState } from "react";
import { openAppend } from "@/lib/appendClient";
import { CalendarEvent, ChatMessage as ChatMessageType, GoogleTask, NewsItem, NewsletterSummary, ThreadsResult } from "@/lib/types";
import ChatMessage from "./ChatMessage";
import { AssistantIcon } from "@/lib/icons";
import ChatInput from "./ChatInput";
import { isWarningShaped } from "@/lib/askResolve";
import type { AskDoor } from "@/lib/askFormat";
import { ASSESSMENT_TAG, assessmentFileName, assessmentMarkdown, assessmentTitle, renderAssessmentHtml, stripBoardNote, type AssessmentRecord } from "@/lib/assessmentExport";
import { downloadFile } from "@/lib/exports";
import { toast } from "@/lib/feedback";

// "Ask the board" (docs/PLAN-SPACE-CYBER-ASK.md §4): a question answered
// from the dashboard's own picture through /api/ask under a fixed contract,
// never a free chat. ON by the header toggle (remembered per browser) or
// AUTO for a warning-shaped question ("how likely…", "what indicators…");
// the reply says which. The answer carries SURFACE CHIPS — doors to the
// board / tile / room the evidence came from.
interface AskMeta {
  surfaces: { label: string; door?: AskDoor; unavailable?: boolean }[];
  unavailable: string[];
  model: string;
  cached?: boolean;
  auto: boolean;
  entities: { boards: string[]; unplaced: string[] };
  /** The record for Export / Save as doc: the question, the CLEAN answer, the pack's snapshot time. */
  question: string;
  answer: string;
  atISO: string;
}
const ASK_KEY = "assistant.askBoard";
const ASK_MODEL_KEY = "assistant.askModel";
function runDoor(d: AskDoor) {
  window.dispatchEvent(new CustomEvent(d.event, { detail: d.detail }));
  if (d.then) { const t = d.then; setTimeout(() => window.dispatchEvent(new CustomEvent(t.event, { detail: t.detail })), t.delayMs ?? 100); }
}

interface ChatPanelProps {
  calendarEvents: CalendarEvent[];
  tasks?: GoogleTask[];
  articles?: NewsItem[];
  newsletters?: NewsletterSummary[];
  /** The News tab's threads analysis, when it has run (one assistant, 2026-10-05). */
  threads?: ThreadsResult | null;
  onTaskAdded?: () => void;
  onEventChanged?: () => void;   // fired after a successful add/move/edit/delete
  initialInput?: string;         // prefill the composer (e.g. seeded from Glance)
  initialInputNonce?: number;    // bump to re-apply initialInput when already open
  /** Open with "Ask the board" ON (the palette's entry); re-applied with initialInputNonce. */
  askBoard?: boolean;
}

const WELCOME: ChatMessageType = {
  role: "assistant",
  content:
    "I can see your calendar, tasks, and the dashboard's current OE picture — force posture, base SITREPs, I&W boards, alerts, and what changed since you last looked. Ask what to worry about, why something is red, or to find free time, add, move, or cancel something.",
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
            className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3 py-1.5 rounded-md disabled:opacity-50 transition-colors"
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
    ? "bg-red-600/80 hover:bg-red-600 text-white"
    : "bg-emerald-500 hover:bg-emerald-400 text-slate-950";
  return (
    <div className="flex gap-2 mt-2">
      <button onClick={onConfirm} disabled={status === "loading"} className={`flex items-center gap-1 ${btn} disabled:opacity-50 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md transition-colors`}>
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
  threads = null,
  onTaskAdded,
  onEventChanged,
  initialInput,
  initialInputNonce,
  askBoard,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>(() => loadThread());
  const [streaming, setStreaming] = useState(false);
  const [streamedIdx, setStreamedIdx] = useState(-1);
  const [actionMap, setActionMap] = useState<Map<number, PendingAction[]>>(new Map());
  const [askMap, setAskMap] = useState<Map<number, AskMeta>>(new Map());
  // Assessments saved as docs this session (message index → doc id), so the
  // button becomes "open" instead of saving the same answer twice.
  const [savedMap, setSavedMap] = useState<Map<number, string>>(new Map());
  const [savingIdx, setSavingIdx] = useState<number | null>(null);

  // The record an assistant reply exports as: a board answer carries its own
  // question / snapshot time / surfaces; a plain chat reply takes the user
  // turn before it as the question and the client's clock as the time.
  const recordFor = (i: number, content: string): AssessmentRecord => {
    const meta = askMap.get(i);
    if (meta) {
      return { question: meta.question, answer: meta.answer, atISO: meta.atISO, source: "board", model: meta.model, surfaces: meta.surfaces, unavailable: meta.unavailable, unplaced: meta.entities.unplaced };
    }
    const prev = messages[i - 1];
    return { question: prev?.role === "user" ? prev.content : "", answer: stripBoardNote(content), atISO: new Date().toISOString(), source: "assistant" };
  };
  const exportAssessment = (i: number, content: string, ext: "html" | "md") => {
    const rec = recordFor(i, content);
    downloadFile(ext === "html" ? renderAssessmentHtml(rec) : assessmentMarkdown(rec), assessmentFileName(rec, ext), ext === "html" ? "text/html" : "text/markdown");
  };
  const openDoc = (id: string) => {
    window.dispatchEvent(new CustomEvent("app:navigate", { detail: "docs" }));
    setTimeout(() => window.dispatchEvent(new CustomEvent("docs:open", { detail: id })), 120);
  };
  const saveAssessment = async (i: number, content: string) => {
    if (savingIdx !== null) return;
    const rec = recordFor(i, content);
    setSavingIdx(i);
    try {
      const r = await fetch("/api/documents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: assessmentTitle(rec), content: assessmentMarkdown(rec), docType: "note",
          tags: [ASSESSMENT_TAG, rec.source === "board" ? "ask-the-board" : "assistant"],
          props: { source: rec.source === "board" ? "ask the board" : "assistant", "as of": rec.atISO.slice(0, 16).replace("T", " ") + "Z", ...(rec.model ? { model: rec.model } : {}) },
        }),
      });
      const j = await r.json().catch(() => null) as { document?: { id: string }; id?: string; error?: string } | null;
      if (!r.ok) throw new Error(j?.error ?? (r.status === 401 ? "Signed out — sign in again." : `HTTP ${r.status}`));
      const id = j?.document?.id ?? j?.id ?? "";
      if (!id) throw new Error("The server did not return a document id.");
      setSavedMap((prev) => new Map(prev).set(i, id));
      window.dispatchEvent(new CustomEvent("docs:changed"));
      toast.ok("Saved to Docs", assessmentTitle(rec));
    } catch (err) {
      toast.error("Could not save the assessment", err);
    } finally {
      setSavingIdx(null);
    }
  };
  const [askMode, setAskMode] = useState<boolean>(() => { try { return localStorage.getItem(ASK_KEY) === "1"; } catch { return false; } });
  const [askModel, setAskModel] = useState<"sonnet" | "opus">(() => { try { return localStorage.getItem(ASK_MODEL_KEY) === "opus" ? "opus" : "sonnet"; } catch { return "sonnet"; } });
  useEffect(() => { try { localStorage.setItem(ASK_KEY, askMode ? "1" : "0"); } catch { /* ignore */ } }, [askMode]);
  useEffect(() => { try { localStorage.setItem(ASK_MODEL_KEY, askModel); } catch { /* ignore */ } }, [askModel]);
  useEffect(() => { if (askBoard) setAskMode(true); }, [askBoard, initialInputNonce]);
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

  // One question, answered from the board. Not streamed: the pack is built
  // first (bounded) and the answer lands whole with its surface chips.
  const askTheBoard = async (text: string, auto: boolean) => {
    const userMsg: ChatMessageType = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    const idx = newMessages.length;
    setMessages([...newMessages, { role: "assistant", content: "" }]);
    setStreaming(true);
    try {
      // The server answers 202 { pending, ticket } while it reads the board
      // and asks the model in the background; poll the ticket until it lands.
      let res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, model: askModel }) });
      let d = await res.json().catch(() => null);
      for (let tries = 0; res.status === 202 && d?.ticket && tries < 20; tries++) {
        setMessages((prev) => { const u = [...prev]; u[idx] = { role: "assistant", content: `_${d?.note ?? "Reading the board…"}_` }; return u; });
        res = await fetch(`/api/ask?ticket=${encodeURIComponent(d.ticket)}`, { cache: "no-store" });
        d = await res.json().catch(() => null);
      }
      if (res.status === 202) throw new Error("Still reading the board — ask again in a minute and the answer will be waiting.");
      if (!res.ok || !d?.answer) throw new Error(d?.error ?? (res.status === 401 ? "Signed out — sign in again." : d === null ? `HTTP ${res.status} — the server did not answer with JSON` : `HTTP ${res.status}`));
      const note = auto ? "\n\n_Answered from the board (the question looked like a warning question). Turn ◉ Board off in the header to chat freely._" : "";
      setMessages((prev) => { const u = [...prev]; u[idx] = { role: "assistant", content: `${d.answer}${note}` }; return u; });
      setAskMap((prev) => new Map(prev).set(idx, {
        surfaces: d.surfaces ?? [], unavailable: d.unavailable ?? [], model: d.model ?? askModel, cached: d.cached, auto, entities: d.entities ?? { boards: [], unplaced: [] },
        question: text, answer: String(d.answer), atISO: typeof d.atISO === "string" ? d.atISO : new Date().toISOString(),
      }));
    } catch (err) {
      const why = err instanceof Error ? err.message : "";
      setMessages((prev) => { const u = [...prev]; u[idx] = { role: "assistant", content: why ? `⚠ ${why}` : "Could not answer from the board." }; return u; });
    } finally {
      setStreaming(false);
    }
  };

  const sendMessage = async (text: string) => {
    if (askMode) return askTheBoard(text, false);
    if (isWarningShaped(text)) return askTheBoard(text, true);
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
          // Which surface the user is looking at (TabShell mirrors the active
          // tab onto <body data-tab>), so "this" in a question has a referent.
          surface: typeof document !== "undefined" ? document.body.dataset.tab ?? null : null,
          calendarContext: calendarEvents,
          tasks,
          articles,
          newsletters,
          threads,
        }),
      });

      if (!res.ok) {
        // /api/chat answers plain text on 401 / 413 / 429 / 503 — show it as
        // an error, never as the assistant's own reply.
        const why = (await res.text().catch(() => "")).trim().slice(0, 200);
        throw new Error(res.status === 401 ? "Signed out — sign in again." : why || `HTTP ${res.status}`);
      }
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
    } catch (err) {
      const why = err instanceof Error && err.message && err.message !== "No response body" ? err.message : "";
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: why ? `⚠ ${why}` : "Sorry, something went wrong. Please try again.",
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
          <button
            type="button" onClick={() => setAskMode((v) => !v)} aria-pressed={askMode}
            title={askMode ? "Ask the board is ON — every question is answered from the I&W boards, posture, straits and economy under a fixed contract. Click to chat freely." : "Ask the board — answer the next question from the dashboard's own picture (warning-shaped questions route here automatically)"}
            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border transition-colors ${askMode ? "border-sky-500/50 bg-sky-500/15 text-sky-200" : "border-slate-700 text-slate-500 hover:text-slate-300"}`}
          >◉ Board</button>
          {askMode && (
            <select value={askModel} onChange={(e) => setAskModel(e.target.value === "opus" ? "opus" : "sonnet")} title="Model for Ask the board (Sonnet by default; Opus on request)"
              className="bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-[10px] text-slate-300 outline-none">
              <option value="sonnet">Sonnet</option><option value="opus">Opus</option>
            </select>
          )}
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
              ↻ New chat
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
              {msg.role === "assistant" && displayContent.content && !(streaming && i === messages.length - 1) && (
                <div className="-mt-1 mb-2 pl-1 space-y-1">
                  {(() => {
                    const meta = askMap.get(i);
                    if (!meta) return null;
                    const live = meta.surfaces.filter((s) => !s.unavailable);
                    return (
                      <div className="flex flex-wrap items-center gap-1" title={`Answered from the board · ${meta.model}${meta.cached ? " · cached" : ""}${meta.unavailable.length ? ` · unavailable this pass: ${meta.unavailable.join(", ")}` : ""}`}>
                        <span className="text-[8px] font-bold uppercase tracking-wider text-sky-300/80 mr-0.5">◉ surfaces</span>
                        {live.slice(0, 8).map((s) => (
                          <button key={s.label} type="button" disabled={!s.door} onClick={() => s.door && runDoor(s.door)} title={s.door ? `Open ${s.label}` : s.label}
                            className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-sky-500/30 text-sky-200/90 hover:bg-sky-500/10 disabled:border-slate-800 disabled:text-slate-500 disabled:hover:bg-transparent">
                            {s.label.replace(/^OSINT › Commands › /, "").slice(0, 38)}
                          </button>
                        ))}
                        {meta.unavailable.length > 0 && <span className="text-[9px] text-amber-200/70">{meta.unavailable.length} unavailable</span>}
                        {meta.entities.unplaced.length > 0 && <span className="text-[9px] text-slate-500">not placed: {meta.entities.unplaced.join(", ")}</span>}
                      </div>
                    );
                  })()}
                  {(() => {
                    const meta = askMap.get(i);
                    const savedId = savedMap.get(i);
                    const btn = "text-[9px] font-bold uppercase tracking-wider text-slate-600 hover:text-emerald-300 disabled:text-slate-700 disabled:hover:text-slate-700";
                    return (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <button type="button" onClick={() => openAppend({ text: meta ? stripBoardNote(meta.answer) : displayContent.content, source: meta ? "assistant · board" : "assistant", sourceTitle: meta?.question })} className={btn} title="Append this answer to a running log or working doc">⧉ Append to…</button>
                        {savedId
                          ? <button type="button" onClick={() => openDoc(savedId)} className="text-[9px] font-bold uppercase tracking-wider text-emerald-300 hover:text-emerald-200" title="Open the saved assessment in Docs">✓ saved · open</button>
                          : <button type="button" disabled={savingIdx !== null} onClick={() => saveAssessment(i, displayContent.content)} className={btn} title="Save this assessment as its own doc (tagged assessment, with the question, time and surfaces)">{savingIdx === i ? "saving…" : "＋ Save as doc"}</button>}
                        <button type="button" onClick={() => exportAssessment(i, displayContent.content, "html")} className={btn} title="Download a self-contained HTML snapshot (no script, no network) to share">⇩ HTML</button>
                        <button type="button" onClick={() => exportAssessment(i, displayContent.content, "md")} className={btn} title="Download as Markdown">⇩ .md</button>
                      </div>
                    );
                  })()}
                </div>
              )}
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
