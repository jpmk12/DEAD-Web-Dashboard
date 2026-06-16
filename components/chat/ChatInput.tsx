"use client";

import { useState, useEffect, useRef, KeyboardEvent } from "react";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
  seedText?: string;    // prefill the composer (e.g. from a Glance "reschedule" click)
  seedNonce?: number;   // bump to re-apply seedText even if the panel is already open
}

export default function ChatInput({ onSend, disabled, seedText, seedNonce }: ChatInputProps) {
  const [value, setValue] = useState(seedText ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Re-seed when a new prompt arrives (nonce changes), focusing with the cursor
  // at the end so the user can immediately type the rest ("…to tomorrow 10am").
  useEffect(() => {
    if (seedNonce === undefined) return;
    setValue(seedText ?? "");
    const el = ref.current;
    if (el) { el.focus(); const len = (seedText ?? "").length; requestAnimationFrame(() => el.setSelectionRange(len, len)); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedNonce]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex gap-2 items-end">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Message… (Enter to send)"
        rows={2}
        className="flex-1 resize-none rounded-lg border border-slate-700/80 bg-slate-800/80 text-slate-100 placeholder-slate-600 px-3 py-2 text-sm focus:outline-none focus:border-emerald-600/60 focus:ring-1 focus:ring-emerald-600/20 disabled:opacity-50 transition-colors"
      />
      <button
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed transition-all glow-green h-fit"
      >
        Send
      </button>
    </div>
  );
}
