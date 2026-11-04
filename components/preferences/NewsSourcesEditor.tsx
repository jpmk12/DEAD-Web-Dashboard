"use client";

import { useEffect, useState } from "react";
import { BASE_NEWS_SOURCES, LOCAL_NEWS_SETS, allKnownNewsSources, type NewsSource } from "@/lib/newsSources";

// Split out of components/PreferencesDrawer.tsx (housekeeping 2026-11-04).

// Toggle list for the News tab's RSS sources. Backed by lib/newsSources.ts —
// disabling a source skips the fetch entirely in /api/news, so token cost for
// news_chat / threads / briefing drops along with bandwidth.
//
// Pref shape: `disabledNewsSources` is a list of source NAMES (opt-out).
// Missing-from-list = enabled, so future sources I add default-on.
//
// localFeedKey context: the user's current local set is highlighted with a
// tiny "current local" hint; other local-set sources show greyed so the user
// knows they're not active right now, but they're still toggleable so the
// pref survives a location switch.
interface NewsSourceStat { name: string; count: number; totalChars: number }

export default function NewsSourcesEditor({
  value,
  onChange,
  currentLocalKey,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  currentLocalKey: string;
}) {
  const sources = allKnownNewsSources();
  const disabledSet = new Set(value);
  const currentLocalSet = new Set((LOCAL_NEWS_SETS[currentLocalKey] ?? []).map((s) => s.name));
  const baseNames = new Set(BASE_NEWS_SOURCES.map((s) => s.name));
  const [stats, setStats] = useState<Map<string, NewsSourceStat>>(new Map());
  const [statsLoading, setStatsLoading] = useState(true);

  // Pull /api/news once on mount for the per-source volume counts shown
  // beside each toggle. The route already fetches every feed for the News
  // tab, so we're sharing whatever caching the platform layer provides.
  useEffect(() => {
    setStatsLoading(true);
    fetch("/api/news")
      .then((r) => r.json())
      .then((d) => {
        const arr: NewsSourceStat[] = Array.isArray(d?.sourceStats) ? d.sourceStats : [];
        const map = new Map<string, NewsSourceStat>();
        for (const s of arr) map.set(s.name, s);
        setStats(map);
      })
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, []);

  // Items / token estimate formatting. Token guess = chars / 4 — close
  // enough for English news prose. We surface "items" prominently and
  // tokens as a secondary indicator. The exact saving depends on whether
  // total volume drops below each AI route's article cap.
  const formatTokens = (chars: number): string => {
    const tok = Math.round(chars / 4);
    if (tok >= 10_000) return `${Math.round(tok / 1000)}k tok`;
    if (tok >= 1000)   return `${(tok / 1000).toFixed(1)}k tok`;
    return `${tok} tok`;
  };

  // Sum the enabled stats so the user sees the impact of their current
  // disabled set on aggregate volume.
  const aggregate = (() => {
    let items = 0;
    let chars = 0;
    let itemsIfAll = 0;
    let charsIfAll = 0;
    for (const s of sources) {
      const hit = stats.get(s.name);
      if (!hit) continue;
      itemsIfAll += hit.count;
      charsIfAll += hit.totalChars;
      if (!disabledSet.has(s.name)) {
        items += hit.count;
        chars += hit.totalChars;
      }
    }
    return { items, chars, itemsIfAll, charsIfAll };
  })();

  // Group by category for visual structure. Categories render in a stable
  // order; local goes last since it's location-dependent.
  const CATEGORY_ORDER: NewsSource["category"][] = ["overview", "defense", "strategic", "domestic", "space", "cyber", "local"];
  const grouped = new Map<NewsSource["category"], NewsSource[]>();
  for (const s of sources) {
    const arr = grouped.get(s.category) ?? [];
    arr.push(s);
    grouped.set(s.category, arr);
  }

  const CATEGORY_LABEL: Record<NewsSource["category"], string> = {
    overview: "Overview",
    defense: "Defense",
    strategic: "Strategic",
    domestic: "Domestic",
    space: "Space",
    cyber: "Cyber",
    local: "Local",
  };
  const CATEGORY_COLOR: Record<NewsSource["category"], string> = {
    overview:  "bg-slate-700/40 text-slate-300 border-slate-600",
    defense:   "bg-red-500/15 text-red-300 border-red-500/40",
    strategic: "bg-violet-500/15 text-violet-300 border-violet-500/40",
    domestic:  "bg-amber-500/15 text-amber-300 border-amber-500/40",
    space:     "bg-sky-500/15 text-sky-300 border-sky-500/40",
    cyber:     "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/40",
    local:     "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  };

  const toggle = (name: string) => {
    const next = new Set(disabledSet);
    if (next.has(name)) next.delete(name); else next.add(name);
    onChange(Array.from(next));
  };
  const enableAll  = () => onChange([]);
  const disableAll = () => onChange(sources.map((s) => s.name));

  const enabledCount = sources.length - value.length;

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        News Sources
      </label>
      <p className="text-[10px] text-slate-600 mb-2 leading-relaxed">
        Toggle individual feeds off to cut both the read pile AND the token cost of
        News chat / threads / briefing — disabled sources are skipped before fetch.
        Each row shows <span className="text-slate-400">items</span> in the last
        fetch and the rough <span className="text-slate-400">tokens</span> they
        carry if all were sent to Claude. Real savings only kick in once volume
        drops below the route caps (chat: 20, threads / news-chat: 40).
      </p>
      <div className="flex items-center gap-2 mb-3 text-[10px]">
        <span className="text-slate-500 font-mono">{enabledCount}/{sources.length} enabled</span>
        {!statsLoading && aggregate.itemsIfAll > 0 && (
          <span className="text-slate-600 font-mono">
            · {aggregate.items}/{aggregate.itemsIfAll} items
            {" · "}
            <span className={aggregate.chars < aggregate.charsIfAll ? "text-emerald-400" : ""}>
              ~{formatTokens(aggregate.chars)}
            </span>
            {" / "}
            ~{formatTokens(aggregate.charsIfAll)}
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={enableAll}
          className="font-bold uppercase tracking-wider border border-slate-700 hover:border-emerald-500/40 text-slate-400 hover:text-emerald-400 px-2 py-0.5 rounded transition-all"
        >
          Enable all
        </button>
        <button
          type="button"
          onClick={disableAll}
          className="font-bold uppercase tracking-wider border border-slate-700 hover:border-red-500/40 text-slate-400 hover:text-red-400 px-2 py-0.5 rounded transition-all"
        >
          Disable all
        </button>
      </div>

      <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped.get(cat);
          if (!items || items.length === 0) return null;
          return (
            <div key={cat}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                {CATEGORY_LABEL[cat]}
              </p>
              <ul className="space-y-1">
                {items.map((s) => {
                  const isDisabled = disabledSet.has(s.name);
                  const isLocalOther = s.category === "local" && !currentLocalSet.has(s.name);
                  const isCurrentLocal = s.category === "local" && currentLocalSet.has(s.name);
                  const stat = stats.get(s.name);
                  return (
                    <li
                      key={s.name}
                      className={`flex items-center gap-2 px-2 py-1 rounded border transition-colors ${
                        isDisabled
                          ? "bg-slate-900/40 border-slate-800 opacity-60"
                          : "bg-slate-800/40 border-slate-800 hover:border-slate-700"
                      }`}
                    >
                      <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={!isDisabled}
                          onChange={() => toggle(s.name)}
                          className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-800 accent-emerald-500 flex-shrink-0"
                        />
                        <span className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${CATEGORY_COLOR[s.category]}`}>
                          {s.category}
                        </span>
                        <span className="text-xs text-slate-200 truncate" title={s.url}>{s.name}</span>
                        {isCurrentLocal && !baseNames.has(s.name) && (
                          <span className="text-[9px] text-emerald-400 font-mono flex-shrink-0">· current local</span>
                        )}
                        {isLocalOther && (
                          <span className="text-[9px] text-slate-600 font-mono flex-shrink-0">· other location</span>
                        )}
                        <span className="flex-1" />
                        {/* Per-source volume + token estimate. statsLoading
                            renders a tiny placeholder so the row layout
                            doesn't snap once the fetch resolves. */}
                        {statsLoading ? (
                          <span className="text-[9px] text-slate-700 font-mono flex-shrink-0 animate-pulse">…</span>
                        ) : stat ? (
                          <span
                            className="text-[9px] text-slate-500 font-mono flex-shrink-0 tabular-nums"
                            title={`${stat.count} items, ~${formatTokens(stat.totalChars)} if all sent to Claude`}
                          >
                            {stat.count} · {formatTokens(stat.totalChars)}
                          </span>
                        ) : (
                          <span className="text-[9px] text-slate-500 font-mono flex-shrink-0">— no data</span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
