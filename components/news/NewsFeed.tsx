"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { NewsItem, NewsThread, SavedItem } from "@/lib/types";
import { laneFor, mentionsTerm, threadForArticle } from "@/lib/newsLanes";
import { clientCache, CACHE_TTL } from "@/lib/clientCache";
import { toast } from "@/lib/feedback";
import { sourceChips, sourcesOnLabel, type SourceStat } from "@/lib/newsSourceToggle";
import NewsCard from "./NewsCard";
import TrendStrip from "./TrendStrip";

const CACHE_KEY = "news:items";
// Cached separately so the TDY strip survives the warm-cache early-return below
// (which skips the network fetch and would otherwise leave tripNews empty).
const TRIP_CACHE_KEY = "news:tripNews";
// Per-source counts from the same response, for the Sources control — same
// reason: a warm load never hits the network.
const STATS_CACHE_KEY = "news:sourceStats";
// Fold state of the Sources control, per browser.
const LS_SOURCES_OPEN = "news.sourcesOpen";

// Relative time that's safe against missing/malformed feed dates — parseISO on a
// bad string yields an Invalid Date and formatDistanceToNow then throws
// "RangeError: Invalid time value", which crashed the TDY strip render.
function relTime(iso?: string): string {
  if (!iso) return "";
  const d = parseISO(iso);
  return Number.isNaN(d.getTime()) ? "" : formatDistanceToNow(d, { addSuffix: true });
}

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
  { id: "cyber",     label: "Cyber" },
  { id: "local",     label: "Local" },
  { id: "saved",     label: "★ Saved" },
] as const;

type TabId = typeof TABS[number]["id"];

function SkeletonGrid() {
  return (
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
  );
}

interface NewsFeedProps {
  onArticlesLoaded?: (articles: NewsItem[]) => void;
  refreshKey?: number;
  onLoadingChange?: (loading: boolean) => void;
  watchlist?: string[];
  previousSeen?: number;
  /** Today's threads, so each card can name the thread it belongs to. */
  threads?: NewsThread[];
  /** The curated "critical" ids, reported up (the Threads view lanes its linked articles the same way). */
  onCuratedChange?: (ids: string[]) => void;
}

export default function NewsFeed({
  onArticlesLoaded,
  refreshKey = 0,
  onLoadingChange,
  watchlist = [],
  previousSeen = 0,
  threads = [],
  onCuratedChange,
}: NewsFeedProps) {
  const { status } = useSession();
  const [items, setItems] = useState<NewsItem[]>([]);
  // Location-relevant news for an active TDY trip — shown as a distinct strip so
  // it travels with you without crowding or replacing the home feed.
  const [tripNews, setTripNews] = useState<{ label: string; items: NewsItem[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({});
  // Category chips are a SECONDARY filter over the lanes (REVIEW-2026-10
  // N9); "overview" = all lanes, the default. Saved stays its own view.
  const [tab, setTab] = useState<TabId>("overview");
  // A trending chip picked on the strip filters the lanes (N7).
  const [pickedTerm, setPickedTerm] = useState<string | null>(null);
  const [showRest, setShowRest] = useState(false);
  // Persisted saved items are the source of truth for the Saved tab — they
  // outlive the live RSS feed, so a saved article that has rolled off the feed
  // still shows (the count and the list stay in sync). savedIds is derived for
  // the per-card star state.
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const savedIds = useMemo(() => new Set(savedItems.map((s) => s.id)), [savedItems]);
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const [curated, setCurated] = useState<Curated | null>(null);
  const [curating, setCurating] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);
  // Bumped on a prefs save (clientCache.clear + dashboard-cache-cleared) so the
  // Overview re-curates once against the new role/topics/watchlist even while
  // the tab is open. The server's ctx_hash keying makes the regenerate cheap
  // and one-shot — unchanged prefs still hit the daily cache.
  const [prefsVersion, setPrefsVersion] = useState(0);
  // A cache clear also RE-FETCHES the feed (the fetch effect below keys on
  // this): the Preferences drawer wipes clientCache on save, and before this
  // the feed sat on its in-memory items until the next manual refresh — a
  // source toggled off on the tab (or in the drawer) kept showing.
  const [reloadTick, setReloadTick] = useState(0);
  const reloadSeen = useRef(0);
  // Sources edited ON THE TAB (REVIEW-2026-10 §12 item 6): per-source counts
  // from the feed response and the user's own disabled list (a PERSONAL pref,
  // one GET of /api/user-prefs). The toggle is optimistic through the
  // append-only door; a failed write reverts.
  const [sourceStats, setSourceStats] = useState<SourceStat[]>([]);
  const [disabledSources, setDisabledSources] = useState<string[]>([]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const togglingRef = useRef<Set<string>>(new Set());
  // refreshKey of the last COMPLETED curation. "Manual" = the current refreshKey
  // hasn't been curated yet — which stays true across the items-churn re-run a
  // manual refresh triggers (the news refetch swaps the items array), so the
  // forced ?refresh=1 isn't lost to a race. Updated only on completion.
  const lastCuratedKey = useRef(0);

  const loadDisabledSources = useCallback(() => {
    fetch("/api/user-prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = d?.prefs?.disabledNewsSources;
        if (Array.isArray(list)) setDisabledSources(list.filter((x: unknown): x is string => typeof x === "string"));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onCleared = () => {
      setPrefsVersion((v) => v + 1);
      // Re-fetch WITHOUT dropping the items already on screen (no skeleton):
      // the fetch effect treats a new tick as "fetch even if fresh".
      setReloadTick((t) => t + 1);
      // The drawer may have changed the disabled list too.
      loadDisabledSources();
    };
    window.addEventListener("dashboard-cache-cleared", onCleared);
    return () => window.removeEventListener("dashboard-cache-cleared", onCleared);
  }, [loadDisabledSources]);

  useEffect(() => {
    if (status !== "authenticated") return;
    loadDisabledSources();
    try { setSourcesOpen(localStorage.getItem(LS_SOURCES_OPEN) === "1"); } catch { /* ignore */ }
  }, [status, loadDisabledSources]);

  useEffect(() => {
    if (status !== "authenticated") return;

    const stale = clientCache.peek<NewsItem[]>(CACHE_KEY);
    const isFresh = clientCache.isFresh(CACHE_KEY);
    const isManualRefresh = refreshKey > 0;

    if (stale) { setItems(stale); onArticlesLoaded?.(stale); }
    const staleTrip = clientCache.peek<{ label: string; items: NewsItem[] }>(TRIP_CACHE_KEY);
    if (staleTrip) setTripNews(staleTrip);
    const staleStats = clientCache.peek<SourceStat[]>(STATS_CACHE_KEY);
    if (staleStats) setSourceStats(staleStats);
    // A cache-cleared tick forces the network even on a fresh cache, but keeps
    // the stale items on screen (no spinner) — a source toggle must not flash
    // the skeleton over the list it just filtered.
    const forced = reloadTick !== reloadSeen.current;
    reloadSeen.current = reloadTick;
    if (isFresh && !isManualRefresh && !forced) return;

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
        setTripNews(data.tripNews ?? null);
        clientCache.set(TRIP_CACHE_KEY, data.tripNews ?? null, CACHE_TTL.NEWS);
        setSourceErrors(data.sourceErrors ?? {});
        const stats: SourceStat[] = Array.isArray(data.sourceStats)
          ? data.sourceStats.filter((s: unknown): s is SourceStat => !!s && typeof (s as SourceStat).name === "string").map((s: SourceStat) => ({ name: s.name, count: Number(s.count) || 0 }))
          : [];
        setSourceStats(stats);
        clientCache.set(STATS_CACHE_KEY, stats, CACHE_TTL.NEWS);
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
  }, [status, refreshKey, reloadTick]);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/saved")
      .then((r) => r.json())
      .then((data) => setSavedItems(Array.isArray(data.items) ? data.items : []))
      .catch(() => {});
  }, [status]);

  // Curate the Overview lazily — only when the user is on that tab and we have
  // articles. Curation runs once per day (cached server-side and frozen for the
  // day to keep cost down and the list stable). A manual refresh (refreshKey)
  // forces a regenerate with ?refresh=1; otherwise the session-level cache keeps
  // tab switches and background refreshes from re-POSTing.
  useEffect(() => { onCuratedChange?.((curated?.critical ?? []).map((c) => c.id)); }, [curated, onCuratedChange]);

  useEffect(() => {
    if (status !== "authenticated" || items.length === 0) return;

    // "Manual" = this refreshKey hasn't been curated yet (the Refresh button
    // bumped the monotonic counter). It stays true until a curation actually
    // completes, so the items-churn re-run a refresh causes doesn't downgrade
    // the forced ?refresh=1 into a cache-hitting non-forced call.
    const manual = refreshKey !== lastCuratedKey.current;
    // A prefs save (prefsVersion bump) clears clientCache, so get() returns
    // null and we re-POST; the server then re-curates on the ctx_hash miss.
    const cached = manual ? null : clientCache.get<Curated>(CURATED_KEY);
    if (cached) { setCurated(cached); lastCuratedKey.current = refreshKey; setCurating(false); return; }

    setCurating(true);
    const controller = new AbortController();
    fetch(manual ? "/api/news/curated?refresh=1" : "/api/news/curated", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates: items.slice(0, CANDIDATE_LIMIT) }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: Partial<Curated> & { transient?: boolean }) => {
        // Ignore error payloads ({error}) — don't render or cache a non-result,
        // which would otherwise freeze an empty Overview for 12h with no retry.
        if (!Array.isArray(data.critical) || !Array.isArray(data.discover)) return;
        const curatedData: Curated = {
          critical: data.critical,
          discover: data.discover,
          mode: data.mode === "ai" ? "ai" : "deterministic",
        };
        setCurated(curatedData);
        lastCuratedKey.current = refreshKey; // this refresh is satisfied
        // Don't persist a transient result (thin feed / rate-limit / AI error) —
        // let it self-heal on the next view. The server enforces once-per-day;
        // this client TTL just stops intra-session re-POSTs.
        if (!data.transient) clientCache.set(CURATED_KEY, curatedData, 12 * 60 * 60 * 1000);
      })
      .catch(() => {})
      .finally(() => setCurating(false));
    return () => controller.abort();
  }, [status, items, refreshKey, prefsVersion]);

  // Callbacks must be declared before any early returns (React rules of hooks)
  const handleFeedback = useCallback((title: string, source: string, action: "useful" | "not_useful" | "opened") => {
    fetch("/api/article-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, source, action }),
    }).catch(() => {});
  }, []);

  const handleSave = useCallback((item: NewsItem) => {
    const saved: SavedItem = {
      id: item.id, type: "article", title: item.title,
      content: item.summary ?? "", source: item.source,
      link: item.link, savedAt: new Date().toISOString(),
    };
    setSavedItems((prev) => (prev.some((s) => s.id === item.id) ? prev : [saved, ...prev]));
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
    setSavedItems((prev) => prev.filter((s) => s.id !== id));
    fetch(`/api/saved?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  }, []);

  // One tap toggles a source: optimistic, ONE POST through the append-only
  // door (op add = stop reading, op remove = read again — the pref is the
  // DISABLED list), the server's `values` reconcile, then the feed re-fetches
  // through the cache-cleared event so the skipped source leaves (or returns).
  const toggleSource = useCallback(async (name: string) => {
    if (!name || togglingRef.current.has(name)) return;
    togglingRef.current.add(name);
    const wasDisabled = disabledSources.includes(name);
    const op = wasDisabled ? "remove" : "add";
    const prev = disabledSources;
    setDisabledSources(wasDisabled ? prev.filter((n) => n !== name) : [...prev, name]);
    try {
      const res = await fetch("/api/user-prefs/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "disabledNewsSources", value: name, op }),
      });
      const d = await res.json().catch(() => ({})) as { error?: string; values?: unknown };
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      if (Array.isArray(d.values)) setDisabledSources(d.values.filter((x): x is string => typeof x === "string"));
      toast.ok(wasDisabled ? `Reading ${name} again` : `Stopped reading ${name}`, wasDisabled ? "Its articles return on the next fetch." : "Skipped before fetch — it leaves the threads and the brief too.");
      window.dispatchEvent(new Event("dashboard-cache-cleared"));
    } catch (e) {
      setDisabledSources(prev);
      toast.error(`Could not ${wasDisabled ? "re-enable" : "mute"} ${name}`, e);
    } finally {
      togglingRef.current.delete(name);
    }
  }, [disabledSources]);

  const toggleSourcesOpen = () => {
    setSourcesOpen((v) => {
      const next = !v;
      try { localStorage.setItem(LS_SOURCES_OPEN, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  const disabledSet = useMemo(() => new Set(disabledSources), [disabledSources]);
  const chips = useMemo(() => sourceChips(sourceStats, disabledSources), [sourceStats, disabledSources]);

  const countByCategory = useMemo(() =>
    items.reduce<Record<string, number>>((acc, item) => {
      acc[item.category] = (acc[item.category] ?? 0) + 1;
      return acc;
    }, {}),
  [items]);

  // Render saved articles from the persisted store (not the live feed) so ones
  // that have aged out of the feed still appear. savedAt drives the card's
  // timestamp; category "saved" falls through to NewsCard's default style.
  const savedAsItems = useMemo<NewsItem[]>(() =>
    savedItems.map((s) => ({
      id: s.id, title: s.title, source: s.source, category: "saved",
      pubDate: s.savedAt, summary: s.content, link: s.link ?? "",
    })),
  [savedItems]);

  // The curated set is frozen server-side; its ids decide the "now" lane.
  const criticalItems = curated?.critical ?? [];
  const criticalIds = useMemo(() => new Set(criticalItems.map((c) => c.id)), [criticalItems]);
  // Show a skeleton while the first curation of the day is in flight.
  const overviewLoading = curating && criticalItems.length === 0;

  // The lanes (lib/newsLanes, pure): depth by source/length, now by curation,
  // the rest folded. Category chip and trending term narrow all three.
  const lanes = useMemo(() => {
    // A muted source leaves the lanes AT ONCE (the optimistic half of the
    // toggle) — the re-fetch then makes it real. The frozen curated set is
    // filtered the same way, or a muted outlet's curated piece would linger.
    const base = tab === "saved" ? [] : items.filter((i) => !disabledSet.has(i.source) && (tab === "overview" || tab === "all" || i.category === tab) && (!pickedTerm || mentionsTerm(i, pickedTerm)));
    const depth: NewsItem[] = [], now: NewsItem[] = [], rest: NewsItem[] = [];
    // Curated-critical items that rolled off the live feed still belong in "now".
    const seen = new Set<string>();
    for (const it of base) { seen.add(it.id); const l = laneFor(it, criticalIds); (l === "depth" ? depth : l === "now" ? now : rest).push(it); }
    if (tab === "overview" || tab === "all") for (const c of criticalItems) if (!seen.has(c.id) && !disabledSet.has(c.source) && (!pickedTerm || mentionsTerm(c, pickedTerm))) (laneFor(c, criticalIds) === "depth" ? depth : now).push(c);
    return { depth, now, rest };
  }, [items, tab, pickedTerm, criticalIds, criticalItems, disabledSet]);
  const visible = tab === "saved" ? savedAsItems : [];

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
        <a
          href="/login"
          className="flex items-center gap-2 bg-slate-800 border border-slate-700 text-slate-200 px-5 py-2.5 rounded-lg font-medium hover:border-emerald-700 hover:text-emerald-400 transition-all text-sm"
        >
          Sign in with Google
        </a>
      </div>
    );
  }

  const getCount = (id: TabId) => {
    if (id === "all" || id === "overview") return items.length;
    if (id === "saved") return savedIds.size;
    return countByCategory[id] ?? 0;
  };

  const failedCount = Object.keys(sourceErrors).length;

  const renderCard = (item: NewsItem, showThesis = false) => (
    <NewsCard
      key={item.id}
      item={item}
      onFeedback={handleFeedback}
      isSaved={savedIds.has(item.id)}
      onSave={handleSave}
      onUnsave={handleUnsave}
      watchlist={watchlist}
      previousSeen={previousSeen}
      showThesis={showThesis}
      threadLabel={threadForArticle(item.id, threads)}
      onMuteSource={toggleSource}
    />
  );

  const laneHead = (k: "depth" | "now", n: number) => (
    <div className="flex items-center gap-2 mb-3">
      <span className={`text-[11px] font-bold uppercase tracking-widest ${k === "depth" ? "text-violet-300" : "text-amber-300"}`}>{k === "depth" ? "◆ Strategic depth" : "⚑ Operational now"}</span>
      <div className="flex-1 h-px bg-slate-800" />
      <span className="text-[9.5px] font-mono text-slate-600">{k === "depth" ? `long-form · ${n}` : `${curated?.mode === "ai" ? "AI-curated" : "by your interests"} · ${n}`}</span>
    </div>
  );

  return (
    <div>
      {/* Week-over-week movers — sorted and grouped; a chip filters the lanes. */}
      <TrendStrip picked={pickedTerm} onPick={setPickedTerm} />

      {/* TDY strip — local coverage for where you are now, separate from the home
          feed so it never displaces home news. */}
      {tripNews && tripNews.items.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-3">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-amber-500/15 text-amber-300 border-amber-500/40">
              ✈ TDY
            </span>
            <span className="text-xs font-bold uppercase tracking-widest text-slate-300">
              While you&apos;re at {tripNews.label}
            </span>
            <div className="flex-1 h-px bg-amber-500/15" />
            <span className="text-[9px] font-mono text-slate-600 uppercase tracking-wider">local coverage</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5">
            {tripNews.items.map((it) => (
              <a
                key={it.id}
                href={it.link}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-baseline gap-2 py-1 min-w-0"
                title={it.title}
              >
                <span className="text-amber-500/60 text-[10px] leading-5 flex-shrink-0">›</span>
                <span className="min-w-0">
                  <span className="text-[12px] text-slate-300 group-hover:text-amber-300 transition-colors line-clamp-2 leading-snug">{it.title}</span>
                  <span className="block text-[9px] font-mono text-slate-600 truncate">
                    {(() => { const t = relTime(it.pubDate); return t ? `${it.source} · ${t}` : it.source; })()}
                  </span>
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Category chips — a SECONDARY filter over the lanes (N9). */}
      <div className="flex items-center gap-1.5 mb-5 flex-wrap">
        {TABS.filter((t) => t.id !== "all").map(({ id, label }) => {
          const count = getCount(id);
          const isActive = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-all whitespace-nowrap ${
                isActive ? "border-sky-500/50 bg-sky-500/15 text-sky-200" : "border-slate-700 text-slate-400 hover:text-slate-200"
              }`}
            >
              {id === "overview" ? "All" : label}
              {count > 0 && <span className="text-[9px] font-mono opacity-70">{count}</span>}
            </button>
          );
        })}
        {/* Sources — edited HERE, not in Preferences (REVIEW-2026-10 §12 item 6).
            The handle says how many are on; the fold lists one chip per source
            the feed knows (muted ones stay listed so they can come back). */}
        {chips.length > 0 && (
          <button
            type="button"
            onClick={toggleSourcesOpen}
            aria-expanded={sourcesOpen}
            aria-controls="news-sources-fold"
            title="Choose which feeds the News tab reads"
            className={`ml-auto flex-shrink-0 inline-flex items-center gap-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider px-2 py-1 border transition-all ${
              sourcesOpen ? "border-sky-500/50 bg-sky-500/15 text-sky-200" : "border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
          >
            Sources <span className="font-mono normal-case tracking-normal opacity-80">{sourcesOnLabel(chips)}</span> <span>{sourcesOpen ? "▴" : "▾"}</span>
          </button>
        )}
      </div>

      {sourcesOpen && chips.length > 0 && (
        <div id="news-sources-fold" className="-mt-2 mb-5 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <div className="flex items-center gap-2 mb-2 text-[10px] text-slate-600">
            <span>Tap a source to stop or resume reading it — a muted feed is skipped before fetch, so it leaves the threads and the brief too. Yours alone; the team list is unchanged.</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {chips.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => void toggleSource(c.name)}
                aria-pressed={c.enabled}
                title={c.enabled ? `Stop reading ${c.name}` : `Read ${c.name} again`}
                className={`inline-flex items-center gap-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider px-2 py-1 border transition-all ${
                  c.enabled
                    ? "border-sky-500/50 bg-sky-500/15 text-sky-200"
                    : "border-slate-700 text-slate-500 line-through decoration-slate-600 opacity-60 hover:opacity-100 hover:text-slate-200"
                }`}
              >
                {c.name}
                <span className="text-[9px] font-mono opacity-70 no-underline">{c.enabled ? c.count : "off"}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && <SkeletonGrid />}

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
            <span className="text-amber-600">{errorsExpanded ? "▴" : "▾"}</span>
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

      {/* Lanes: Strategic depth · Operational now · everything else folded
          (REVIEW-2026-10 N9). The category chips above narrow all three. */}
      {!loading && !error && tab === "saved" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((it) => renderCard(it, true))}
          {visible.length === 0 && (
            <div className="col-span-full text-center py-12 text-slate-600 text-sm font-mono uppercase tracking-wider">No saved articles yet — star articles to save them</div>
          )}
        </div>
      )}

      {!loading && !error && tab !== "saved" && (
        <div>
          {overviewLoading && lanes.now.length === 0 && <SkeletonGrid />}
          {pickedTerm && (
            <p className="mb-3 text-[11px] text-slate-500">Filtered to <span className="text-slate-200 font-mono">{pickedTerm}</span> — {lanes.depth.length + lanes.now.length + lanes.rest.length} article{lanes.depth.length + lanes.now.length + lanes.rest.length === 1 ? "" : "s"}.</p>
          )}
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="min-w-0">
              {laneHead("depth", lanes.depth.length)}
              {lanes.depth.length === 0
                ? <p className="text-xs text-slate-600 py-4">No long-form analysis in this slice.</p>
                : <div className="space-y-3">{lanes.depth.slice(0, 12).map((it) => renderCard(it, true))}</div>}
            </div>
            <div className="min-w-0">
              {laneHead("now", lanes.now.length)}
              {lanes.now.length === 0
                ? <p className="text-xs text-slate-600 py-4">{overviewLoading ? "Curating today's critical set…" : items.length === 0 ? "No articles loaded" : "Nothing curated as critical in this slice."}</p>
                : <div className="space-y-3">{lanes.now.slice(0, 12).map((it) => renderCard(it, true))}</div>}
            </div>
          </div>

          {lanes.rest.length > 0 && (
            <div className="mt-8">
              <button onClick={() => setShowRest((v) => !v)} className="flex items-center gap-2 w-full text-left mb-4 group">
                <span className="text-xs font-bold uppercase tracking-widest text-slate-500 group-hover:text-slate-300 transition-colors">Everything else</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded font-mono leading-none bg-slate-800 text-slate-600">{lanes.rest.length}</span>
                <div className="flex-1 h-px bg-slate-800" />
                <span className="text-slate-600 text-xs">{showRest ? "▴" : "▾"}</span>
              </button>
              {showRest && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {lanes.rest.map((it) => renderCard(it, true))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
