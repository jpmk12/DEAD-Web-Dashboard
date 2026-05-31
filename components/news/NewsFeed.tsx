"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { NewsItem } from "@/lib/types";
import { clientCache, CACHE_TTL } from "@/lib/clientCache";
import NewsCard from "./NewsCard";

const CACHE_KEY = "news:items";

// Keep in sync with /api/news/curated CANDIDATE_LIMIT — the shortlist we hand
// the curator. The Overview is built from this pool, not a source category.
const CANDIDATE_LIMIT = 45;
// Curation is cached server-side once per day; this client key just avoids
// re-POSTing on every tab switch / background refresh within a session.
const CURATED_KEY = "news:curated";

interface Curated {
  critical: NewsItem[];
  discover: NewsItem[];
  mode: "ai" | "deterministic";
}

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
  previousSeen?: number;
}

export default function NewsFeed({
  onArticlesLoaded,
  refreshKey = 0,
  onLoadingChange,
  watchlist = [],
  previousSeen = 0,
}: NewsFeedProps) {
  const { status } = useSession();
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<TabId>("all");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const [curated, setCurated] = useState<Curated | null>(null);
  const [curating, setCurating] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);
  // Bumped on a prefs save (clientCache.clear + dashboard-cache-cleared) so the
  // Overview re-curates once against the new role/topics/watchlist even while
  // the tab is open. The server's ctx_hash keying makes the regenerate cheap
  // and one-shot — unchanged prefs still hit the daily cache.
  const [prefsVersion, setPrefsVersion] = useState(0);

  useEffect(() => {
    const onCleared = () => setPrefsVersion((v) => v + 1);
    window.addEventListener("dashboard-cache-cleared", onCleared);
    return () => window.removeEventListener("dashboard-cache-cleared", onCleared);
  }, []);

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

  // Curate the Overview lazily — only when the user is on that tab and we have
  // articles. Curation runs once per day (cached server-side and frozen for the
  // day to keep cost down and the list stable). A manual refresh (refreshKey)
  // forces a regenerate with ?refresh=1; otherwise the session-level cache keeps
  // tab switches and background refreshes from re-POSTing.
  useEffect(() => {
    if (status !== "authenticated" || tab !== "overview" || items.length === 0) return;

    // A prefs save (prefsVersion bump) clears clientCache, so get() returns
    // null and we re-POST; the server then re-curates on the ctx_hash miss.
    const manual = refreshKey > 0;
    const cached = manual ? null : clientCache.get<Curated>(CURATED_KEY);
    if (cached) { setCurated(cached); setCurating(false); return; }

    setCurating(true);
    const controller = new AbortController();
    fetch(manual ? "/api/news/curated?refresh=1" : "/api/news/curated", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates: items.slice(0, CANDIDATE_LIMIT) }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: Curated) => {
        setCurated(data);
        // Long client TTL — the server enforces once-per-day; this just stops
        // intra-session re-POSTs. Cleared on prefs save via clientCache.clear().
        clientCache.set(CURATED_KEY, data, 12 * 60 * 60 * 1000);
      })
      .catch(() => {})
      .finally(() => setCurating(false));
    return () => controller.abort();
  }, [status, tab, items, refreshKey, prefsVersion]);

  // Callbacks must be declared before any early returns (React rules of hooks)
  const handleFeedback = useCallback((title: string, source: string, action: "useful" | "not_useful" | "opened") => {
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

  // The curated set is frozen server-side, so render it directly rather than
  // mapping ids against the live feed (which rolls older articles off).
  const criticalItems = curated?.critical ?? [];
  const discoverItems = curated?.discover ?? [];
  // Show a skeleton while the first curation of the day is in flight.
  const overviewLoading = curating && criticalItems.length === 0;

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
    if (id === "overview") return criticalItems.length;
    return countByCategory[id] ?? 0;
  };

  const failedCount = Object.keys(sourceErrors).length;

  const renderCard = (item: NewsItem) => (
    <NewsCard
      key={item.id}
      item={item}
      onFeedback={handleFeedback}
      isSaved={savedIds.has(item.id)}
      onSave={handleSave}
      onUnsave={handleUnsave}
      watchlist={watchlist}
      previousSeen={previousSeen}
    />
  );

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

      {/* Overview — AI-curated "critical for you" + collapsed discovery.
          Drawn from the whole feed, so it never blanks when a single
          source (e.g. DVIDS) is disabled. */}
      {!loading && !error && tab === "overview" && (
        <div>
          {overviewLoading && (
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

          {!overviewLoading && criticalItems.length === 0 && (
            <div className="text-center py-12 text-slate-600 text-sm font-mono uppercase tracking-wider">
              {items.length === 0 ? "No articles loaded" : "Nothing critical surfaced — check the All tab"}
            </div>
          )}

          {criticalItems.length > 0 && (
            <>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Critical for you</span>
                <div className="flex-1 h-px bg-slate-800" />
                <span className="text-[10px] font-mono text-slate-600 uppercase tracking-wider">
                  {curated?.mode === "ai" ? "AI-curated" : "by your interests"}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {criticalItems.map(renderCard)}
              </div>
            </>
          )}

          {discoverItems.length > 0 && (
            <div className="mt-8">
              <button
                onClick={() => setShowDiscover((v) => !v)}
                className="flex items-center gap-2 w-full text-left mb-4 group"
              >
                <span className="text-xs font-bold uppercase tracking-widest text-slate-500 group-hover:text-slate-300 transition-colors">
                  More to discover
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded font-mono leading-none bg-slate-800 text-slate-600">
                  {discoverItems.length}
                </span>
                <div className="flex-1 h-px bg-slate-800" />
                <span className="text-slate-600 text-xs">{showDiscover ? "▲" : "▼"}</span>
              </button>
              {showDiscover && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {discoverItems.map(renderCard)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!loading && !error && tab !== "overview" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map(renderCard)}
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
