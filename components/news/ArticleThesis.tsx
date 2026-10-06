"use client";

import { useState } from "react";
import { openAppend, lastAppendTarget } from "@/lib/appendClient";
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
        {/* The thesis is the thought worth keeping — append it to a running
            log without leaving the page (REVIEW-2026-10 §9 D4). */}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(() => { const last = lastAppendTarget(); return last ? (
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openAppend({ text: state.thesis, source: `News · ${article.source}`, sourceTitle: article.title, sourceUrl: article.link, targetId: last.id, link: "id" in article && typeof (article as { id?: unknown }).id === "string" ? { type: "article", id: (article as { id: string }).id, title: article.title } : undefined }); }}
              className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 truncate max-w-[260px]" title={`Append to ${last.title}`}>⧉ Append to {last.title}</button>
          ) : null; })()}
          <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openAppend({ text: state.thesis, source: `News · ${article.source}`, sourceTitle: article.title, sourceUrl: article.link, link: "id" in article && typeof (article as { id?: unknown }).id === "string" ? { type: "article", id: (article as { id: string }).id, title: article.title } : undefined }); }}
            className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500" title="Append this thesis to a running log">⧉ Append to…</button>
        </div>
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
