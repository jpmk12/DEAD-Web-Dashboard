"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import TagManagerModal from "./TagManagerModal";

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
  // Bump-the-refresh callback so the tag manager can force a list re-fetch
  // after rename/merge/delete (every doc's tags + updated_at changed).
  onRefresh: () => void;
}

// View = a pre-built filter over the full doc list. View state persists in
// localStorage so a user who lives in "From email" stays there across reloads.
// Tag filter is independent of view (you can combine "From email" + tag).
type ViewKey = "all" | "pinned" | "recent" | "untagged" | "email" | "osint" | "news" | "actions" | "archived";
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
  { key: "archived",  label: "Archived" },
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
    // "Archived" docs come from a separate API call (archived=1), so by the
    // time we hit this predicate they're already on the right list — pass
    // them all through.
    case "archived": return true;
  }
}

function timeAgo(s: string): string {
  try { return formatDistanceToNow(parseISO(s), { addSuffix: true }); }
  catch { return ""; }
}

export default function DocList({ selectedId, onSelect, onCreate, refreshKey, onRefresh }: DocListProps) {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [view, setView] = useState<ViewKey>("all");
  const [sort, setSort] = useState<SortKey>("updated");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  // Bulk selection. Set of doc ids; action bar surfaces when non-empty.
  // `bulkMode` is the in-flight tag/untag input panel — null otherwise.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<null | "tag" | "untag">(null);
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

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

  // ─── Bulk actions ────────────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => { setSelected(new Set()); setBulkMode(null); setBulkTagInput(""); };

  // POST a bulk op to the server, clear selection on success, refresh the
  // sidebar so updated tags / pinned states / removed docs appear.
  const runBulk = async (op: "pin" | "unpin" | "delete" | "archive" | "unarchive", tag?: string) => {
    if (selected.size === 0) return;
    if (op === "delete" && !confirm(`Delete ${selected.size} document${selected.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setBulkBusy(true);
    try {
      await fetch("/api/documents/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, ids: Array.from(selected), tag }),
      });
      clearSelection();
      onRefresh();
    } catch { /* ignore */ }
    finally { setBulkBusy(false); }
  };

  const applyBulkTag = async () => {
    const tag = bulkTagInput.trim();
    if (!tag || !bulkMode) return;
    setBulkBusy(true);
    try {
      await fetch("/api/documents/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: bulkMode, ids: Array.from(selected), tag }),
      });
      clearSelection();
      onRefresh();
    } catch { /* ignore */ }
    finally { setBulkBusy(false); }
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
    // Archived docs are a separate result set — the server returns either
    // active OR archived, not both, so the view-switch drives a refetch.
    if (view === "archived") params.set("archived", "1");
    fetch(`/api/documents?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setDocs(d.docs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [debouncedSearch, refreshKey, view]);

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

  // Select-all (visible filtered list) toggle. Defined after `filtered` so
  // it captures the current render's value. Acts as a deselect when
  // everything visible is already selected.
  const selectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = filtered.length > 0 && filtered.every((d) => next.has(d.id));
      if (allSelected) { for (const d of filtered) next.delete(d.id); }
      else             { for (const d of filtered) next.add(d.id); }
      return next;
    });
  };

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
          <button
            type="button"
            onClick={() => setTagManagerOpen(true)}
            title="Manage tags — rename, merge, delete across all docs"
            className="bg-slate-800/70 border border-slate-700/80 hover:border-violet-500/40 hover:text-violet-400 text-slate-400 rounded-md w-7 h-7 flex items-center justify-center transition-all flex-shrink-0"
          >
            <span className="text-sm leading-none">#</span>
          </button>
        </div>

        {/* Bulk action bar — surfaces when ≥1 doc is selected via the row
            checkboxes. Pin/Unpin/Tag/Untag/Delete operate on every selection,
            then clear it. Tag/Untag drop a small inline input panel below
            so the user types the tag without leaving the bar. */}
        {selected.size > 0 && (
          <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-md px-2 py-1.5">
            <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
              <span className="text-emerald-400 font-bold uppercase tracking-wider">
                {selected.size} sel
              </span>
              {view !== "archived" ? (
                <>
                  <button onClick={() => runBulk("pin")}    disabled={bulkBusy} className="font-bold uppercase tracking-wider border border-slate-700 hover:border-amber-500/40 text-slate-400 hover:text-amber-400 px-1.5 py-0.5 rounded transition-all disabled:opacity-40">Pin</button>
                  <button onClick={() => runBulk("unpin")}  disabled={bulkBusy} className="font-bold uppercase tracking-wider border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 px-1.5 py-0.5 rounded transition-all disabled:opacity-40">Unpin</button>
                  <button onClick={() => { setBulkMode("tag");   setBulkTagInput(""); }} disabled={bulkBusy} className={`font-bold uppercase tracking-wider border px-1.5 py-0.5 rounded transition-all disabled:opacity-40 ${bulkMode === "tag" ? "bg-violet-500/15 text-violet-300 border-violet-500/40" : "border-slate-700 hover:border-violet-500/40 text-slate-400 hover:text-violet-400"}`}>+ Tag</button>
                  <button onClick={() => { setBulkMode("untag"); setBulkTagInput(""); }} disabled={bulkBusy} className={`font-bold uppercase tracking-wider border px-1.5 py-0.5 rounded transition-all disabled:opacity-40 ${bulkMode === "untag" ? "bg-violet-500/15 text-violet-300 border-violet-500/40" : "border-slate-700 hover:border-violet-500/40 text-slate-400 hover:text-violet-400"}`}>− Tag</button>
                  <button onClick={() => runBulk("archive")} disabled={bulkBusy} title="Archive — soft-delete (restore from the Archived view)" className="font-bold uppercase tracking-wider border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 px-1.5 py-0.5 rounded transition-all disabled:opacity-40">Archive</button>
                </>
              ) : (
                <button onClick={() => runBulk("unarchive")} disabled={bulkBusy} title="Restore selected docs from the archive" className="font-bold uppercase tracking-wider border border-emerald-700 hover:border-emerald-500/40 text-emerald-400 hover:text-emerald-300 px-1.5 py-0.5 rounded transition-all disabled:opacity-40">Restore</button>
              )}
              <button onClick={() => runBulk("delete")} disabled={bulkBusy} className="font-bold uppercase tracking-wider border border-slate-700 hover:border-red-500/40 text-slate-400 hover:text-red-400 px-1.5 py-0.5 rounded transition-all disabled:opacity-40">Del</button>
              <span className="flex-1" />
              <button onClick={clearSelection} disabled={bulkBusy} className="text-slate-500 hover:text-slate-300 px-1 transition-all disabled:opacity-40" title="Clear selection">×</button>
            </div>
            {bulkMode && (
              <div className="flex items-center gap-1 mt-1.5">
                <input
                  value={bulkTagInput}
                  onChange={(e) => setBulkTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); applyBulkTag(); }
                    if (e.key === "Escape") { setBulkMode(null); setBulkTagInput(""); }
                  }}
                  autoFocus
                  placeholder={bulkMode === "tag" ? "Tag to add" : "Tag to remove"}
                  disabled={bulkBusy}
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-700 focus:border-emerald-500/40 rounded px-2 py-0.5 text-[11px] text-slate-200 placeholder-slate-700 outline-none disabled:opacity-40"
                />
                <button
                  onClick={applyBulkTag}
                  disabled={bulkBusy || !bulkTagInput.trim()}
                  className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-2 py-0.5 rounded disabled:opacity-40"
                >
                  Apply
                </button>
              </div>
            )}
          </div>
        )}

        {/* Select-all toggle for the current visible filtered list. Hidden when
            the list is empty so it doesn't dangle. */}
        {!loading && filtered.length > 0 && (
          <button
            onClick={selectAllVisible}
            className="text-[10px] text-slate-600 hover:text-slate-400 font-mono self-start"
          >
            {filtered.every((d) => selected.has(d.id)) ? "Deselect all visible" : `Select all visible (${filtered.length})`}
          </button>
        )}

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
            <ul>{pinned.map((d) => <DocRow key={d.id} doc={d} selected={selectedId === d.id} onSelect={onSelect} onTagClick={setTagFilter} activeTag={tagFilter} checked={selected.has(d.id)} onToggleChecked={toggleSelect} />)}</ul>
          </>
        )}

        {!loading && rest.length > 0 && (
          <>
            <p className="px-3 pt-3 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-500">
              {pinned.length > 0 ? "All other documents" : "Documents"}
            </p>
            <ul>{rest.map((d) => <DocRow key={d.id} doc={d} selected={selectedId === d.id} onSelect={onSelect} onTagClick={setTagFilter} activeTag={tagFilter} checked={selected.has(d.id)} onToggleChecked={toggleSelect} />)}</ul>
          </>
        )}
      </div>

      <TagManagerModal
        open={tagManagerOpen}
        onClose={() => setTagManagerOpen(false)}
        onChanged={() => {
          // Tag changes touch every affected doc's tags + updated_at, so the
          // list needs a refetch. Also drop the active filter if it referenced
          // a tag that no longer exists (deletes / renames).
          onRefresh();
          if (tagFilter) {
            fetch("/api/documents/tags")
              .then((r) => r.json())
              .then((d) => {
                const tags: { tag: string }[] = Array.isArray(d?.tags) ? d.tags : [];
                if (!tags.some((t) => t.tag === tagFilter)) setTagFilter(null);
              })
              .catch(() => {});
          }
        }}
      />
    </div>
  );
}

function DocRow({
  doc, selected, onSelect, onTagClick, activeTag, checked, onToggleChecked,
}: {
  doc: DocSummary; selected: boolean; onSelect: (id: string) => void; onTagClick: (tag: string) => void; activeTag: string | null;
  checked: boolean; onToggleChecked: (id: string) => void;
}) {
  return (
    <li>
      <div
        className={`flex w-full border-l-2 transition-colors ${
          selected ? "bg-slate-800/70 border-emerald-500" : "border-transparent hover:bg-slate-800/40"
        }`}
      >
        <label
          // onMouseDown + preventDefault keeps the row's button click from
          // firing first and stealing the selected-doc state.
          onMouseDown={(e) => e.preventDefault()}
          className="flex items-center pl-2 pr-1 cursor-pointer"
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggleChecked(doc.id)}
            className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-800 accent-emerald-500 cursor-pointer"
          />
        </label>
        <div className="flex-1 min-w-0">
        <button
          onClick={() => onSelect(doc.id)}
          className="w-full text-left px-2 pt-2 pb-1"
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
          <div className="flex flex-wrap gap-1 px-2 pb-2">
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
      </div>
    </li>
  );
}
