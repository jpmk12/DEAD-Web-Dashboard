"use client";

import { useEffect, useState, useCallback } from "react";
import TabBar, { Tab } from "./TabBar";
import MobileNavDrawer from "./MobileNavDrawer";
import { BriefIcon, DigestIcon, CaptureIcon, PreferencesIcon, MenuIcon } from "@/lib/icons";
import NewsShell from "@/components/news/NewsShell";
import CalendarPanel from "@/components/calendar/CalendarPanel";
import CalendarRail from "@/components/calendar/CalendarRail";
import EmailTab from "@/components/email/EmailTab";
import MarketsTab from "@/components/markets/MarketsTab";
import WeatherTab from "@/components/weather/WeatherTab";
import OSINTTab from "@/components/osint/OSINTTab";
import DocumentsTab from "@/components/documents/DocumentsTab";
import GlanceTab from "@/components/glance/GlanceTab";
import PreferencesDrawer from "@/components/PreferencesDrawer";
import BriefingModal from "@/components/BriefingModal";
import QuickCaptureModal from "@/components/QuickCaptureModal";
import FloatingAssistant from "@/components/chat/FloatingAssistant";
import { CalendarEvent, GoogleTask, NewsItem, NewsletterSummary, TickerEntry } from "@/lib/types";
import { prefetchBriefing } from "@/lib/briefingPrefetch";
import { prefetchDigest } from "@/lib/digestPrefetch";

const VALID_TABS: Tab[] = ["glance", "news", "calendar", "email", "docs", "osint", "markets", "weather"];

export default function TabShell() {
  const [activeTab, setActiveTab] = useState<Tab>("glance");
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<GoogleTask[]>([]);
  const [tasksRefreshKey, setTasksRefreshKey] = useState(0);
  const [articles, setArticles] = useState<NewsItem[]>([]);
  const [newsletters, setNewsletters] = useState<NewsletterSummary[]>([]);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [briefingMode, setBriefingMode] = useState<"briefing" | "digest">("briefing");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [marketsWatchlist, setMarketsWatchlist] = useState<TickerEntry[]>([]);

  // "What changed since I last looked": frozen-at-mount snapshot of when the
  // user last viewed each surface. Drives dimming of items older than the
  // snapshot. Bumped on the server after dwell, but the snapshot here stays
  // fixed for the session so things don't dim mid-scroll.
  const [previousSeen, setPreviousSeen] = useState<Record<"email" | "news" | "newsletters" | "osint", number>>({
    email: 0, news: 0, newsletters: 0, osint: 0,
  });
  // Count of new high-priority OSINT signals since last visit — drives the
  // OSINT nav badge. Reported up by OSINTTab (which polls in the background
  // even while hidden).
  const [osintSignals, setOsintSignals] = useState(0);
  // Top OSINT signals, fed into the morning brief so it reflects monitored feeds.
  const [osintTop, setOsintTop] = useState<{ title: string; priority: string; reason: string; sources: number }[]>([]);

  useEffect(() => {
    fetch("/api/surface-state")
      .then((r) => r.json())
      .then((d: { lastSeen?: Record<"email" | "news" | "newsletters" | "osint", number> }) => {
        if (d.lastSeen) setPreviousSeen(d.lastSeen);
      })
      .catch(() => {});
  }, []);

  // Bump the server-side lastSeen after the user dwells on a tab for >5 s.
  // The news tab no longer co-bumps "newsletters" — NewsletterSection bumps
  // its own surface on the first expand of the session, so an unexpanded
  // newsletter section doesn't get falsely marked as seen.
  useEffect(() => {
    const surface: "email" | "news" | null =
      activeTab === "email" ? "email"
      : activeTab === "news" ? "news"
      : null;
    if (!surface) return;
    const t = setTimeout(() => {
      fetch("/api/surface-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surface }),
      }).catch(() => {});
    }, 5_000);
    return () => clearTimeout(t);
  }, [activeTab]);

  // Global ⌘K / Ctrl+K opens quick capture from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCaptureOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("tab");
    if (VALID_TABS.includes(param as Tab)) setActiveTab(param as Tab);
  }, []);

  const loadWatchlist = useCallback(() => {
    fetch("/api/user-prefs")
      .then((r) => r.json())
      .then(({ prefs }) => {
        setWatchlist(prefs?.watchlist ?? []);
        setMarketsWatchlist(prefs?.marketsWatchlist ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { loadWatchlist(); }, [loadWatchlist]);

  // Kick off the weekly digest fetch on mount — it only needs the user's
  // pref history (already on the server), not loaded articles. The result
  // sits in clientCache so the Digest modal opens instantly.
  //
  // Also re-fire on window focus and on the custom "dashboard-cache-cleared"
  // event the Preferences drawer dispatches after a save. Without these,
  // a failed first attempt (transient network blip) OR a cache clear from
  // a prefs save would leave the modal cold-fetching on first open.
  useEffect(() => {
    prefetchDigest();
    const reprime = () => prefetchDigest();
    // visibilitychange catches Chrome tab switches more reliably than focus.
    const onVisible = () => { if (!document.hidden) prefetchDigest(); };
    window.addEventListener("focus", reprime);
    window.addEventListener("dashboard-cache-cleared", reprime);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", reprime);
      window.removeEventListener("dashboard-cache-cleared", reprime);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Start brief generation in background once both articles and newsletters are loaded.
  // prefetchBriefing guards against duplicates internally (isFresh + inflight checks).
  // Also re-fires on the cache-cleared event so a prefs save re-primes the brief.
  useEffect(() => {
    if (articles.length === 0 || newsletters.length === 0) return;
    prefetchBriefing(articles, newsletters, calendarEvents, osintTop);
    const reprime = () => {
      if (articles.length > 0 && newsletters.length > 0) {
        prefetchBriefing(articles, newsletters, calendarEvents, osintTop);
      }
    };
    window.addEventListener("focus", reprime);
    window.addEventListener("dashboard-cache-cleared", reprime);
    return () => {
      window.removeEventListener("focus", reprime);
      window.removeEventListener("dashboard-cache-cleared", reprime);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articles.length, newsletters.length]);

  const openBriefing = () => { setBriefingMode("briefing"); setBriefingOpen(true); };
  const openDigest = () => { setBriefingMode("digest"); setBriefingOpen(true); };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      <header className="bg-slate-900/95 backdrop-blur-sm border-b border-slate-800 sticky top-0 z-30">
        {/* Green tactical accent line */}
        <div className="h-0.5 bg-gradient-to-r from-emerald-500 via-green-400 to-transparent" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          {/* Logo / Title */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0 w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <span className="text-emerald-400 text-xs">◆</span>
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold tracking-widest uppercase text-slate-100 leading-none">
                DEAD&apos;s Dashboard
              </h1>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Desktop actions; on phones these live in the nav drawer instead */}
            <div className="hidden lg:flex items-center gap-2">
            {/* Primary CTA: Morning Brief */}
            <button
              onClick={openBriefing}
              title="Generate morning brief from loaded news"
              className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md transition-all glow-green"
            >
              <BriefIcon size={15} strokeWidth={2.5} className="leading-none" />
              <span className="hidden sm:inline">Brief</span>
            </button>

            {/* Secondary: Weekly digest */}
            <button
              onClick={openDigest}
              title="Weekly reading digest"
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 text-slate-300 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md transition-all"
            >
              <DigestIcon size={15} strokeWidth={2.25} className="leading-none" />
              <span className="hidden sm:inline">Digest</span>
            </button>

            {/* Quick capture (⌘K / Ctrl+K) */}
            <button
              onClick={() => setCaptureOpen(true)}
              title="Quick capture (⌘K) — task, event, or note"
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-emerald-500/50 text-slate-300 hover:text-emerald-400 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md transition-all"
            >
              <CaptureIcon size={15} strokeWidth={2.5} className="leading-none" />
              <span className="hidden sm:inline">Capture</span>
            </button>

            {/* Preferences & account management */}
            <button
              onClick={() => setPrefsOpen(true)}
              title="Preferences & accounts"
              className="w-8 h-8 flex items-center justify-center bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 rounded-md transition-all"
            >
              <PreferencesIcon size={16} strokeWidth={2.25} />
            </button>
            </div>

            {/* Phone hamburger — opens the full nav + actions drawer */}
            <button
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
              className="lg:hidden w-9 h-9 flex items-center justify-center bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-md transition-all touch-manipulation"
            >
              <MenuIcon size={20} strokeWidth={2.25} />
            </button>
          </div>
        </div>

        {/* Desktop tab row; phones use the hamburger drawer instead */}
        <div className="hidden lg:block">
          <TabBar activeTab={activeTab} onTabChange={setActiveTab} badges={{ osint: osintSignals }} />
        </div>
      </header>

      <MobileNavDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        badges={{ osint: osintSignals }}
        onBrief={openBriefing}
        onDigest={openDigest}
        onCapture={() => setCaptureOpen(true)}
        onPreferences={() => setPrefsOpen(true)}
      />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 pb-safe">
        {/* All tabs stay mounted — CSS hidden keeps them alive for instant switching and parallel pre-fetch */}
        <div className={activeTab !== "glance" ? "hidden" : ""}>
          <GlanceTab
            active={activeTab === "glance"}
            articles={articles}
            newsletters={newsletters}
            calendarEvents={calendarEvents}
            osintTop={osintTop}
            osintSignals={osintSignals}
            previousSeen={previousSeen}
            watchlist={watchlist}
            marketsWatchlist={marketsWatchlist}
            onNavigate={setActiveTab}
            onOpenBrief={openBriefing}
            onOpenDigest={openDigest}
          />
        </div>

        <div className={activeTab !== "news" ? "hidden" : ""}>
          <NewsShell
            onArticlesChange={setArticles}
            onNewslettersChange={setNewsletters}
            watchlist={watchlist}
            previousSeenNews={previousSeen.news}
            previousSeenNewsletters={previousSeen.newsletters}
          />
        </div>

        <div className={activeTab !== "calendar" ? "hidden" : ""}>
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-1 min-w-0">
              <CalendarPanel onEventsLoaded={setCalendarEvents} />
            </div>
            <CalendarRail
              tasksRefreshKey={tasksRefreshKey}
              onTasksLoaded={setTasks}
            />
          </div>
        </div>

        <div className={activeTab !== "email" ? "hidden" : ""}>
          <EmailTab previousSeen={previousSeen.email} />
        </div>

        <div className={activeTab !== "docs" ? "hidden" : ""}>
          <DocumentsTab />
        </div>

        <div className={activeTab !== "osint" ? "hidden" : ""}>
          <OSINTTab
            active={activeTab === "osint"}
            previousSeen={previousSeen.osint}
            onSignalCount={setOsintSignals}
            onTopSignals={setOsintTop}
          />
        </div>

        <div className={activeTab !== "markets" ? "hidden" : ""}>
          <MarketsTab articles={articles} />
        </div>

        <div className={activeTab !== "weather" ? "hidden" : ""}>
          <WeatherTab />
        </div>
      </main>

      <PreferencesDrawer
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        onSaved={loadWatchlist}
      />

      <BriefingModal
        open={briefingOpen}
        mode={briefingMode}
        onClose={() => setBriefingOpen(false)}
        articles={articles}
        newsletters={newsletters}
        calendarEvents={calendarEvents}
      />

      <QuickCaptureModal
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onCaptured={(kind) => {
          // Refresh the tasks rail when a new task lands; calendar refresh
          // happens on tab switch.
          if (kind === "task") setTasksRefreshKey((k) => k + 1);
        }}
      />

      {/* Global AI assistant — reachable from every tab. */}
      <FloatingAssistant
        calendarEvents={calendarEvents}
        tasks={tasks}
        articles={articles}
        newsletters={newsletters}
        onTaskAdded={() => setTasksRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
