"use client";

import { useEffect, useRef, useState } from "react";

interface QuickCaptureModalProps {
  open: boolean;
  onClose: () => void;
  onCaptured?: (kind: "task" | "event" | "note") => void;
}

type Result =
  | { kind: "task"; title: string; due: string | null }
  | { kind: "event"; summary: string; start: string; end: string }
  | { kind: "note"; content: string };

const KIND_LABEL: Record<Result["kind"], string> = {
  task: "Task",
  event: "Calendar event",
  note: "Memory note",
};

const KIND_COLOR: Record<Result["kind"], string> = {
  task: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  event: "text-sky-400 border-sky-500/40 bg-sky-500/10",
  note: "text-amber-400 border-amber-500/40 bg-amber-500/10",
};

function summarise(r: Result): string {
  if (r.kind === "task") {
    return r.due ? `${r.title} — due ${r.due.slice(0, 10)}` : r.title;
  }
  if (r.kind === "event") {
    try {
      const start = new Date(r.start);
      return `${r.summary} — ${start.toLocaleString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}`;
    } catch {
      return r.summary;
    }
  }
  return r.content;
}

export default function QuickCaptureModal({ open, onClose, onCaptured }: QuickCaptureModalProps) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Focus + reset on open
  useEffect(() => {
    if (open) {
      setInput("");
      setError(null);
      setResult(null);
      setBusy(false);
      // tick so the textarea exists when we focus
      setTimeout(() => taRef.current?.focus(), 0);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submit = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/quick-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setResult(data as Result);
      onCaptured?.(data.kind);
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl+Enter to submit
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh] px-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-xl bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-800 bg-slate-900/60">
          <div className="w-6 h-6 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
            <span className="text-emerald-400 text-xs">⚡</span>
          </div>
          <div className="flex-1">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-200 leading-none">Quick Capture</p>
            <p className="text-[10px] text-slate-600 font-mono mt-0.5">
              One thought → task, calendar event, or memory note
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all text-base leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-4">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
            rows={4}
            placeholder='"remind me to email RAND about the panel next Thursday at 2"  ·  "save that the Q3 brief is due 12 Aug"  ·  "team sync tomorrow 0900-0930"'
            className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-sm text-slate-100 placeholder-slate-600 outline-none focus:border-emerald-500/50 transition-colors resize-none leading-relaxed"
          />

          <div className="flex items-center justify-between gap-2 mt-3">
            <p className="text-[10px] text-slate-600 font-mono">
              <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700">⌘/Ctrl</kbd>+
              <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700">Enter</kbd> to submit
              · <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700">Esc</kbd> to close
            </p>
            <button
              onClick={submit}
              disabled={busy || !input.trim()}
              className="text-xs font-bold uppercase tracking-wider bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-4 py-2 rounded-md transition-all glow-green disabled:opacity-40 disabled:bg-slate-800 disabled:text-slate-500 disabled:glow-none"
            >
              {busy ? "Routing…" : "Capture"}
            </button>
          </div>

          {error && (
            <p className="mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          {result && (
            <div className={`mt-3 border rounded-lg px-3 py-2.5 text-xs ${KIND_COLOR[result.kind]}`}>
              <p className="font-bold uppercase tracking-wider text-[10px] mb-0.5">
                ✓ Saved · {KIND_LABEL[result.kind]}
              </p>
              <p className="text-slate-200 leading-snug">{summarise(result)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
