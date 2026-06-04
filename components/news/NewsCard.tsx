"use client";

import { useState } from "react";
import { NewsItem } from "@/lib/types";
import { safeHttpHref } from "@/lib/url";
import { formatDistanceToNow, parseISO } from "date-fns";
import ArticleThesis from "./ArticleThesis";

interface NewsCardProps {
  item: NewsItem;
  onFeedback: (title: string, source: string, action: "useful" | "not_useful" | "opened") => void;
  isSaved?: boolean;
  onSave?: (item: NewsItem) => void;
  onUnsave?: (id: string) => void;
  watchlist?: string[];
  previousSeen?: number;
  showThesis?: boolean;
}

// Per-article cooldown for the implicit "opened" signal so refresh / re-click
// in the same week doesn't keep boosting the ranking. Stored in localStorage.
const OPEN_DEDUP_KEY = "news-opens";
const OPEN_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
function trackedRecently(itemId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const map = JSON.parse(localStorage.getItem(OPEN_DEDUP_KEY) ?? "{}") as Record<string, number>;
    const last = map[itemId] ?? 0;
    return Date.now() - last < OPEN_COOLDOWN_MS;
  } catch { return false; }
}
function markTracked(itemId: string): void {
  if (typeof window === "undefined") return;
  try {
    const map = JSON.parse(localStorage.getItem(OPEN_DEDUP_KEY) ?? "{}") as Record<string, number>;
    map[itemId] = Date.now();
    // Light prune — drop entries older than 30d to keep the map bounded.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const k of Object.keys(map)) if (map[k] < cutoff) delete map[k];
    localStorage.setItem(OPEN_DEDUP_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

const CATEGORY_STYLE: Record<string, { badge: string; bar: string }> = {
  overview:  { badge: "bg-blue-500/10 text-blue-400 border border-blue-500/30",    bar: "bg-blue-500"    },
  defense:   { badge: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30", bar: "bg-emerald-500" },
  strategic: { badge: "bg-violet-500/10 text-violet-400 border border-violet-500/30",  bar: "bg-violet-500"  },
  domestic:  { badge: "bg-amber-500/10 text-amber-400 border border-amber-500/30",  bar: "bg-amber-500"   },
  space:     { badge: "bg-sky-500/10 text-sky-400 border border-sky-500/30",        bar: "bg-sky-500"     },
  local:     { badge: "bg-rose-500/10 text-rose-400 border border-rose-500/30",     bar: "bg-rose-500"    },
};
const DEFAULT_STYLE = { badge: "bg-slate-700/40 text-slate-400 border border-slate-700", bar: "bg-slate-600" };

export default function NewsCard({ item, onFeedback, isSaved = false, onSave, onUnsave, watchlist = [], previousSeen = 0, showThesis = false }: NewsCardProps) {
  const [rated, setRated] = useState<"useful" | "not_useful" | null>(null);
  const [notingState, setNotingState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const style = CATEGORY_STYLE[item.category] ?? DEFAULT_STYLE;

  const timeAgo = (() => {
    try {
      return formatDistanceToNow(parseISO(item.pubDate), { addSuffix: true });
    } catch {
      return "";
    }
  })();

  // Dim items the user has already had a chance to see. previousSeen = 0
  // (never visited) leaves everything full opacity.
  const isStale = (() => {
    if (!previousSeen) return false;
    try { return parseISO(item.pubDate).getTime() < previousSeen; } catch { return false; }
  })();

  const rate = (action: "useful" | "not_useful") => {
    if (rated) return;
    setRated(action);
    onFeedback(item.title, item.source, action);
  };

  const titleLower = item.title.toLowerCase();
  const isWatchlisted = watchlist.some((t) => titleLower.includes(t.toLowerCase()));

  const toggleSave = () => {
    if (isSaved) { onUnsave?.(item.id); }
    else { onSave?.(item); }
  };

  return (
    <article className={`relative bg-slate-900 rounded-xl border p-5 overflow-hidden flex flex-col card-hover transition-opacity ${
      isWatchlisted
        ? "border-orange-500/40 shadow-[0_0_16px_-4px_rgb(249_115_22_/_0.2)]"
        : "border-slate-800 hover:border-slate-600"
    } ${isStale ? "opacity-50 hover:opacity-100" : ""}`}>
      {/* Colour accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${isWatchlisted ? "bg-orange-500" : style.bar}`} />

      {/* Watchlist glow effect */}
      {isWatchlisted && (
        <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-transparent pointer-events-none rounded-xl" />
      )}

      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${style.badge}`}>
            {item.source.toUpperCase()}
          </span>
          {isWatchlisted && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-orange-500/15 text-orange-400 border border-orange-500/40">
              ⚑ WATCH
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {timeAgo && <span className="text-[10px] text-slate-600 font-mono">{timeAgo}</span>}
          <button
            onClick={async (e) => {
              e.stopPropagation();
              if (notingState === "saving" || notingState === "saved") return;
              setNotingState("saving");
              try {
                const res = await fetch("/api/documents", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    title: item.title.slice(0, 240),
                    content:
                      `# ${item.title}\n\n` +
                      `**Source:** ${item.source}  ·  **Published:** ${item.pubDate.slice(0, 10)}\n\n` +
                      `**Link:** [${item.link}](${item.link})\n\n` +
                      (item.summary ? `> ${item.summary.replace(/\n/g, "\n> ")}\n\n` : "") +
                      `---\n\n## Notes\n\n_(your notes here)_\n`,
                    // "news" first so the Docs sidebar "From news" smart
                    // view can find it; category as the secondary tag for
                    // grouping.
                    tags: ["news", item.category],
                    link: { type: "article", id: item.id, title: item.title },
                  }),
                });
                if (!res.ok) throw new Error();
                setNotingState("saved");
                setTimeout(() => setNotingState("idle"), 1800);
              } catch {
                setNotingState("error");
                setTimeout(() => setNotingState("idle"), 1800);
              }
            }}
            title={
              notingState === "saved" ? "Saved to Docs" :
              notingState === "error" ? "Failed — click to retry" :
              "Save excerpt to Docs tab"
            }
            className={`w-9 h-9 lg:w-6 lg:h-6 flex items-center justify-center rounded-md transition-all text-sm ${
              notingState === "saved"
                ? "text-emerald-400 bg-emerald-500/10"
                : notingState === "error"
                ? "text-red-400 bg-red-500/10"
                : notingState === "saving"
                ? "text-slate-500 cursor-wait"
                : "text-slate-600 hover:text-emerald-400 hover:bg-emerald-500/10"
            }`}
          >
            {notingState === "saved" ? "✓" : notingState === "error" ? "!" : "▤"}
          </button>
          <button
            onClick={toggleSave}
            title={isSaved ? "Remove bookmark" : "Save for later"}
            className={`w-9 h-9 lg:w-6 lg:h-6 flex items-center justify-center rounded-md transition-all text-base ${
              isSaved
                ? "text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                : "text-slate-600 hover:text-amber-400 hover:bg-amber-500/10"
            }`}
          >
            {isSaved ? "★" : "☆"}
          </button>
        </div>
      </div>

      <h2 className="text-sm font-semibold text-slate-100 mb-2 leading-snug flex-1">
        <a
          href={safeHttpHref(item.link)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            if (!trackedRecently(item.id)) {
              markTracked(item.id);
              onFeedback(item.title, item.source, "opened");
            }
          }}
          className="hover:text-emerald-400 transition-colors"
        >
          {item.title}
        </a>
      </h2>

      {item.summary && (
        <p className="text-xs text-slate-500 line-clamp-3 leading-relaxed mb-4">{item.summary}</p>
      )}

      {showThesis && <ArticleThesis article={item} className="mb-4" />}

      {/* Feedback row */}
      <div className="flex items-center gap-2 pt-2.5 border-t border-slate-800/80 mt-auto">
        <span className="text-[10px] text-slate-600 uppercase tracking-wider font-mono">Relevant?</span>
        <button
          onClick={() => rate("useful")}
          disabled={!!rated}
          title="Mark as relevant"
          className={`text-xs px-2 py-1.5 lg:py-0.5 rounded-md transition-all ${
            rated === "useful"
              ? "text-emerald-400 bg-emerald-500/15 border border-emerald-500/30"
              : rated
              ? "text-slate-700 cursor-default"
              : "text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10"
          }`}
        >
          ▲ Yes
        </button>
        <button
          onClick={() => rate("not_useful")}
          disabled={!!rated}
          title="Mark as irrelevant"
          className={`text-xs px-2 py-1.5 lg:py-0.5 rounded-md transition-all ${
            rated === "not_useful"
              ? "text-red-400 bg-red-500/15 border border-red-500/30"
              : rated
              ? "text-slate-700 cursor-default"
              : "text-slate-500 hover:text-red-400 hover:bg-red-500/10"
          }`}
        >
          ▼ No
        </button>
        {rated && (
          <span className="text-[10px] text-slate-600 font-mono ml-auto">noted ✓</span>
        )}
      </div>
    </article>
  );
}
