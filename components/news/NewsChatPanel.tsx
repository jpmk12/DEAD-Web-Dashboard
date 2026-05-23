"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NewsItem, NewsletterSummary, ThreadsResult, ChatMessage as ChatMsg } from "@/lib/types";
import ChatMessageBubble from "@/components/chat/ChatMessage";
import ChatInput from "@/components/chat/ChatInput";

interface NewsChatPanelProps {
  articles: NewsItem[];
  newsletters: NewsletterSummary[];
  threads?: ThreadsResult | null;
}

const WELCOME: ChatMsg = {
  role: "assistant",
  content:
    "I'm your news analyst. Ask me to explain a story, connect the dots between articles, find background on any topic, or tell me what you want more or less of.",
};

export default function NewsChatPanel({ articles, newsletters, threads }: NewsChatPanelProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([WELCOME]);
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Track whether the user is pinned to the bottom
  const pinnedRef = useRef(true);
  // Track message count so we can distinguish "new message" vs "chunk appended"
  const msgCountRef = useRef(messages.length);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const countIncreased = messages.length > msgCountRef.current;
    msgCountRef.current = messages.length;

    if (countIncreased) {
      // New message added — always scroll down and re-pin
      pinnedRef.current = true;
      el.scrollTop = el.scrollHeight;
    } else if (pinnedRef.current) {
      // Streaming chunk — instant jump so animation doesn't reset
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const sendMessage = useCallback(async (text: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const userMsg: ChatMsg = { role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const res = await fetch("/api/news-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: history.filter((m) => m.content),
          articles,
          newsletters,
          threads: threads ?? null,
        }),
      });

      if (!res.body) throw new Error("No stream");
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
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("News chat stream error:", err);
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: "Something went wrong. Please try again.",
        };
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  }, [messages, articles, newsletters, threads]);

  const bulletCount = newsletters.reduce((n, nl) => n + nl.bullets.length, 0);

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 flex flex-col h-full sticky top-20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
            <span className="text-emerald-400 text-xs">◆</span>
          </div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-300">News Analyst</h2>
        </div>
        <div className="flex items-center gap-1.5">
          {articles.length > 0 && (
            <span className="text-[10px] text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-md font-mono font-bold">
              {articles.length} art
            </span>
          )}
          {bulletCount > 0 && (
            <span className="text-[10px] text-blue-400 bg-blue-500/10 border border-blue-500/30 px-2 py-0.5 rounded-md font-mono font-bold">
              {bulletCount} nl
            </span>
          )}
          {threads && threads.threads.length > 0 && (
            <span className="text-[10px] text-violet-400 bg-violet-500/10 border border-violet-500/30 px-2 py-0.5 rounded-md font-mono font-bold">
              {threads.threads.length} thr
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-1 min-h-[300px] max-h-[calc(100vh-300px)]"
      >
        {messages.map((msg, i) => (
          <ChatMessageBubble key={i} message={msg} />
        ))}
        {streaming && messages[messages.length - 1]?.content === "" && (
          <div className="flex justify-start">
            <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl rounded-bl-sm px-4 py-2.5">
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
