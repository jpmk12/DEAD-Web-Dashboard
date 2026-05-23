"use client";

import { NewsItem, NewsletterSummary, NewsThread, ThreadsResult } from "@/lib/types";

interface ThreadsViewProps {
  result: ThreadsResult;
  articles: NewsItem[];
  newsletters: NewsletterSummary[];
  watchlist?: string[];
}

// Assign a color family to each thread by cycling through a palette
const PALETTE = [
  { border: "border-red-500/40",    bg: "bg-red-500/8",    badge: "bg-red-500/15 text-red-400 border-red-500/40",    dot: "bg-red-400",    trendColor: "text-red-400" },
  { border: "border-amber-500/40",  bg: "bg-amber-500/8",  badge: "bg-amber-500/15 text-amber-400 border-amber-500/40",  dot: "bg-amber-400",  trendColor: "text-amber-400" },
  { border: "border-blue-500/40",   bg: "bg-blue-500/8",   badge: "bg-blue-500/15 text-blue-400 border-blue-500/40",   dot: "bg-blue-400",   trendColor: "text-blue-400" },
  { border: "border-violet-500/40", bg: "bg-violet-500/8", badge: "bg-violet-500/15 text-violet-400 border-violet-500/40", dot: "bg-violet-400", trendColor: "text-violet-400" },
  { border: "border-emerald-500/40",bg: "bg-emerald-500/8",badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",dot: "bg-emerald-400",trendColor: "text-emerald-400" },
  { border: "border-orange-500/40", bg: "bg-orange-500/8", badge: "bg-orange-500/15 text-orange-400 border-orange-500/40", dot: "bg-orange-400", trendColor: "text-orange-400" },
  { border: "border-cyan-500/40",   bg: "bg-cyan-500/8",   badge: "bg-cyan-500/15 text-cyan-400 border-cyan-500/40",   dot: "bg-cyan-400",   trendColor: "text-cyan-400" },
  { border: "border-pink-500/40",   bg: "bg-pink-500/8",   badge: "bg-pink-500/15 text-pink-400 border-pink-500/40",   dot: "bg-pink-400",   trendColor: "text-pink-400" },
];

const TREND = {
  rising:  { icon: "↑", label: "Rising",  cls: "text-red-400" },
  stable:  { icon: "→", label: "Stable",  cls: "text-slate-500" },
  fading:  { icon: "↓", label: "Fading",  cls: "text-slate-600" },
};

function matchesWatchlist(text: string, watchlist: string[]): boolean {
  const lower = text.toLowerCase();
  return watchlist.some((t) => lower.includes(t.toLowerCase()));
}

interface ThreadCardProps {
  thread: NewsThread;
  color: typeof PALETTE[number];
  articles: NewsItem[];
  watchlist: string[];
  index: number;
}

function ThreadCard({ thread, color, articles, watchlist, index }: ThreadCardProps) {
  const trend = TREND[thread.trend];
  const threadArticles = articles.filter((a) => thread.articleIds.includes(a.id));
  const isWatched =
    matchesWatchlist(thread.label, watchlist) ||
    matchesWatchlist(thread.headline, watchlist);

  return (
    <div
      className={`relative rounded-xl border overflow-hidden transition-all ${
        isWatched
          ? "border-orange-500/50 shadow-[0_0_20px_-4px_rgb(249_115_22_/_0.2)]"
          : color.border
      }`}
    >
      {/* Top bar */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${
        isWatched ? "border-orange-500/20 bg-orange-500/5" : `${color.bg} border-white/5`
      }`}>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-slate-600 select-none">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className={`text-[10px] font-bold tracking-widest px-2 py-0.5 rounded-md border ${
            isWatched ? "bg-orange-500/15 text-orange-400 border-orange-500/40" : color.badge
          }`}>
            {isWatched && <span className="mr-1">⚑</span>}
            {thread.label}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-mono font-bold ${isWatched ? "text-orange-400" : trend.cls}`}>
            {trend.icon} {trend.label}
          </span>
          <span className="text-[10px] text-slate-600 font-mono">
            {thread.articleIds.length} {thread.articleIds.length === 1 ? "source" : "sources"}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-4 bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-100 leading-snug mb-2">
          {thread.headline}
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed mb-3">{thread.summary}</p>

        {thread.newsletterContext && (
          <div className="flex gap-2 mb-3 bg-slate-800/60 rounded-lg px-3 py-2 border border-slate-700/60">
            <span className="text-emerald-500 flex-shrink-0 text-sm mt-0.5">›</span>
            <p className="text-xs text-slate-400 italic leading-relaxed">{thread.newsletterContext}</p>
          </div>
        )}

        {/* Linked articles */}
        {threadArticles.length > 0 && (
          <div className="space-y-1.5 pt-3 border-t border-slate-800/60">
            {threadArticles.map((a) => (
              <a
                key={a.id}
                href={a.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 group"
              >
                <span className="flex-shrink-0 w-1 h-1 rounded-full mt-1.5 bg-slate-600 group-hover:bg-emerald-500 transition-colors" />
                <span className="text-xs text-slate-500 group-hover:text-slate-300 transition-colors leading-snug">
                  {a.title}
                  <span className="text-slate-700 ml-1.5 not-italic">{a.source}</span>
                </span>
              </a>
            ))}
          </div>
        )}

        {/* Source tags */}
        {thread.sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {thread.sources.map((s) => (
              <span key={s} className="text-[10px] text-slate-600 font-mono bg-slate-800/60 px-1.5 py-0.5 rounded">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ThreadsView({ result, articles, newsletters: _newsletters, watchlist = [] }: ThreadsViewProps) {
  const { throughLine, threads } = result;

  // Extract labels for topic pills
  const pills = threads.map((t, i) => ({ label: t.label, color: PALETTE[i % PALETTE.length], trend: t.trend, count: t.articleIds.length }));

  return (
    <div className="space-y-6">
      {/* Topic pills row */}
      {pills.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[10px] text-slate-600 font-mono uppercase tracking-wider flex-shrink-0">Today</span>
          {pills.map(({ label, color, trend, count }) => {
            const t = TREND[trend];
            const isWatched = matchesWatchlist(label, watchlist);
            return (
              <span
                key={label}
                className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all ${
                  isWatched
                    ? "bg-orange-500/15 text-orange-400 border-orange-500/40"
                    : color.badge
                }`}
              >
                {isWatched && <span className="text-orange-400">⚑</span>}
                {label}
                <span className={`text-[9px] ${isWatched ? "text-orange-400" : t.cls}`}>{t.icon}</span>
                <span className={`text-[9px] font-mono opacity-60`}>{count}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Through-Line */}
      {throughLine && (
        <div className="relative bg-slate-900 rounded-xl border border-slate-700/60 overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-emerald-400 via-emerald-500 to-transparent" />
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Through-Line</span>
              <div className="flex-1 h-px bg-slate-800" />
            </div>
            <p className="text-sm text-slate-200 leading-relaxed">{throughLine}</p>
          </div>
        </div>
      )}

      {/* Thread cards */}
      <div className="space-y-4">
        {threads.map((thread, i) => (
          <ThreadCard
            key={thread.label + i}
            thread={thread}
            color={PALETTE[i % PALETTE.length]}
            articles={articles}
            watchlist={watchlist}
            index={i}
          />
        ))}
      </div>
    </div>
  );
}
