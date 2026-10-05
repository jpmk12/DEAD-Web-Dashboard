"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import TabBar, { Tab } from "./TabBar";
import MobileNavDrawer from "./MobileNavDrawer";
import SessionExpiredBanner from "@/components/SessionExpiredBanner";
import { BriefIcon, DigestIcon, CaptureIcon, PreferencesIcon, MenuIcon, SearchIcon } from "@/lib/icons";
import CommandPalette from "@/components/CommandPalette";
import NewsShell from "@/components/news/NewsShell";
import CalendarPanel from "@/components/calendar/CalendarPanel";
import CalendarRail from "@/components/calendar/CalendarRail";
import EmailTab from "@/components/email/EmailTab";
import MarketsTab from "@/components/markets/MarketsTab";
import WeatherTab from "@/components/weather/WeatherTab";
import OSINTTab from "@/components/osint/OSINTTab";
import DocumentsTab from "@/components/documents/DocumentsTab";
import GlanceTab from "@/components/glance/GlanceTab";
import FamilyTab from "@/components/family/FamilyTab";
import PreferencesDrawer from "@/components/PreferencesDrawer";
import BriefingModal from "@/components/BriefingModal";
import QuickCaptureModal from "@/components/QuickCaptureModal";
import FloatingAssistant from "@/components/chat/FloatingAssistant";
import { CalendarEvent, GoogleTask, NewsItem, NewsletterSummary } from "@/lib/types";
import { prefetchBriefing } from "@/lib/briefingPrefetch";
import { prefetchDigest } from "@/lib/digestPrefetch";

const VALID_TABS: Tab[] = ["glance", "news", "calendar", "email", "family", "docs", "osint", "markets", "weather"];

export default function TabShell() {
  const [activeTab, setActiveTab] = useState<Tab>("glance");
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  // Whether the calendar has reported at least once (even with []). The morning
  // brief must wait for this before generating, or it races the calendar fetch
  // and bakes an empty agenda into the day's cached brief (the "schedule
  // disappeared" bug). A timeout flips it true so a slow/failed calendar never
  // blocks the brief outright.
  const [calendarReady, setCalendarReady] = useState(false);
  const handleEventsLoaded = useCallback((evts: CalendarEvent[]) => {
    setCalendarEvents(evts);
    setCalendarReady(true);
  }, []);
  const [tasks, setTasks] = useState<GoogleTask[]>([]);
  const [tasksRefreshKey, setTasksRefreshKey] = useState(0);
  const [articles, setArticles] = useState<NewsItem[]>([]);
  const [newsletters, setNewsletters] = useState<NewsletterSummary[]>([]);
  // Same discipline as calendarReady, for the other two brief inputs: the
  // brief is day-cached, so the FIRST generation must carry newsletters and
  // OSINT signals or the day's brief is the thin one. Each flips true when
  // its source reports once (even with []), or on a grace timer so a dead
  // Gmail / feed never blocks the brief outright.
  const [newslettersReady, setNewslettersReady] = useState(false);
  const [osintReady, setOsintReady] = useState(false);
  const handleNewslettersChange = useCallback((n: NewsletterSummary[]) => {
    setNewsletters(n);
    setNewslettersReady(true);
  }, []);
  const handleOsintFeedLoaded = useCallback(() => setOsintReady(true), []);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [briefingMode, setBriefingMode] = useState<"briefing" | "digest">("briefing");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>([]);

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
  // High-priority unread email count, reported up by EmailTab — drives the
  // Email nav badge (decays naturally as mail is marked read).
  const [emailHigh, setEmailHigh] = useState(0);
  // Local watermark for the News badge. previousSeen stays frozen for the
  // session (it drives dimming and must not shift mid-scroll), so the badge
  // keeps its own watermark that advances when the user dwells on News.
  const [newsSeenLocal, setNewsSeenLocal] = useState(0);
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
      if (surface === "news") setNewsSeenLocal(Date.now());
    }, 5_000);
    return () => clearTimeout(t);
  }, [activeTab]);

  // "New since you last looked" story count for the News tab badge.
  const newsNew = useMemo(() => {
    const seen = Math.max(previousSeen.news, newsSeenLocal);
    if (!seen) return 0;
    return articles.filter((a) => {
      const t = Date.parse(a.pubDate || "");
      return Number.isFinite(t) && t > seen;
    }).length;
  }, [articles, previousSeen.news, newsSeenLocal]);

  // Global ⌘K / Ctrl+K opens the command palette from anywhere. Quick
  // capture (which used to own ⌘K) is an entry inside it.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Palette → shell actions. Same event pattern as `app:navigate`: the
  // palette knows names, the shell owns the modal state.
  useEffect(() => {
    const onCapture = () => setCaptureOpen(true);
    const onBrief = () => { setBriefingMode("briefing"); setBriefingOpen(true); };
    const onDigest = () => { setBriefingMode("digest"); setBriefingOpen(true); };
    const onPrefs = (e: Event) => {
      setPrefsOpen(true);
      const group = (e as CustomEvent<string>).detail;
      if (typeof group === "string") setTimeout(() => window.dispatchEvent(new CustomEvent("prefs:focus-group", { detail: group })), 150);
    };
    window.addEventListener("capture:open", onCapture);
    window.addEventListener("brief:open", onBrief);
    window.addEventListener("digest:open", onDigest);
    window.addEventListener("prefs:open", onPrefs);
    return () => {
      window.removeEventListener("capture:open", onCapture);
      window.removeEventListener("brief:open", onBrief);
      window.removeEventListener("digest:open", onDigest);
      window.removeEventListener("prefs:open", onPrefs);
    };
  }, []);

  // Cross-tab navigation for components too deep to hold `onNavigate`.
  // Glance gets the prop because it is a direct child; a card nested inside
  // OSINT → WatchPane would need it drilled three levels for one link, the
  // same prop-drilling the docs properties panel avoided with an event.
  // Validated against VALID_TABS so a stale dispatcher can't blank the shell.
  useEffect(() => {
    const onNav = (e: Event) => {
      const t = (e as CustomEvent<string>).detail;
      if (typeof t === "string" && (VALID_TABS as string[]).includes(t)) setActiveTab(t as Tab);
    };
    window.addEventListener("app:navigate", onNav);
    return () => window.removeEventListener("app:navigate", onNav);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const param = params.get("tab");
    if (VALID_TABS.includes(param as Tab)) setActiveTab(param as Tab);
    // `?prefs=<section>` opens Preferences on that section — the URL-
    // addressable settings a recommendation card or a pasted link can use.
    const prefs = params.get("prefs");
    if (prefs) {
      setPrefsOpen(true);
      setTimeout(() => window.dispatchEvent(new CustomEvent("prefs:focus-group", { detail: prefs })), 150);
    }
  }, []);

  // Mirror the active tab onto <body> so components with no path to this
  // state (the assistant's ChatPanel) can say where the user is looking.
  useEffect(() => {
    document.body.dataset.tab = activeTab;
  }, [activeTab]);

  const loadWatchlist = useCallback(() => {
    fetch("/api/user-prefs")
      .then((r) => r.json())
      .then(({ prefs }) => {
        setWatchlist(prefs?.watchlist ?? []);
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

  // Don't let a slow/failed calendar block the brief forever — after a grace
  // period, proceed without it (better an agenda-less brief than none).
  useEffect(() => {
    const t = setTimeout(() => setCalendarReady(true), 12_000);
    return () => clearTimeout(t);
  }, []);
  // Newsletters ride Gmail and the OSINT feed fans out to every configured
  // source, so their grace is longer than the calendar's.
  useEffect(() => {
    const t = setTimeout(() => { setNewslettersReady(true); setOsintReady(true); }, 25_000);
    return () => clearTimeout(t);
  }, []);

  // Start brief generation in background once articles, the calendar,
  // newsletters AND the OSINT feed have each reported (or timed out).
  // Gating on readiness flags (not just counts) is what stops the brief from
  // racing a fetch and caching a thin brief — no schedule, no newsletter
  // bullets, no OSINT signals — for the whole day. A newsletter-less or
  // feed-less morning still generates: each flag flips on a grace timer.
  // The 1.5-s settle lets the child effects that report osintTop/newsletters
  // land before the POST (child effects fire before this one in the same
  // commit, so the closure here would otherwise see the previous values).
  // prefetchBriefing guards against duplicates internally (isFresh + inflight)
  // and allows one bounded upgrade if an input arrives after the first POST.
  useEffect(() => {
    if (articles.length === 0 || !calendarReady || !newslettersReady || !osintReady) return;
    const fire = () => prefetchBriefing(articles, newsletters, calendarEvents, osintTop);
    const settle = setTimeout(fire, 1_500);
    const reprime = () => {
      if (articles.length > 0) fire();
    };
    window.addEventListener("focus", reprime);
    window.addEventListener("dashboard-cache-cleared", reprime);
    return () => {
      clearTimeout(settle);
      window.removeEventListener("focus", reprime);
      window.removeEventListener("dashboard-cache-cleared", reprime);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articles.length, newsletters.length, osintTop.length, calendarReady, newslettersReady, osintReady]);

  const openBriefing = () => { setBriefingMode("briefing"); setBriefingOpen(true); };
  const openDigest = () => { setBriefingMode("digest"); setBriefingOpen(true); };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      <SessionExpiredBanner />
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

            {/* Command palette (⌘K / Ctrl+K) */}
            <button
              onClick={() => setPaletteOpen(true)}
              title="Go anywhere (⌘K) — tabs, bases, boards, countries, docs, settings"
              aria-label="Open command palette"
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 text-slate-300 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md transition-all"
            >
              <SearchIcon size={15} strokeWidth={2.5} className="leading-none" />
              <kbd className="hidden xl:inline font-mono text-[10px] text-slate-500 normal-case tracking-normal">⌘K</kbd>
            </button>

            {/* Quick capture */}
            <button
              onClick={() => setCaptureOpen(true)}
              title="Quick capture — task, event, or note"
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
          <TabBar activeTab={activeTab} onTabChange={setActiveTab} badges={{ osint: osintSignals, email: emailHigh, news: newsNew }} />
        </div>
      </header>

      <MobileNavDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        badges={{ osint: osintSignals, email: emailHigh, news: newsNew }}
        onBrief={openBriefing}
        onDigest={openDigest}
        onCapture={() => setCaptureOpen(true)}
        onPreferences={() => setPrefsOpen(true)}
        onSearch={() => setPaletteOpen(true)}
      />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

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
            onNavigate={setActiveTab}
            onOpenBrief={openBriefing}
            onOpenDigest={openDigest}
            onOpenCapture={() => setCaptureOpen(true)}
          />
        </div>

        <div className={activeTab !== "news" ? "hidden" : ""}>
          <NewsShell
            onArticlesChange={setArticles}
            onNewslettersChange={handleNewslettersChange}
            watchlist={watchlist}
            previousSeenNews={previousSeen.news}
            previousSeenNewsletters={previousSeen.newsletters}
          />
        </div>

        <div className={activeTab !== "calendar" ? "hidden" : ""}>
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-1 min-w-0">
              <CalendarPanel onEventsLoaded={handleEventsLoaded} />
            </div>
            <CalendarRail
              tasksRefreshKey={tasksRefreshKey}
              onTasksLoaded={setTasks}
            />
          </div>
        </div>

        <div className={activeTab !== "email" ? "hidden" : ""}>
          <EmailTab previousSeen={previousSeen.email} onPriorityCount={setEmailHigh} />
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
            onFeedLoaded={handleOsintFeedLoaded}
          />
        </div>

        {/* Family mounts only when opened: its digest reads Gmail and calls the
            model, so an always-mounted pane would spend on every app load. */}
        {activeTab === "family" && (
          <div>
            <FamilyTab active={activeTab === "family"} />
          </div>
        )}

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
        osintTop={osintTop}
        tasks={tasks}
        previousSeenNews={previousSeen.news}
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
