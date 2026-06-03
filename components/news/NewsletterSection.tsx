"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { NewsletterSummary } from "@/lib/types";
import { clientCache, CACHE_TTL } from "@/lib/clientCache";
import { DigestIcon } from "@/lib/icons";
import { gmailMessageUrl } from "@/lib/gmailLink";
import { formatDistanceToNow, parseISO } from "date-fns";

// Mirror of lib/newsletterPrefs.normalizeSubject — kept here because that
// module transitively imports mysql2 and can't be pulled into the client bundle.
function normalizeSubject(subject: string): string {
  return subject
    .split(/[:\|–]|\s+-\s+/)[0]
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const CACHE_KEY = "newsletters:items";
const SOURCE_META_KEY = "newsletters:sourcemeta";

// Badge palette keyed by colour name. New user-defined sources without an
// explicit colour are assigned one deterministically from this set (hashColor).
const BADGE_PALETTE: Record<string, string> = {
  blue:    "bg-blue-500/10 text-blue-400 border border-blue-500/30",
  emerald: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30",
  violet:  "bg-violet-500/10 text-violet-400 border border-violet-500/30",
  amber:   "bg-amber-500/10 text-amber-400 border border-amber-500/30",
  sky:     "bg-sky-500/10 text-sky-400 border border-sky-500/30",
  rose:    "bg-rose-500/10 text-rose-400 border border-rose-500/30",
  teal:    "bg-teal-500/10 text-teal-400 border border-teal-500/30",
  orange:  "bg-orange-500/10 text-orange-400 border border-orange-500/30",
};
const PALETTE_KEYS = Object.keys(BADGE_PALETTE);

type SourceMeta = { id: string; label: string; color: string | null };

function hashColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE_KEYS[h % PALETTE_KEYS.length];
}

interface NewsletterSectionProps {
  onSummariesLoaded: (summaries: NewsletterSummary[]) => void;
  refreshKey?: number;
  onLoadingChange?: (loading: boolean) => void;
  watchlist?: string[];
  previousSeen?: number;
}

const LS_DISMISSED = "nl-dismissed";
const LS_KEPT      = "nl-kept";
const LS_QUIET_DISMISSED = "nl-quiet-dismissed"; // normalised subjects the user already chose to ignore

function loadSet(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]); }
  catch { return new Set(); }
}
function saveSet(key: string, set: Set<string>) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* ignore */ }
}

function sendFeedback(payload: { id?: string; subject: string; action: string }) {
  return fetch("/api/newsletter-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

const gmailUrl = (n: NewsletterSummary) => gmailMessageUrl(n.id, n.accountEmail);

function bulletMatchesWatchlist(bullet: string, watchlist: string[]): boolean {
  const lower = bullet.toLowerCase();
  return watchlist.some((t) => lower.includes(t.toLowerCase()));
}

export default function NewsletterSection({ onSummariesLoaded, refreshKey = 0, onLoadingChange, watchlist = [], previousSeen = 0 }: NewsletterSectionProps) {
  const { status } = useSession();
  const [newsletters, setNewsletters] = useState<NewsletterSummary[]>([]);
  // id → display badge, supplied by /api/newsletters (resolved from the user's
  // configured sources). Falls back to a hashed palette colour for any id not
  // present (e.g. a summary whose source rule was later removed).
  const [sourceMeta, setSourceMeta] = useState<Record<string, SourceMeta>>({});
  // Bumped when a prefs save clears caches — forces a re-fetch so edited
  // newsletter sources take effect immediately (the fetch effect otherwise
  // only re-runs on auth/refreshKey changes).
  const [reloadTick, setReloadTick] = useState(0);
  const badgeFor = useCallback((id: string): { label: string; className: string } => {
    const meta = sourceMeta[id];
    const colorKey = (meta?.color && BADGE_PALETTE[meta.color]) ? meta.color : hashColor(id);
    return {
      label: meta?.label ?? id.toUpperCase(),
      className: BADGE_PALETTE[colorKey] ?? BADGE_PALETTE.blue,
    };
  }, [sourceMeta]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [kept, setKept] = useState<Set<string>>(new Set());
  // Normalised subject keys the server flags as "never expanded by the user."
  const [quietSubjects, setQuietSubjects] = useState<string[]>([]);
  // Quiet-series prompts the user has dismissed locally (don't show again
  // until their open-counts change).
  const [quietDismissed, setQuietDismissed] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [showQuietList, setShowQuietList] = useState(false);
  const [compactMode, setCompactMode] = useState(false);

  const onSummariesLoadedRef = useRef(onSummariesLoaded);
  useEffect(() => { onSummariesLoadedRef.current = onSummariesLoaded; });

  // Load persisted keep/dismiss state
  useEffect(() => {
    setDismissed(loadSet(LS_DISMISSED));
    setKept(loadSet(LS_KEPT));
    setQuietDismissed(loadSet(LS_QUIET_DISMISSED));
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;

    const stale = clientCache.peek<NewsletterSummary[]>(CACHE_KEY);
    const isFresh = clientCache.isFresh(CACHE_KEY);
    const isManualRefresh = refreshKey > 0;

    const staleMeta = clientCache.peek<Record<string, SourceMeta>>(SOURCE_META_KEY);
    if (staleMeta) setSourceMeta(staleMeta);
    if (stale) { setNewsletters(stale); onSummariesLoadedRef.current(stale); }
    if (isFresh && !isManualRefresh) return;

    const showSpinner = !stale || isManualRefresh;
    if (showSpinner) { setLoading(true); onLoadingChange?.(true); }

    const controller = new AbortController();
    fetch("/api/newsletters", { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        const items: NewsletterSummary[] = data.newsletters ?? [];
        setNewsletters(items);
        onSummariesLoadedRef.current(items);
        clientCache.set(CACHE_KEY, items, CACHE_TTL.NEWSLETTERS);
        if (Array.isArray(data.sources)) {
          const map: Record<string, SourceMeta> = {};
          for (const s of data.sources) {
            if (s && typeof s.id === "string") {
              map[s.id] = { id: s.id, label: typeof s.label === "string" ? s.label : s.id, color: typeof s.color === "string" ? s.color : null };
            }
          }
          setSourceMeta(map);
          clientCache.set(SOURCE_META_KEY, map, CACHE_TTL.NEWSLETTERS);
        }
        setQuietSubjects(Array.isArray(data.quietSubjects) ? data.quietSubjects : []);
      })
      .catch(() => {})
      .finally(() => {
        if (showSpinner) { setLoading(false); onLoadingChange?.(false); }
      });
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, refreshKey, reloadTick]);

  // A prefs save (e.g. editing newsletter sources) clears the client caches and
  // dispatches this event — re-pull so the new source list applies right away.
  useEffect(() => {
    const onCleared = () => {
      clientCache.delete(CACHE_KEY);
      clientCache.delete(SOURCE_META_KEY);
      setReloadTick((t) => t + 1);
    };
    window.addEventListener("dashboard-cache-cleared", onCleared);
    return () => window.removeEventListener("dashboard-cache-cleared", onCleared);
  }, []);

  // Track per-session whether we've bumped the "newsletters" surface yet.
  // Bumping on first expand is the right signal for "I actually read
  // newsletters this visit"; bumping on tab-activation would dim future
  // visits' content even if the user never opened a single newsletter.
  const surfaceBumped = useRef(false);
  const bumpSurface = useCallback(() => {
    if (surfaceBumped.current) return;
    surfaceBumped.current = true;
    fetch("/api/surface-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ surface: "newsletters" }),
    }).catch(() => {});
  }, []);

  const toggle = useCallback((n: NewsletterSummary) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(n.id)) { next.delete(n.id); } else {
        next.add(n.id);
        sendFeedback({ subject: n.subject, action: "opened" });
        bumpSurface();
      }
      return next;
    });
  }, [bumpSurface]);

  // Clicking through to read the original email is a stronger interest signal
  // than expanding the summary — record it as a weighted "deep_dive" so the
  // series ranks higher and is exempt from the quiet-series prune. Deduped per
  // session so repeatedly clicking the same item's link (the header ↗ and the
  // footer link both fire this) doesn't keep inflating its score by +3 each.
  const deepDived = useRef<Set<string>>(new Set());
  const openOriginal = useCallback((n: NewsletterSummary) => {
    if (deepDived.current.has(n.id)) return;
    deepDived.current.add(n.id);
    sendFeedback({ subject: n.subject, action: "deep_dive" });
    bumpSurface();
  }, [bumpSurface]);

  const keepNewsletter = useCallback((n: NewsletterSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    setKept((prev) => {
      const next = new Set(prev);
      if (next.has(n.id)) { next.delete(n.id); } else {
        next.add(n.id);
        sendFeedback({ id: n.id, subject: n.subject, action: "useful" });
      }
      saveSet(LS_KEPT, next);
      return next;
    });
  }, []);

  const dismissNewsletter = useCallback((n: NewsletterSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed((prev) => {
      const next = new Set(prev).add(n.id);
      saveSet(LS_DISMISSED, next);
      return next;
    });
    sendFeedback({ id: n.id, subject: n.subject, action: "not_useful" });
  }, []);

  const visibleNewsletters = useMemo(
    () => newsletters.filter((n) => !dismissed.has(n.id)),
    [newsletters, dismissed]
  );

  const sorted = useMemo(() =>
    [...visibleNewsletters].sort((a, b) => (kept.has(b.id) ? 1 : 0) - (kept.has(a.id) ? 1 : 0)),
  [visibleNewsletters, kept]);

  const sortedBullets = useMemo(() =>
    compactMode
      ? (showHidden ? newsletters : visibleNewsletters)
          .flatMap((n) => n.bullets.map((b) => ({ bullet: b, source: n.source, watched: bulletMatchesWatchlist(b, watchlist) })))
          .sort((a, b) => (b.watched ? 1 : 0) - (a.watched ? 1 : 0))
      : [],
  [compactMode, showHidden, newsletters, visibleNewsletters, watchlist]);

  if (status !== "authenticated" || (!loading && newsletters.length === 0)) return null;

  const hiddenCount = newsletters.filter((n) => dismissed.has(n.id)).length;

  // Quiet series the user hasn't already dismissed.
  const actionableQuiet = quietSubjects.filter((k) => !quietDismissed.has(k));
  // Map back to specific newsletter IDs in the current load that belong to those series.
  const quietIds = actionableQuiet.flatMap((key) =>
    newsletters.filter((n) => normalizeSubject(n.subject) === key && !dismissed.has(n.id)).map((n) => n.id)
  );

  const hideQuietSeries = () => {
    if (quietIds.length === 0) return;
    // Move every quiet newsletter into the dismissed (hidden) set and persist
    // the normalised subjects so we don't keep prompting next time.
    setDismissed((prev) => {
      const next = new Set(prev);
      quietIds.forEach((id) => next.add(id));
      saveSet(LS_DISMISSED, next);
      return next;
    });
    setQuietDismissed((prev) => {
      const next = new Set(prev);
      actionableQuiet.forEach((k) => next.add(k));
      saveSet(LS_QUIET_DISMISSED, next);
      return next;
    });
  };

  // Hide just one of the quiet series (the user clicked the per-row button
  // in the expanded list).
  const hideOneSeries = (key: string) => {
    const ids = newsletters
      .filter((n) => normalizeSubject(n.subject) === key && !dismissed.has(n.id))
      .map((n) => n.id);
    setDismissed((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      saveSet(LS_DISMISSED, next);
      return next;
    });
    setQuietDismissed((prev) => {
      const next = new Set(prev);
      next.add(key);
      saveSet(LS_QUIET_DISMISSED, next);
      return next;
    });
  };

  const ignoreQuietPrompt = () => {
    setQuietDismissed((prev) => {
      const next = new Set(prev);
      actionableQuiet.forEach((k) => next.add(k));
      saveSet(LS_QUIET_DISMISSED, next);
      return next;
    });
  };

  return (
    <section className="mb-8">
      {/* Quiet-series prompt: newsletter subjects the user has never expanded.
          Counter is clickable — expands a per-series list so the user can see
          exactly which series are being flagged and hide them selectively. */}
      {actionableQuiet.length > 0 && !loading && (
        <div className="mb-3 bg-slate-900/60 border border-slate-700/60 rounded-lg text-xs">
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="text-slate-500 text-base leading-none">○</span>
            <button
              type="button"
              onClick={() => setShowQuietList((v) => !v)}
              title={showQuietList ? "Collapse list" : "Show which series"}
              className="text-slate-400 hover:text-slate-200 flex-1 text-left"
            >
              <span className="font-semibold text-slate-200">{actionableQuiet.length}</span>{" "}
              newsletter series you&apos;ve never opened
              <span className="ml-1 text-slate-600">{showQuietList ? "▴" : "▾"}</span>
            </button>
            <button
              onClick={hideQuietSeries}
              className="text-[10px] font-bold uppercase tracking-wider bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 hover:text-red-300 px-2 py-1 rounded-md transition-all"
            >
              Hide all
            </button>
            <button
              onClick={ignoreQuietPrompt}
              title="Not now"
              className="text-[10px] font-bold uppercase tracking-wider bg-slate-800/80 hover:bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-500 hover:text-slate-300 px-2 py-1 rounded-md transition-all"
            >
              Ignore
            </button>
          </div>
          {showQuietList && (
            <ul className="border-t border-slate-800/60 divide-y divide-slate-800/40">
              {actionableQuiet.map((key) => {
                // Map normalized key back to a representative original subject
                // line. Fall back to the key itself if no newsletter in the
                // current load matches (shouldn't happen since computeQuietSubjects
                // only returns keys present in the current items).
                const items = newsletters.filter((n) => normalizeSubject(n.subject) === key);
                const subject = items[0]?.subject ?? key;
                const source = items[0]?.source ?? "";
                const account = items[0]?.accountEmail ?? "";
                return (
                  <li key={key} className="flex items-center gap-2 px-3 py-1.5">
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-slate-300" title={subject}>{subject}</div>
                      <div className="flex gap-1.5 items-center text-[10px] text-slate-600">
                        {source && <span className="uppercase font-mono">{badgeFor(source).label}</span>}
                        {source && account && <span>·</span>}
                        {account && <span className="truncate" title={account}>{account}</span>}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-600 tabular-nums shrink-0">×{items.length}</span>
                    <button
                      onClick={() => hideOneSeries(key)}
                      title="Hide just this series"
                      className="text-[10px] font-bold uppercase tracking-wider bg-red-500/5 hover:bg-red-500/15 border border-red-500/20 text-red-500/80 hover:text-red-300 px-1.5 py-0.5 rounded transition-all shrink-0"
                    >
                      Hide
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Section header */}
      <div className="flex items-center gap-3 mb-3">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Newsletters</span>
        <div className="flex-1 h-px bg-slate-800" />
        {loading && (
          <span className="text-[10px] text-slate-600 font-mono uppercase tracking-wider animate-pulse">
            Summarising…
          </span>
        )}
        {!loading && newsletters.length > 0 && (
          <button
            onClick={() => setCompactMode((m) => !m)}
            title={compactMode ? "Switch to card view" : "Switch to digest view — all bullets flat"}
            className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md border transition-all font-mono font-bold uppercase tracking-wider ${
              compactMode
                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                : "text-slate-500 border-slate-700 hover:border-slate-500 hover:text-slate-300 bg-slate-800/50"
            }`}
          >
            <DigestIcon size={14} strokeWidth={2.25} className="leading-none" />
            Digest
          </button>
        )}
      </div>

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-slate-900 rounded-xl border border-slate-800 animate-pulse" />
          ))}
        </div>
      )}

      {/* Compact/digest mode */}
      {!loading && compactMode && (
        <div className="bg-slate-900 rounded-xl border border-slate-800 divide-y divide-slate-800/60">
          {sortedBullets.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-600 italic">No bullets extracted.</p>
          ) : (
            sortedBullets.map(({ bullet, source, watched }, i) => {
              const badge = badgeFor(source);
              return (
                <div key={i} className={`flex gap-3 px-4 py-2.5 ${watched ? "bg-orange-500/5" : ""}`}>
                  <span className={`flex-shrink-0 mt-1 text-sm ${watched ? "text-orange-400" : "text-emerald-500"}`}>›</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs leading-relaxed ${watched ? "text-slate-100 font-medium" : "text-slate-300"}`}>
                      {watched && <span className="text-[10px] font-bold text-orange-400 mr-1.5">⚑</span>}
                      {bullet}
                    </p>
                  </div>
                  <span className={`flex-shrink-0 self-start text-[9px] font-bold px-1.5 py-0.5 rounded-md mt-0.5 ${badge.className}`}>
                    {badge.label}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Normal card view */}
      {!loading && !compactMode && (
        <div className="space-y-2">
          {sorted.map((n) => {
            const open = expanded.has(n.id);
            const gmailHref = gmailUrl(n);
            const isKept = kept.has(n.id);
            const badge = badgeFor(n.source);
            const timeAgo = (() => {
              try { return formatDistanceToNow(parseISO(n.date), { addSuffix: true }); }
              catch { return ""; }
            })();
            const hasWatchlistMatch = n.bullets.some((b) => bulletMatchesWatchlist(b, watchlist));
            const isStale = (() => {
              if (!previousSeen) return false;
              try { return parseISO(n.date).getTime() < previousSeen; } catch { return false; }
            })();

            return (
              <div
                key={n.id}
                className={`bg-slate-900 rounded-xl border overflow-hidden transition-all ${
                  isKept
                    ? "border-emerald-500/40 shadow-[0_0_12px_-4px_rgb(16_185_129_/_0.2)]"
                    : hasWatchlistMatch
                    ? "border-orange-500/40 shadow-[0_0_14px_-4px_rgb(249_115_22_/_0.15)]"
                    : "border-slate-800"
                } ${isStale ? "opacity-60 hover:opacity-100" : ""}`}
              >
                {/* Card header — click to expand */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(n)}
                  onKeyDown={(e) => e.key === "Enter" && toggle(n)}
                  className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-slate-800/50 transition-colors cursor-pointer"
                >
                  {/* Source badge */}
                  <span className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md ${badge.className}`}>
                    {badge.label}
                  </span>

                  {/* Account pill */}
                  {n.accountEmail && (
                    <span
                      title={n.accountEmail}
                      className={`flex-shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded-md border max-w-[130px] truncate ${
                        n.account === "secondary"
                          ? "bg-violet-500/10 text-violet-400 border-violet-500/30"
                          : "bg-slate-800 text-slate-500 border-slate-700"
                      }`}
                    >
                      {n.accountEmail}
                    </span>
                  )}

                  {/* Watchlist flag */}
                  {hasWatchlistMatch && (
                    <span className="flex-shrink-0 text-[11px] font-bold text-orange-400">⚑</span>
                  )}

                  {/* Subject + date */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{n.subject}</p>
                    {timeAgo && <p className="text-[10px] text-slate-600 mt-0.5 font-mono">{timeAgo}</p>}
                  </div>

                  {/* Keep / Remove quick actions */}
                  <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    {gmailHref && (
                      <a
                        href={gmailHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => openOriginal(n)}
                        title="Read the original email in Gmail"
                        className="w-7 h-7 flex items-center justify-center rounded-md text-slate-600 hover:text-blue-400 hover:bg-blue-500/10 transition-all text-sm"
                      >
                        ↗
                      </a>
                    )}
                    <button
                      onClick={(e) => keepNewsletter(n, e)}
                      title={isKept ? "Un-keep" : "Keep — pin to top"}
                      className={`w-7 h-7 flex items-center justify-center rounded-md text-sm transition-all ${
                        isKept
                          ? "text-emerald-400 bg-emerald-500/15 border border-emerald-500/30"
                          : "text-slate-600 hover:text-emerald-400 hover:bg-emerald-500/10"
                      }`}
                    >
                      {isKept ? "★" : "☆"}
                    </button>
                    <button
                      onClick={(e) => dismissNewsletter(n, e)}
                      title="Remove — hide this newsletter"
                      className="w-7 h-7 flex items-center justify-center rounded-md text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all text-base leading-none"
                    >
                      ×
                    </button>
                  </div>

                  {/* Expand chevron */}
                  <span className={`text-slate-500 flex-shrink-0 text-xs transition-transform ${open ? "rotate-180" : ""}`}>
                    ▼
                  </span>
                </div>

                {/* Expanded content */}
                {open && (
                  <div className="border-t border-slate-800/80">
                    <ul className="px-4 pt-3 pb-2.5 space-y-2">
                      {n.bullets.length > 0 ? (
                        n.bullets.map((b, i) => {
                          const watched = bulletMatchesWatchlist(b, watchlist);
                          return (
                            <li key={i} className={`flex gap-2.5 text-sm ${watched ? "bg-orange-500/5 -mx-2 px-2 py-1 rounded-md" : ""}`}>
                              <span className={`flex-shrink-0 mt-0.5 ${watched ? "text-orange-400" : "text-emerald-500"}`}>›</span>
                              <span className={watched ? "text-slate-100 font-medium" : "text-slate-300"}>
                                {watched && <span className="text-[10px] font-bold text-orange-400 mr-1.5">⚑</span>}
                                {b}
                              </span>
                            </li>
                          );
                        })
                      ) : (
                        <li className="text-sm text-slate-600 italic">No key facts extracted.</li>
                      )}
                    </ul>
                    {gmailHref && (
                      <div className="px-4 pb-3 -mt-0.5">
                        <a
                          href={gmailHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => openOriginal(n)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400/80 hover:text-blue-300 transition-colors"
                        >
                          Read the original email in Gmail
                          <span aria-hidden>↗</span>
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Hidden items footer */}
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowHidden((v) => !v)}
              className="w-full text-center text-[10px] text-slate-700 hover:text-slate-500 font-mono py-1 transition-colors"
            >
              {showHidden ? "Hide removed items" : `${hiddenCount} removed newsletter${hiddenCount > 1 ? "s" : ""} — show`}
            </button>
          )}

          {/* Dismissed items (shown when showHidden) */}
          {showHidden && newsletters.filter((n) => dismissed.has(n.id)).map((n) => {
            const badge = badgeFor(n.source);
            return (
              <div key={n.id} className="bg-slate-900/40 rounded-xl border border-slate-800/50 px-4 py-3 flex items-center gap-2 opacity-50">
                <span className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md ${badge.className}`}>
                  {badge.label}
                </span>
                <p className="flex-1 text-xs text-slate-500 truncate">{n.subject}</p>
                <button
                  onClick={() => {
                    setDismissed((prev) => {
                      const next = new Set(prev);
                      next.delete(n.id);
                      saveSet(LS_DISMISSED, next);
                      return next;
                    });
                  }}
                  className="text-[10px] text-slate-600 hover:text-slate-300 transition-colors ml-2 flex-shrink-0"
                >
                  Restore
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
