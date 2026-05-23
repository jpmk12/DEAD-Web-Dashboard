"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { NewsItem } from "@/lib/types";
import { clientCache, CACHE_TTL } from "@/lib/clientCache";
import NewsCard from "./NewsCard";

const CACHE_KEY = "news:items";

const TABS = [
  { id: "all",       label: "All" },
  { id: "overview",  label: "Overview" },
  { id: "defense",   label: "Defense" },
  { id: "strategic", label: "Strategic" },
  { id: "domestic",  label: "Domestic" },
  { id: "space",     label: "Space" },
  { id: "local",     label: "Local" },
  { id: "saved",     label: "★ Saved" },
] as const;

type TabId = typeof TABS[number]["id"];

interface NewsFeedProps {
  onArticlesLoaded?: (articles: NewsItem[]) => void;
  refreshKey?: number;
  onLoadingChange?: (loading: boolean) => void;
  watchlist?: string[];
}

export default function NewsFeed({ onArticlesLoaded, refreshKey = 0, onLoadingChange, watchlist = [] }: NewsFeedProps) {
  const { status } = useSession();
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<TabId>("all");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [errorsExpanded, setErrorsExpanded] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") return;

    const stale = clientCache.peek<NewsItem[]>(CACHE_KEY);
    const isFresh = clientCache.isFresh(CACHE_KEY);
    const isManualRefresh = refreshKey > 0;

    if (stale) { setItems(stale); onArticlesLoaded?.(stale); }
    if (isFresh && !isManualRefresh) return;

    const showSpinner = !stale || isManualRefresh;
    if (showSpinner) { setLoading(true); onLoadingChange?.(true); }

    const controller = new AbortController();
    const url = isManualRefresh ? `/api/news?t=${refreshKey}` : "/api/news";
    fetch(url, { signal: controller.signal })
      .then((r) => {
        if (r.status === 401) throw new Error("unauthorized");
        return r.json();
      })
      .then((data) => {
        const loaded: NewsItem[] = data.items ?? [];
        setItems(loaded);
        onArticlesLoaded?.(loaded);
        setSourceErrors(data.sourceErrors ?? {});
        clientCache.set(CACHE_KEY, loaded, CACHE_TTL.NEWS);
      })
      .catch((e) => {
        if (e.name === "AbortError" || e.message === "unauthorized") return;
        setError("Failed to load news. Please try again.");
      })
      .finally(() => {
        if (showSpinner) { setLoading(false); onLoadingChange?.(false); }
      });
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, refreshKey]);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/saved")
      .then((r) => r.json())
      .then((data) => {
        const ids = new Set<string>((data.items ?? []).map((i: { id: string }) => i.id));
        setSavedIds(ids);
      })
      .catch(() => {});
  }, [status]);

  // Callbacks must be declared before any early returns (React rules of hooks)
  const handleFeedback = useCallback((title: string, source: string, action: "useful" | "not_useful") => {
    fetch("/api/article-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, source, action }),
    }).catch(() => {});
  }, []);

  const handleSave = useCallback((item: NewsItem) => {
    setSavedIds((prev) => new Set(prev).add(item.id));
    fetch("/api/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item.id,
        type: "article",
        title: item.title,
        content: item.summary ?? "",
        source: item.source,
        link: item.link,
      }),
    }).catch(() => {});
  }, []);

  const handleUnsave = useCallback((id: string) => {
    setSavedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    fetch(`/api/saved?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const countByCategory = useMemo(() =>
    items.reduce<Record<string, number>>((acc, item) => {
      acc[item.category] = (acc[item.category] ?? 0) + 1;
      return acc;
    }, {}),
  [items]);

  const visible = useMemo(() =>
    tab === "saved" ? items.filter((i) => savedIds.has(i.id)) :
    tab === "all"   ? items :
    items.filter((i) => i.category === tab),
  [tab, items, savedIds]);

  if (status === "unauthenticated") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-5 text-center">
        <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-2xl">
          📰
        </div>
        <div>
          <h2 className="text-base font-bold tracking-wide text-slate-200 mb-1">Sign in to read the news</h2>
          <p className="text-sm text-slate-500 max-w-xs">
            Sign in with Google to load your personalised news feed.
          </p>
        </div>
        <button
          onClick={() => signIn("google")}
          className="flex items-center gap-2 bg-slate-800 border border-slate-700 text-slate-200 px-5 py-2.5 rounded-lg font-medium hover:border-emerald-700 hover:text-emerald-400 transition-all text-sm"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  const getCount = (id: TabId) => {
    if (id === "all") return items.length;
    if (id === "saved") return savedIds.size;
    return countByCategory[id] ?? 0;
  };

  const failedCount = Object.keys(sourceErrors).length;

  return (
    <div>
      {/* Category tab bar */}
      <div className="flex items-center gap-0 mb-5 border-b border-slate-800 overflow-x-auto scrollbar-none -mx-1 px-1">
        {TABS.map(({ id, label }) => {
          const count = getCount(id);
          const isActive = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${
                isActive
                  ? "border-emerald-500 text-emerald-400"
                  : "border-transparent text-slate-500 hover:text-slate-300 hover:border-slate-700"
              }`}
            >
              {label}
              {count > 0 && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono leading-none ${
                  isActive ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-600"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-slate-900 rounded-xl border border-slate-800 p-5 animate-pulse">
              <div className="h-3 bg-slate-800 rounded-md w-24 mb-3" />
              <div className="h-4 bg-slate-800 rounded-md w-full mb-2" />
              <div className="h-4 bg-slate-800 rounded-md w-5/6 mb-4" />
              <div className="h-3 bg-slate-800 rounded-md w-full mb-1" />
              <div className="h-3 bg-slate-800 rounded-md w-4/5" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 text-sm mb-4">
          {error}
        </div>
      )}

      {/* Collapsed source error summary */}
      {!loading && failedCount > 0 && (
        <div className="mb-4">
          <button
            onClick={() => setErrorsExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-mono bg-amber-500/10 border border-amber-500/30 text-amber-500 rounded-lg px-2.5 py-1.5 hover:bg-amber-500/15 transition-colors"
          >
            <span className="text-amber-400">⚠</span>
            <span>{failedCount} source{failedCount > 1 ? "s" : ""} unavailable</span>
            <span className="text-amber-600">{errorsExpanded ? "▲" : "▼"}</span>
          </button>
          {errorsExpanded && (
            <div className="mt-2 space-y-1.5 pl-1">
              {Object.entries(sourceErrors).map(([src, msg]) => (
                <div key={src} className="text-[10px] font-mono text-amber-600">
                  {src}: {msg.slice(0, 80)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((item) => (
            <NewsCard
              key={item.id}
              item={item}
              onFeedback={handleFeedback}
              isSaved={savedIds.has(item.id)}
              onSave={handleSave}
              onUnsave={handleUnsave}
              watchlist={watchlist}
            />
          ))}
          {visible.length === 0 && (
            <div className="col-span-full text-center py-12 text-slate-600 text-sm font-mono uppercase tracking-wider">
              {tab === "saved" ? "No saved articles yet — star articles to save them" : `No ${tab === "all" ? "" : tab + " "}articles loaded`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
