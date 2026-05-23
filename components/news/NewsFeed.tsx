"use client";

import { useEffect, useMemo, useState } from "react";
import { NewsItem } from "@/lib/types";
import NewsCard from "./NewsCard";

const TABS = [
  { id: "all",       label: "All" },
  { id: "overview",  label: "Overview" },
  { id: "defense",   label: "Defense" },
  { id: "strategic", label: "Strategic" },
  { id: "domestic",  label: "Domestic" },
  { id: "space",     label: "Space" },
  { id: "local",     label: "Local" },
] as const;

type TabId = typeof TABS[number]["id"];

interface NewsFeedProps {
  refreshKey?: number;
  onLoadingChange?: (loading: boolean) => void;
}

export default function NewsFeed({ refreshKey = 0, onLoadingChange }: NewsFeedProps) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("all");

  useEffect(() => {
    setLoading(true);
    onLoadingChange?.(true);
    setError(null);

    const controller = new AbortController();
    // Cache-buster on manual refresh so the browser re-fetches the JSON
    const url = refreshKey > 0 ? `/data/news.json?t=${refreshKey}` : "/data/news.json";
    fetch(url, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json();
      })
      .then((data) => {
        setItems(Array.isArray(data?.items) ? data.items : []);
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setError("Failed to load news. Please try again.");
      })
      .finally(() => {
        setLoading(false);
        onLoadingChange?.(false);
      });
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const countByCategory = useMemo(() =>
    items.reduce<Record<string, number>>((acc, item) => {
      acc[item.category] = (acc[item.category] ?? 0) + 1;
      return acc;
    }, {}),
  [items]);

  const visible = useMemo(() =>
    tab === "all" ? items : items.filter((i) => i.category === tab),
  [tab, items]);

  const getCount = (id: TabId) =>
    id === "all" ? items.length : countByCategory[id] ?? 0;

  return (
    <div>
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

      {!loading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((item) => (
            <NewsCard key={item.id} item={item} />
          ))}
          {visible.length === 0 && (
            <div className="col-span-full text-center py-12 text-slate-600 text-sm font-mono uppercase tracking-wider">
              {`No ${tab === "all" ? "" : tab + " "}articles loaded`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
