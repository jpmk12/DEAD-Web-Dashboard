"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import NewsFeed from "./NewsFeed";
import NewsletterSection from "./NewsletterSection";
import { updatedAgo } from "@/lib/relTime";
import ThreadsView from "./ThreadsView";
import MovingRail, { type Days } from "./MovingRail";
import LabelDrawer from "./LabelDrawer";
import NewsAssistantCard from "./NewsAssistantCard";
import { FeedViewIcon, ThreadsViewIcon } from "@/lib/icons";
import { NewsItem, NewsletterSummary, NewsThread, ThreadsResult } from "@/lib/types";
import type { LabelOccurrence, StoredSession } from "@/lib/threadHistory";
import type { ThreadDoor } from "@/lib/threadTrajectory";
import { saveThreadToDocs, followThread, askAboutThread } from "@/lib/threadActions";
import { toast } from "@/lib/feedback";

// The News tab (REVIEW-2026-10 §2, approved 2026-10-05): two views, not
// three. THREADS is the landing view — the synthesis the operator values
// most — with the History tab folded into it (the Moving rail, each card's
// trajectory, the past-days rows and the label drawer). READ holds the
// newsletter queue and the article lanes. The right-hand "News analyst" is
// gone: the assistant card seeds the ONE floating assistant, which on this
// surface receives the articles, newsletters and threads.
//
// Cost rule: Threads is the priciest call in the app and is now the landing
// view, so it runs when the tab's feed has loaded AND this view is showing
// (the default) — day-cached by article hash server-side, and capped at
// THREADS_MAX_GENERATIONS per day past which the day's last read is served
// (the header says so). ↻ Regenerate is the only way past the cap.

interface NewsShellProps {
  onArticlesChange?: (articles: NewsItem[]) => void;
  onNewslettersChange?: (newsletters: NewsletterSummary[]) => void;
  onThreadsChange?: (threads: ThreadsResult | null) => void;
  watchlist?: string[];
  previousSeenNews?: number;
  previousSeenNewsletters?: number;
}

type ViewMode = "threads" | "read";
type ThreadsBody = ThreadsResult & { previous?: StoredSession | null; capped?: boolean; generations?: number; generatedAt?: string; cached?: boolean };

const formatUpdated = (d: Date): string => updatedAgo(d);

const emit = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

export default function NewsShell({
  onArticlesChange,
  onNewslettersChange,
  onThreadsChange,
  watchlist = [],
  previousSeenNews = 0,
  previousSeenNewsletters = 0,
}: NewsShellProps) {
  const [articles, setArticles] = useState<NewsItem[]>([]);
  const [newsletters, setNewsletters] = useState<NewsletterSummary[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("threads");
  const [threads, setThreads] = useState<ThreadsBody | null>(null);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  // A past session chosen from the Moving rail, shown in place of today's.
  const [pastSession, setPastSession] = useState<StoredSession | null>(null);
  const [pastPrevious, setPastPrevious] = useState<StoredSession | null>(null);
  // Per-label occurrences for the card sparklines (14 d), from the heatmap view.
  const [occurrences, setOccurrences] = useState<Record<string, LabelOccurrence[]>>({});
  // The I&W boards, for the door-in chips (cheap, server-cached).
  const [boards, setBoards] = useState<{ problemId: string; label: string; level: string; trajectory: string }[]>([]);
  const [criticalIds, setCriticalIds] = useState<Set<string>>(new Set());
  // Local watchlist view so Follow reflects immediately; the prop is the base.
  const [localWatch, setLocalWatch] = useState<string[] | null>(null);
  const effectiveWatch = localWatch ?? watchlist;
  const [drawer, setDrawer] = useState<{ label: string | null; query: string | null; days: Days } | null>(null);

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

  useEffect(() => { onThreadsChange?.(threads); }, [threads, onThreadsChange]);

  const fetchThreads = async (arts: NewsItem[], news: NewsletterSummary[], refresh = false) => {
    if (fetchingRef.current || (threads && !refresh)) return;
    fetchingRef.current = true;
    setThreadsLoading(true);
    setThreadsError(null);
    try {
      const res = await fetch(`/api/threads${refresh ? "?refresh=1" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articles: arts, newsletters: news }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error || "Failed to analyse threads");
      }
      const data: ThreadsBody = await res.json();
      setThreads(data);
    } catch (e) {
      setThreadsError(e instanceof Error ? e.message : "Thread analysis failed. Try again.");
    } finally {
      fetchingRef.current = false;
      setThreadsLoading(false);
    }
  };

  // Threads is the landing view: fetch once the feed has loaded while this
  // view is showing (also covers a Refresh performed on it, which clears
  // `threads`). The error guard stops a failed call from looping.
  useEffect(() => {
    if (viewMode !== "threads") return;
    if (articles.length === 0 || threads || threadsLoading || threadsError) return;
    void fetchThreads(articles, newsletters);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, articles.length, threads, threadsLoading, threadsError]);

  // History for the cards + the boards for the doors — once per threads load.
  useEffect(() => {
    if (!threads) return;
    fetch("/api/thread-history?view=heatmap&days=14").then((r) => r.json()).then((d) => {
      const map: Record<string, LabelOccurrence[]> = {};
      for (const row of (d.heatmap ?? []) as { label: string; occurrences: { date: string; trend: LabelOccurrence["trend"] }[] }[]) {
        map[row.label] = row.occurrences.map((o) => ({ date: o.date, trend: o.trend, headline: "", sessionId: 0 }));
      }
      setOccurrences(map);
    }).catch(() => {});
    fetch("/api/warning").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d && Array.isArray(d.problems)) setBoards(d.problems.map((p: { problemId: string; label: string; level: string; trajectory: string }) => ({ problemId: p.problemId, label: p.label, level: p.level, trajectory: p.trajectory })));
    }).catch(() => {});
  }, [threads]);

  const onAsk = (t: NewsThread) => askAboutThread(t);
  const onSave = async (t: NewsThread) => {
    try {
      const r = await saveThreadToDocs(t, new Date().toISOString().slice(0, 10));
      toast.ok(r.created ? `Thread doc created — "Thread: ${t.label}"` : `Thread doc updated — today's stop added to "Thread: ${t.label}"`, "Open it on the Docs tab; the Trace renders as a timeline.");
    } catch (e) { toast.error("Could not save the thread doc", e); }
  };
  const onFollow = async (t: NewsThread, follow: boolean) => {
    const prev = effectiveWatch;
    setLocalWatch(follow ? [...prev, t.label.toLowerCase()] : prev.filter((w) => w.toLowerCase() !== t.label.toLowerCase()));
    try {
      await followThread(t.label, follow);
      toast.ok(follow ? `Following ${t.label} — on your watchlist now` : `Stopped following ${t.label}`);
    } catch (e) { setLocalWatch(prev); toast.error("Could not update the watchlist", e); }
  };
  const onDoor = (d: ThreadDoor) => {
    if (d.kind === "board") {
      emit("app:navigate", "osint"); emit("osint:set-pane", "watch");
      setTimeout(() => emit("watch:focus", { kind: "iw", id: d.id }), 160);
    } else {
      emit("app:navigate", "markets");
    }
  };
  const openLabel = (label: string, days: Days = 30) => setDrawer({ label, query: null, days });
  const selectSession = async (s: StoredSession | null) => {
    setPastSession(s);
    setPastPrevious(null);
    if (!s) return;
    // The day before the chosen day, for its Δ lines.
    try {
      const r = await fetch("/api/thread-history?view=sessions&days=60");
      const d = await r.json();
      const list: StoredSession[] = Array.isArray(d.sessions) ? d.sessions : [];
      setPastPrevious(list.filter((x) => x.date < s.date).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null);
    } catch { /* no diff */ }
  };

  const today = new Date().toISOString().slice(0, 10);
  const shown: ThreadsBody | null = pastSession
    ? { throughLine: pastSession.throughLine, threads: pastSession.threads.map((t) => ({ label: t.label, headline: t.headline, summary: t.summary, trend: t.trend, articleIds: t.articleIds ?? [], sources: t.sources, newsletterContext: t.newsletterContext, amc: t.amc })) }
    : threads;
  const unread = newsletters.length;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* ── Left: content ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700/80 rounded-lg p-1">
            <button
              onClick={() => setViewMode("threads")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all ${
                viewMode === "threads" ? "bg-slate-700 text-slate-100 shadow-sm" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <ThreadsViewIcon size={14} strokeWidth={2.25} className="leading-none" />
              Threads
              {threadsLoading && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
            </button>
            <button
              onClick={() => setViewMode("read")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all ${
                viewMode === "read" ? "bg-slate-700 text-slate-100 shadow-sm" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <FeedViewIcon size={14} strokeWidth={2.25} className="leading-none" />
              Read
              {unread > 0 && <span className="text-[9px] font-mono font-semibold opacity-80">{unread} nl</span>}
            </button>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            {viewMode === "threads" && threads && !pastSession && (
              <span className="text-[10px] text-slate-600 font-mono hidden sm:inline">
                {articles.length} articles · {newsletters.length} nl{threads.generatedAt ? ` · analysed ${new Date(threads.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
              </span>
            )}
            {refreshing && <span className="text-[10px] text-emerald-600 font-mono uppercase tracking-wider animate-pulse">Fetching…</span>}
            {lastUpdated && !refreshing && <span className="text-[10px] text-slate-500 font-mono">{formatUpdated(lastUpdated)}</span>}
            <button onClick={handleRefresh} disabled={refreshing} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-400 disabled:opacity-40 font-mono transition-colors">
              <span className={`text-base leading-none ${refreshing ? "animate-spin" : ""}`}>↻</span>
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Read view — always mounted; CSS hidden keeps the feed loading (and
            the articles Threads needs) while the landing view shows. */}
        <div className={viewMode !== "read" ? "hidden" : ""}>
          <NewsletterSection
            onSummariesLoaded={handleSummariesLoaded}
            refreshKey={refreshKey}
            onLoadingChange={handleLoadingChange}
            watchlist={effectiveWatch}
            previousSeen={previousSeenNewsletters}
            threads={threads?.threads ?? []}
          />
          <NewsFeed
            onArticlesLoaded={handleArticlesLoaded}
            refreshKey={refreshKey}
            onLoadingChange={handleLoadingChange}
            watchlist={effectiveWatch}
            previousSeen={previousSeenNews}
            threads={threads?.threads ?? []}
            onCuratedChange={(ids) => setCriticalIds(new Set(ids))}
          />
        </div>

        {viewMode === "threads" && (
          <div>
            {threadsLoading && !shown && (
              <div className="space-y-4">
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 animate-pulse">
                  <div className="h-2.5 bg-slate-800 rounded w-24 mb-4" />
                  <div className="space-y-2">
                    <div className="h-3.5 bg-slate-800 rounded w-full" />
                    <div className="h-3.5 bg-slate-800 rounded w-5/6" />
                    <div className="h-3.5 bg-slate-800 rounded w-4/5" />
                  </div>
                </div>
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
                <p className="text-center text-xs text-slate-600 font-mono uppercase tracking-wider animate-pulse">Analysing threads…</p>
              </div>
            )}

            {threadsError && !pastSession && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 text-sm mb-4">
                {threadsError}
                <button onClick={() => setThreadsError(null)} disabled={threadsLoading} className="ml-3 text-red-400 underline hover:text-red-300 text-xs disabled:opacity-40">Retry</button>
              </div>
            )}

            {articles.length === 0 && !threadsLoading && !pastSession && (
              <div className="text-center py-16 text-slate-600 text-sm font-mono uppercase tracking-wider">
                {refreshing ? "Loading the feed…" : "No articles loaded — open Read to see why"}
              </div>
            )}

            {shown && (
              <ThreadsView
                result={shown}
                articles={articles}
                watchlist={effectiveWatch}
                previous={pastSession ? pastPrevious : (threads?.previous ?? null)}
                occurrences={occurrences}
                boards={boards}
                today={today}
                pastDate={pastSession?.date ?? null}
                criticalIds={criticalIds}
                onAsk={onAsk}
                onSave={onSave}
                onFollow={onFollow}
                onOpenLabel={(l) => openLabel(l)}
                onDoor={onDoor}
                onRegenerate={() => void fetchThreads(articles, newsletters, true)}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Right rail: the Moving list + the assistant (threads view) ──── */}
      {viewMode === "threads" && (
        <div className="lg:w-[300px] flex-shrink-0 space-y-4">
          <MovingRail
            selectedDate={pastSession?.date ?? null}
            onOpenLabel={openLabel}
            onSelectSession={(s) => void selectSession(s)}
            onSearch={(q, days) => setDrawer({ label: null, query: q, days })}
          />
          <NewsAssistantCard threads={threads} articleCount={articles.length} newsletterCount={newsletters.length} />
        </div>
      )}

      {drawer && (
        <LabelDrawer
          label={drawer.label}
          query={drawer.query}
          days={drawer.days}
          onClose={() => setDrawer(null)}
          onOpenLabel={(l) => setDrawer({ label: l, query: null, days: drawer.days })}
        />
      )}
    </div>
  );
}
