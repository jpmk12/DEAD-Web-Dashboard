"use client";

import { useState } from "react";
import { NewsItem } from "@/lib/types";

type ArticleLike = Pick<NewsItem, "title" | "source" | "summary" | "link">;

// Session cache (per browser tab) so re-opening the same article's thesis is
// instant and never re-hits the API. The server caches too; this just avoids the
// round-trip.
const sessionCache = new Map<string, { thesis: string; basedOn: "full-text" | "summary" }>();

// Articles we've already reported interest in this session, so repeated thesis
// clicks don't spam the feedback signal.
const interestFired = new Set<string>();

// Clicking "Thesis" is a deliberate engagement signal — feed it to the ranking
// model as an implicit "opened"/interest, the same channel as clicking through.
function reportInterest(article: ArticleLike, key: string) {
  if (interestFired.has(key)) return;
  interestFired.add(key);
  fetch("/api/article-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: article.title, source: article.source, action: "opened" }),
  }).catch(() => {});
}

type State =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; thesis: string; basedOn: "full-text" | "summary" }
  | { phase: "error"; message: string };

export default function ArticleThesis({ article, className = "" }: { article: ArticleLike; className?: string }) {
  const key = article.link || article.title;
  const cachedHit = sessionCache.get(key);
  const [state, setState] = useState<State>(
    cachedHit ? { phase: "done", ...cachedHit } : { phase: "idle" },
  );

  const run = async () => {
    reportInterest(article, key);
    setState({ phase: "loading" });
    try {
      const res = await fetch("/api/news/thesis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: article.title,
          source: article.source,
          summary: article.summary,
          link: article.link,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ phase: "error", message: data?.error || "Couldn't generate a thesis." });
        return;
      }
      const result = { thesis: String(data.thesis ?? ""), basedOn: data.basedOn === "full-text" ? "full-text" as const : "summary" as const };
      sessionCache.set(key, result);
      setState({ phase: "done", ...result });
    } catch {
      setState({ phase: "error", message: "Network error. Try again." });
    }
  };

  if (state.phase === "done") {
    return (
      <div className={`rounded-md border border-violet-500/25 bg-violet-500/[0.06] px-2.5 py-2 ${className}`}>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[9px] font-bold uppercase tracking-widest text-violet-300">✦ Thesis</span>
          <span className="text-[9px] font-mono text-slate-600">
            AI · {state.basedOn === "full-text" ? "from full text" : "from summary"}
          </span>
        </div>
        <p className="text-[12px] leading-snug text-slate-200">{state.thesis}</p>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); run(); }}
        className={`text-[10px] font-mono text-red-400 hover:text-red-300 transition-colors ${className}`}
        title="Retry"
      >
        ✦ {state.message} — retry
      </button>
    );
  }

  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); run(); }}
      disabled={state.phase === "loading"}
      title="Generate the article's core thesis with AI (Claude reads the article)"
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 border transition-colors ${
        state.phase === "loading"
          ? "border-violet-500/30 text-violet-300/70 cursor-wait"
          : "border-violet-500/30 text-violet-300 hover:bg-violet-500/10"
      } ${className}`}
    >
      {state.phase === "loading" ? "✦ Reading…" : "✦ Thesis"}
    </button>
  );
}
