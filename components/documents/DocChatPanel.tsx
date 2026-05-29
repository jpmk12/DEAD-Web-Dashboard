"use client";

import { useEffect, useRef, useState, KeyboardEvent } from "react";

interface DocChatPanelProps {
  docId: string;
  docTitle: string;
  onClose: () => void;
}

interface Msg { role: "user" | "assistant"; content: string }

// Per-doc chat panel. Conversation state is ephemeral and resets whenever the
// caller switches docs (the parent remounts the panel via the docId key). The
// server is told to scope all answers to the document — see system prompt in
// /api/documents/chat.
export default function DocChatPanel({ docId, docTitle, onClose }: DocChatPanelProps) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages or streamed chunks.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Focus the input when the panel first mounts; it's the user's intent for
  // opening the panel in the first place.
  useEffect(() => { inputRef.current?.focus(); }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setStreaming(true);

    // Optimistically push an empty assistant message so the streamed text
    // has somewhere to land.
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/documents/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, messages: next }),
      });
      if (!res.ok || !res.body) {
        const errText = res.status === 401 ? "Sign in to use chat." : `Request failed (${res.status}).`;
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: errText };
          return copy;
        });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") {
            copy[copy.length - 1] = { ...last, content: last.content + chunk };
          }
          return copy;
        });
      }
    } catch {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", content: "Network error. Try again." };
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0 bg-slate-900/60">
      {/* Header */}
      <div className="border-b border-slate-800 px-4 py-3 flex items-center gap-2 flex-shrink-0">
        <span className="text-emerald-400 text-sm">💬</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Ask about</p>
          <p className="text-xs text-slate-300 truncate" title={docTitle}>{docTitle}</p>
        </div>
        <button
          onClick={onClose}
          title="Close chat"
          className="text-slate-600 hover:text-slate-300 text-lg leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-slate-800 transition-all"
        >
          ×
        </button>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-[11px] text-slate-600 leading-relaxed">
            <p className="mb-2">Ask Claude anything about this doc.</p>
            <ul className="space-y-1 list-disc ml-4">
              <li>&ldquo;Summarize this in 3 bullets.&rdquo;</li>
              <li>&ldquo;What are the open questions?&rdquo;</li>
              <li>&ldquo;Counterpoint: what would the strongest critique be?&rdquo;</li>
            </ul>
          </div>
        )}
        {messages.map((m, idx) => (
          <div key={idx} className={m.role === "user" ? "flex justify-end" : ""}>
            <div className={
              m.role === "user"
                ? "max-w-[85%] bg-emerald-500/10 border border-emerald-500/30 text-emerald-100 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap"
                : "text-sm text-slate-200 leading-relaxed whitespace-pre-wrap"
            }>
              {m.content}
              {m.role === "assistant" && streaming && idx === messages.length - 1 && !m.content && (
                <span className="text-slate-600 animate-pulse">…</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-slate-800 p-3 flex-shrink-0">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          disabled={streaming}
          placeholder={streaming ? "Generating…" : "Ask about this doc (Enter to send, Shift+Enter for newline)"}
          className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none resize-none transition-colors"
        />
        <div className="flex items-center justify-between mt-2 text-[10px] font-mono text-slate-600">
          <span>{messages.length > 0 ? `${messages.filter((m) => m.role === "user").length} turn${messages.filter((m) => m.role === "user").length === 1 ? "" : "s"}` : ""}</span>
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded-md transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send ↵
          </button>
        </div>
      </div>
    </div>
  );
}
