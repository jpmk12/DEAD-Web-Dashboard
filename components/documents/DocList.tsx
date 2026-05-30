"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";

interface DocSummary {
  id: string;
  title: string;
  tags: string[];
  pinned: boolean;
  updatedAt: string;
  snippet?: string;
}

interface DocListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  refreshKey: number;
}

// View = a pre-built filter over the full doc list. View state persists in
// localStorage so a user who lives in "From email" stays there across reloads.
// Tag filter is independent of view (you can combine "From email" + tag).
type ViewKey = "all" | "pinned" | "recent" | "untagged" | "email" | "osint" | "news" | "actions";
type SortKey = "updated" | "title";

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "all",       label: "All" },
  { key: "pinned",    label: "Pinned" },
  { key: "recent",    label: "Recent (7d)" },
  { key: "untagged",  label: "Untagged" },
  { key: "email",     label: "From email" },
  { key: "osint",     label: "From OSINT" },
  { key: "news",      label: "From news" },
  { key: "actions",   label: "Action items" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "updated", label: "Recent" },
  { key: "title",   label: "Title A-Z" },
];

const LS_VIEW = "docs-view";
const LS_SORT = "docs-sort";

// Map each smart view to a predicate over a doc. Views that filter by an
// auto-applied tag check the tags array; "recent" / "untagged" / "pinned"
// look at doc fields directly. The fall-through view "all" is the identity
// predicate.
function viewPredicate(view: ViewKey, doc: DocSummary): boolean {
  switch (view) {
    case "all":      return true;
    case "pinned":   return doc.pinned;
    case "recent": {
      try {
        const t = parseISO(doc.updatedAt).getTime();
        return Number.isFinite(t) && t > Date.now() - 7 * 24 * 60 * 60 * 1000;
      } catch { return false; }
    }
    case "untagged": return doc.tags.length === 0;
    case "email":    return doc.tags.includes("email");
    case "osint":    return doc.tags.includes("osint");
    case "news":     return doc.tags.includes("news");
    case "actions":  return doc.tags.includes("tracking") || doc.tags.includes("action-item");
  }
}

function timeAgo(s: string): string {
  try { return formatDistanceToNow(parseISO(s), { addSuffix: true }); }
  catch { return ""; }
}

export default function DocList({ selectedId, onSelect, onCreate, refreshKey }: DocListProps) {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [view, setView] = useState<ViewKey>("all");
  const [sort, setSort] = useState<SortKey>("updated");
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  // Restore view + sort from localStorage on mount. Defaults are kept above
  // so a fresh user gets "All / Recent" without any storage seed.
  useEffect(() => {
    try {
      const savedView = localStorage.getItem(LS_VIEW);
      const savedSort = localStorage.getItem(LS_SORT);
      if (savedView && VIEWS.some((v) => v.key === savedView)) setView(savedView as ViewKey);
      if (savedSort && SORTS.some((s) => s.key === savedSort)) setSort(savedSort as SortKey);
    } catch { /* noop */ }
  }, []);

  const updateView = (next: ViewKey) => {
    setView(next);
    try { localStorage.setItem(LS_VIEW, next); } catch {}
  };
  const updateSort = (next: SortKey) => {
    setSort(next);
    try { localStorage.setItem(LS_SORT, next); } catch {}
  };

  // Debounce search input so we don't fire on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    fetch(`/api/documents?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setDocs(d.docs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [debouncedSearch, refreshKey]);

  // View + tag filter applied client-side over the fetched list. Server
  // already handles search; everything else is small enough to filter
  // in-memory without round-tripping.
  const filtered = useMemo(() => {
    let out = docs.filter((d) => viewPredicate(view, d));
    if (tagFilter) out = out.filter((d) => d.tags.includes(tagFilter));
    if (sort === "title") {
      // Pinned still float to top, then alphabetical within each group.
      out = [...out].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      });
    }
    // "updated" sort is what the server already returns; nothing to do.
    return out;
  }, [docs, view, sort, tagFilter]);

  const pinned = filtered.filter((d) => d.pinned);
  const rest   = filtered.filter((d) => !d.pinned);

  // Counts per view, computed once over the full doc set. Shown beside each
  // view label so the user can see at a glance which views have anything.
  const viewCounts = useMemo(() => {
    const m: Record<ViewKey, number> = { all: 0, pinned: 0, recent: 0, untagged: 0, email: 0, osint: 0, news: 0, actions: 0 };
    for (const d of docs) for (const v of VIEWS) if (viewPredicate(v.key, d)) m[v.key]++;
    return m;
  }, [docs]);

  return (
    <div className="w-72 flex-shrink-0 flex flex-col bg-slate-950 border-r border-slate-800 min-h-0">
      {/* Top controls */}
      <div className="p-3 border-b border-slate-800 space-y-2">
        <button
          onClick={onCreate}
          className="w-full flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-bold uppercase tracking-wider px-3 py-2 rounded-md transition-all glow-green"
        >
          <span className="text-base leading-none">＋</span>
          New document
        </button>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title + content…"
          className="w-full bg-slate-800/70 border border-slate-700/80 rounded-md px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500"
        />

        {/* View + sort row. View picks the pre-built filter; sort flips between
            recency and alphabetical (pinned still float either way). */}
        <div className="flex items-center gap-1.5">
          <select
            value={view}
            onChange={(e) => updateView(e.target.value as ViewKey)}
            className="flex-1 min-w-0 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-slate-500"
          >
            {VIEWS.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label} {viewCounts[v.key] > 0 ? `(${viewCounts[v.key]})` : ""}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => updateSort(e.target.value as SortKey)}
            title="Sort order (pinned always float to top)"
            className="bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-slate-500"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Active tag filter chip — only renders when set, with a close button
            so the user can drop the filter without rooting through the list. */}
        {tagFilter && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-600 font-mono">Tag:</span>
            <button
              onClick={() => setTagFilter(null)}
              title="Clear tag filter"
              className="text-[10px] font-mono bg-violet-500/15 text-violet-300 border border-violet-500/40 hover:bg-violet-500/25 px-2 py-0.5 rounded transition-all"
            >
              {tagFilter} ×
            </button>
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-3 space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 bg-slate-900/60 border border-slate-800 rounded animate-pulse" />
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <p className="px-3 py-6 text-[10px] text-slate-600 font-mono text-center leading-relaxed">
            {debouncedSearch
              ? "No matches."
              : tagFilter
              ? `No docs tagged "${tagFilter}".`
              : view !== "all"
              ? `No docs in this view.`
              : "No documents yet. Create one to get started."}
          </p>
        )}

        {!loading && pinned.length > 0 && (
          <>
            <p className="px-3 pt-3 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-amber-400">
              ★ Pinned
            </p>
            <ul>{pinned.map((d) => <DocRow key={d.id} doc={d} selected={selectedId === d.id} onSelect={onSelect} onTagClick={setTagFilter} activeTag={tagFilter} />)}</ul>
          </>
        )}

        {!loading && rest.length > 0 && (
          <>
            <p className="px-3 pt-3 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-500">
              {pinned.length > 0 ? "All other documents" : "Documents"}
            </p>
            <ul>{rest.map((d) => <DocRow key={d.id} doc={d} selected={selectedId === d.id} onSelect={onSelect} onTagClick={setTagFilter} activeTag={tagFilter} />)}</ul>
          </>
        )}
      </div>
    </div>
  );
}

function DocRow({
  doc, selected, onSelect, onTagClick, activeTag,
}: {
  doc: DocSummary; selected: boolean; onSelect: (id: string) => void; onTagClick: (tag: string) => void; activeTag: string | null;
}) {
  return (
    <li>
      <div
        className={`block w-full border-l-2 transition-colors ${
          selected ? "bg-slate-800/70 border-emerald-500" : "border-transparent hover:bg-slate-800/40"
        }`}
      >
        <button
          onClick={() => onSelect(doc.id)}
          className="w-full text-left px-3 pt-2 pb-1"
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className={`text-xs font-medium truncate ${selected ? "text-slate-100" : "text-slate-300"}`}>
              {doc.title || "Untitled"}
            </p>
            <span className="text-[9px] text-slate-600 font-mono flex-shrink-0">
              {timeAgo(doc.updatedAt)}
            </span>
          </div>
          {doc.snippet && (
            <p className="text-[10px] text-slate-500 line-clamp-2 leading-relaxed mt-1">
              {doc.snippet}
            </p>
          )}
        </button>
        {doc.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 px-3 pb-2">
            {doc.tags.map((t) => (
              <button
                key={t}
                // onMouseDown so the click doesn't first trigger the row's
                // onClick (selection). preventDefault stops the focus jump.
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onTagClick(t); }}
                title={activeTag === t ? "Active filter — click another tag to swap" : `Filter by "${t}"`}
                className={`text-[9px] font-mono px-1.5 py-0.5 rounded border transition-all ${
                  activeTag === t
                    ? "bg-violet-500/25 text-violet-200 border-violet-400/60"
                    : "bg-violet-500/10 text-violet-400/80 border-violet-500/20 hover:bg-violet-500/20 hover:text-violet-300"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
