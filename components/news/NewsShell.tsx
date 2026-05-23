"use client";

import { useCallback, useState } from "react";
import NewsFeed from "./NewsFeed";

function formatUpdated(d: Date): string {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function NewsShell() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const handleLoadingChange = useCallback((loading: boolean) => {
    setRefreshing(loading);
    if (!loading) setLastUpdated(new Date());
  }, []);

  const handleRefresh = () => setRefreshKey((k) => k + 1);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-end gap-3">
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

      <NewsFeed refreshKey={refreshKey} onLoadingChange={handleLoadingChange} />
    </div>
  );
}
