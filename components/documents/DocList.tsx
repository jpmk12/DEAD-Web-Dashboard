"use client";

import { useEffect, useState } from "react";
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

function timeAgo(s: string): string {
  try { return formatDistanceToNow(parseISO(s), { addSuffix: true }); }
  catch { return ""; }
}

export default function DocList({ selectedId, onSelect, onCreate, refreshKey }: DocListProps) {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

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

  const pinned = docs.filter((d) => d.pinned);
  const rest   = docs.filter((d) => !d.pinned);

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

        {!loading && docs.length === 0 && (
          <p className="px-3 py-6 text-[10px] text-slate-600 font-mono text-center">
            {debouncedSearch ? "No matches." : "No documents yet. Create one to get started."}
          </p>
        )}

        {!loading && pinned.length > 0 && (
          <>
            <p className="px-3 pt-3 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-amber-400">
              ★ Pinned
            </p>
            <ul>{pinned.map((d) => <DocRow key={d.id} doc={d} selected={selectedId === d.id} onSelect={onSelect} />)}</ul>
          </>
        )}

        {!loading && rest.length > 0 && (
          <>
            <p className="px-3 pt-3 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-500">
              {pinned.length > 0 ? "All other documents" : "Documents"}
            </p>
            <ul>{rest.map((d) => <DocRow key={d.id} doc={d} selected={selectedId === d.id} onSelect={onSelect} />)}</ul>
          </>
        )}
      </div>
    </div>
  );
}

function DocRow({ doc, selected, onSelect }: { doc: DocSummary; selected: boolean; onSelect: (id: string) => void; }) {
  return (
    <li>
      <button
        onClick={() => onSelect(doc.id)}
        className={`w-full text-left px-3 py-2 border-l-2 transition-colors ${
          selected
            ? "bg-slate-800/70 border-emerald-500"
            : "border-transparent hover:bg-slate-800/40"
        }`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className={`text-xs font-medium truncate ${selected ? "text-slate-100" : "text-slate-300"}`}>
            {doc.title || "Untitled"}
          </p>
          <span className="text-[9px] text-slate-600 font-mono flex-shrink-0">
            {timeAgo(doc.updatedAt)}
          </span>
        </div>
        {doc.tags.length > 0 && (
          <p className="text-[9px] text-violet-400/70 font-mono truncate mt-0.5">
            {doc.tags.join(" · ")}
          </p>
        )}
        {doc.snippet && (
          <p className="text-[10px] text-slate-500 line-clamp-2 leading-relaxed mt-1">
            {doc.snippet}
          </p>
        )}
      </button>
    </li>
  );
}
