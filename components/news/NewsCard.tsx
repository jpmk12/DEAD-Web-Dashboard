"use client";

import { NewsItem } from "@/lib/types";
import { formatDistanceToNow, parseISO } from "date-fns";

interface NewsCardProps {
  item: NewsItem;
}

const CATEGORY_STYLE: Record<string, { badge: string; bar: string }> = {
  overview:  { badge: "bg-blue-500/10 text-blue-400 border border-blue-500/30",         bar: "bg-blue-500"    },
  defense:   { badge: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30", bar: "bg-emerald-500" },
  strategic: { badge: "bg-violet-500/10 text-violet-400 border border-violet-500/30",   bar: "bg-violet-500"  },
  domestic:  { badge: "bg-amber-500/10 text-amber-400 border border-amber-500/30",      bar: "bg-amber-500"   },
  space:     { badge: "bg-sky-500/10 text-sky-400 border border-sky-500/30",            bar: "bg-sky-500"     },
  local:     { badge: "bg-rose-500/10 text-rose-400 border border-rose-500/30",         bar: "bg-rose-500"    },
};
const DEFAULT_STYLE = { badge: "bg-slate-700/40 text-slate-400 border border-slate-700", bar: "bg-slate-600" };

export default function NewsCard({ item }: NewsCardProps) {
  const style = CATEGORY_STYLE[item.category] ?? DEFAULT_STYLE;

  const timeAgo = (() => {
    try {
      return formatDistanceToNow(parseISO(item.pubDate), { addSuffix: true });
    } catch {
      return "";
    }
  })();

  return (
    <article className="relative bg-slate-900 rounded-xl border border-slate-800 hover:border-slate-600 p-5 overflow-hidden flex flex-col card-hover">
      <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${style.bar}`} />

      <div className="flex items-start justify-between mb-3 gap-2">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${style.badge}`}>
          {item.source.toUpperCase()}
        </span>
        {timeAgo && <span className="text-[10px] text-slate-600 font-mono flex-shrink-0">{timeAgo}</span>}
      </div>

      <h2 className="text-sm font-semibold text-slate-100 mb-2 leading-snug flex-1">
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-emerald-400 transition-colors"
        >
          {item.title}
        </a>
      </h2>

      {item.summary && (
        <p className="text-xs text-slate-500 line-clamp-3 leading-relaxed">{item.summary}</p>
      )}
    </article>
  );
}
