"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import NewsFeed from "./NewsFeed";
import NewsletterSection from "./NewsletterSection";
import NewsChatPanel from "./NewsChatPanel";
import ThreadsView from "./ThreadsView";
import ThreadHistoryPanel from "./ThreadHistoryPanel";
import ChatRail from "@/components/chat/ChatRail";
import { NewsItem, NewsletterSummary, ThreadsResult } from "@/lib/types";

interface NewsShellProps {
  onArticlesChange?: (articles: NewsItem[]) => void;
  onNewslettersChange?: (newsletters: NewsletterSummary[]) => void;
  watchlist?: string[];
  previousSeenNews?: number;
  previousSeenNewsletters?: number;
}

type ViewMode = "feed" | "threads" | "history";

function formatUpdated(d: Date): string {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function NewsShell({
  onArticlesChange,
  onNewslettersChange,
  watchlist = [],
  previousSeenNews = 0,
  previousSeenNewsletters = 0,
}: NewsShellProps) {
  const [articles, setArticles] = useState<NewsItem[]>([]);
  const [newsletters, setNewsletters] = useState<NewsletterSummary[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("feed");
  const [threads, setThreads] = useState<ThreadsResult | null>(null);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState<string | null>(null);

  const inFlight = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const fetchingRef = useRef(false);

  const handleLoadingChange = useCallback((loading: boolean) => {
    inFlight.current = Math.max(0, inFlight.current + (loading ? 1 : -1));
    setRefreshing(inFlight.current > 0);
    if (inFlight.current === 0) setLastUpdated(new Date());
  }, []);

  const handleRefresh = () => {
    setThreads(null);
    setRefreshKey((k) => k + 1);
  };

  const handleArticlesLoaded = useCallback((items: NewsItem[]) => {
    setArticles(items);
    onArticlesChange?.(items);
    setThreads(null); // new articles invalidate cached threads
  }, [onArticlesChange]);

  const handleSummariesLoaded = useCallback((items: NewsletterSummary[]) => {
    setNewsletters(items);
    onNewslettersChange?.(items);
  }, [onNewslettersChange]);

  // Pre-fetch threads in the background as soon as articles are loaded
  useEffect(() => {
    if (articles.length > 0 && !threads && !fetchingRef.current) {
      void fetchThreads(articles, newsletters);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articles.length]);

  const fetchThreads = async (arts: NewsItem[], news: NewsletterSummary[]) => {
    if (fetchingRef.current || threads) return;
    fetchingRef.current = true;
    setThreadsLoading(true);
    setThreadsError(null);
    try {
      const res = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articles: arts, newsletters: news }),
      });
      if (!res.ok) throw new Error("Failed to analyse threads");
      const data: ThreadsResult = await res.json();
      setThreads(data);
    } catch {
      setThreadsError("Thread analysis failed. Try again.");
    } finally {
      fetchingRef.current = false;
      setThreadsLoading(false);
    }
  };

  const switchToThreads = () => {
    setViewMode("threads");
    if (articles.length > 0) void fetchThreads(articles, newsletters);
  };

  const switchToFeed = () => setViewMode("feed");
  const switchToHistory = () => setViewMode("history");

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* ── Left: content ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        {/* Controls bar */}
        <div className="flex items-center justify-between mb-5 gap-3">
          {/* View mode toggle */}
          <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700/80 rounded-lg p-1">
            <button
              onClick={switchToFeed}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all ${
                viewMode === "feed"
                  ? "bg-slate-700 text-slate-100 shadow-sm"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <span className="text-sm leading-none">▦</span>
              Feed
            </button>
            <button
              onClick={switchToThreads}
              disabled={articles.length === 0}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                viewMode === "threads"
                  ? "bg-emerald-500 text-slate-950 shadow-sm glow-green"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <span className="text-sm leading-none">◈</span>
              Threads
              {threadsLoading && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
            </button>
            <button
              onClick={switchToHistory}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all ${
                viewMode === "history"
                  ? "bg-slate-700 text-slate-100 shadow-sm"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <span className="text-sm leading-none">⚡</span>
              History
            </button>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            {refreshing && (
              <span className="text-[10px] text-emerald-600 font-mono uppercase tracking-wider animate-pulse">
                Fetching…
              </span>
            )}
            {lastUpdated && !refreshing && (
              <span className="text-[10px] text-slate-700 font-mono">{formatUpdated(lastUpdated)}</span>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-400 disabled:opacity-40 font-mono transition-colors"
            >
              <span className={`text-base leading-none ${refreshing ? "animate-spin" : ""}`}>↻</span>
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Feed view — always mounted; CSS hidden keeps state alive when in threads/history view */}
        <div className={viewMode !== "feed" ? "hidden" : ""}>
          <NewsletterSection
            onSummariesLoaded={handleSummariesLoaded}
            refreshKey={refreshKey}
            onLoadingChange={handleLoadingChange}
            watchlist={watchlist}
            previousSeen={previousSeenNewsletters}
          />
          <NewsFeed
            onArticlesLoaded={handleArticlesLoaded}
            refreshKey={refreshKey}
            onLoadingChange={handleLoadingChange}
            watchlist={watchlist}
            previousSeen={previousSeenNews}
          />
        </div>

        {/* History view */}
        {viewMode === "history" && <ThreadHistoryPanel />}

        {/* Threads view */}
        {viewMode === "threads" && (
          <div>
            {threadsLoading && (
              <div className="space-y-4">
                {/* Through-line skeleton */}
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 animate-pulse">
                  <div className="h-2.5 bg-slate-800 rounded w-24 mb-4" />
                  <div className="space-y-2">
                    <div className="h-3.5 bg-slate-800 rounded w-full" />
                    <div className="h-3.5 bg-slate-800 rounded w-5/6" />
                    <div className="h-3.5 bg-slate-800 rounded w-4/5" />
                  </div>
                </div>
                {/* Thread card skeletons */}
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="bg-slate-900 rounded-xl border border-slate-800 animate-pulse overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-800/40">
                      <div className="h-4 bg-slate-700 rounded w-24" />
                      <div className="h-3 bg-slate-700 rounded w-16" />
                    </div>
                    <div className="px-4 py-4 space-y-2">
                      <div className="h-4 bg-slate-800 rounded w-3/4" />
                      <div className="h-3 bg-slate-800 rounded w-full" />
                      <div className="h-3 bg-slate-800 rounded w-5/6" />
                    </div>
                  </div>
                ))}
                <div className="text-center">
                  <p className="text-xs text-slate-600 font-mono uppercase tracking-wider animate-pulse">
                    Analysing threads…
                  </p>
                </div>
              </div>
            )}

            {threadsError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 text-sm">
                {threadsError}
                <button
                  onClick={switchToThreads}
                  disabled={threadsLoading}
                  className="ml-3 text-red-400 underline hover:text-red-300 text-xs disabled:opacity-40"
                >
                  Retry
                </button>
              </div>
            )}

            {articles.length === 0 && !threadsLoading && (
              <div className="text-center py-16 text-slate-600 text-sm font-mono uppercase tracking-wider">
                Load the feed first — switch to Feed view and wait for articles to load
              </div>
            )}

            {threads && !threadsLoading && (
              <ThreadsView
                result={threads}
                articles={articles}
                newsletters={newsletters}
                watchlist={watchlist}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Right: Claude chat (slim rail) ─────────────────────────────────── */}
      <ChatRail label="Analyst" icon="◆">
        <NewsChatPanel articles={articles} newsletters={newsletters} threads={threads} />
      </ChatRail>
    </div>
  );
}
