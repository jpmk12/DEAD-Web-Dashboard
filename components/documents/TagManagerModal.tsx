"use client";

import { useEffect, useState } from "react";

interface TagEntry { tag: string; count: number }

interface TagManagerModalProps {
  open: boolean;
  onClose: () => void;
  // Called after any successful tag op so the parent doc list refreshes
  // (the doc rows' tags + doc updated_at all change as a side-effect).
  onChanged: () => void;
}

// Tag-bookkeeping modal. Each row exposes Rename / Merge / Delete. All three
// resolve to a single server op (`updateTagAcrossDocs`) — Rename and Merge are
// the same operation under the hood, differentiated for the user because the
// affordances are different (free-text vs picker).
export default function TagManagerModal({ open, onClose, onChanged }: TagManagerModalProps) {
  const [tags, setTags] = useState<TagEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ tag: string; op: "rename" | "merge"; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setEditing(null);
    setFilter("");
    fetch("/api/documents/tags")
      .then((r) => r.json())
      .then((d) => setTags(Array.isArray(d.tags) ? d.tags : []))
      .catch(() => setError("Failed to load tags"))
      .finally(() => setLoading(false));
  }, [open]);

  // Refetch after any successful op + tell the parent to refresh the doc list.
  const refetch = async () => {
    const res = await fetch("/api/documents/tags");
    const data = await res.json();
    setTags(Array.isArray(data.tags) ? data.tags : []);
    onChanged();
  };

  const runOp = async (op: "rename" | "merge" | "delete", from: string, to?: string) => {
    setBusy(from);
    setError(null);
    try {
      const res = await fetch("/api/documents/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, from, to }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : `Operation failed (${res.status})`);
        return;
      }
      await refetch();
      setEditing(null);
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  };

  const filtered = tags.filter((t) => !filter || t.tag.toLowerCase().includes(filter.toLowerCase()));

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md max-h-[80vh] flex flex-col pointer-events-auto shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-200">Manage tags</h2>
              <p className="text-[10px] text-slate-600 font-mono">
                {loading ? "…" : `${tags.length} unique tag${tags.length === 1 ? "" : "s"}`}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-slate-600 hover:text-slate-300 text-lg leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-slate-800 transition-all"
            >
              ×
            </button>
          </div>

          {/* Filter */}
          <div className="px-4 py-2 border-b border-slate-800 flex-shrink-0">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter tags…"
              className="w-full bg-slate-800/70 border border-slate-700/80 rounded-md px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500"
            />
          </div>

          {error && (
            <div className="px-4 py-2 border-b border-slate-800 flex-shrink-0">
              <p className="text-[11px] text-red-400 font-mono">⚠ {error}</p>
            </div>
          )}

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0">
            {loading && <p className="text-[11px] text-slate-600 font-mono text-center py-6">Loading…</p>}
            {!loading && tags.length === 0 && (
              <p className="text-[11px] text-slate-600 font-mono text-center py-6 leading-relaxed">
                No tags yet. Tag a doc from the editor header to see it here.
              </p>
            )}
            {!loading && tags.length > 0 && filtered.length === 0 && (
              <p className="text-[11px] text-slate-600 font-mono text-center py-6">No matches.</p>
            )}
            {!loading && filtered.length > 0 && (
              <ul className="space-y-1.5">
                {filtered.map((t) => {
                  const isEditing = editing?.tag === t.tag;
                  const isBusy = busy === t.tag;
                  return (
                    <li key={t.tag} className="bg-slate-800/40 border border-slate-800 rounded-md px-2.5 py-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-xs text-violet-300 font-mono truncate flex-1"
                          title={t.tag}
                        >
                          {t.tag}
                        </span>
                        <span className="text-[10px] text-slate-600 font-mono flex-shrink-0 tabular-nums">
                          {t.count}
                        </span>
                        {isBusy ? (
                          <span className="text-[10px] text-slate-500 font-mono">…</span>
                        ) : !isEditing && (
                          <>
                            <button
                              onClick={() => setEditing({ tag: t.tag, op: "rename", value: t.tag })}
                              className="text-[10px] font-bold uppercase tracking-wider border border-slate-700 hover:border-emerald-500/40 text-slate-400 hover:text-emerald-400 px-2 py-0.5 rounded transition-all"
                            >
                              Rename
                            </button>
                            <button
                              onClick={() => setEditing({ tag: t.tag, op: "merge", value: "" })}
                              disabled={tags.length <= 1}
                              title={tags.length <= 1 ? "Need at least 2 tags to merge" : "Merge into another tag"}
                              className="text-[10px] font-bold uppercase tracking-wider border border-slate-700 hover:border-amber-500/40 text-slate-400 hover:text-amber-400 px-2 py-0.5 rounded transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Merge
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Delete tag "${t.tag}" from ${t.count} document${t.count === 1 ? "" : "s"}? Docs themselves stay.`)) {
                                  runOp("delete", t.tag);
                                }
                              }}
                              className="text-[10px] font-bold uppercase tracking-wider border border-slate-700 hover:border-red-500/40 text-slate-400 hover:text-red-400 px-2 py-0.5 rounded transition-all"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                      {isEditing && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          {editing.op === "rename" ? (
                            <input
                              value={editing.value}
                              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  const next = editing.value.trim();
                                  if (next && next !== t.tag) runOp("rename", t.tag, next);
                                }
                                if (e.key === "Escape") setEditing(null);
                              }}
                              placeholder="New name"
                              autoFocus
                              className="flex-1 min-w-0 bg-slate-950 border border-slate-700 focus:border-emerald-500/40 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-700 outline-none"
                            />
                          ) : (
                            <select
                              value={editing.value}
                              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                              autoFocus
                              className="flex-1 min-w-0 bg-slate-950 border border-slate-700 focus:border-amber-500/40 rounded px-2 py-1 text-xs text-slate-200 outline-none"
                            >
                              <option value="">Pick target tag…</option>
                              {tags
                                .filter((other) => other.tag !== t.tag)
                                .map((other) => (
                                  <option key={other.tag} value={other.tag}>
                                    {other.tag} ({other.count})
                                  </option>
                                ))}
                            </select>
                          )}
                          <button
                            onClick={() => {
                              const next = editing.value.trim();
                              if (!next || next === t.tag) return;
                              runOp(editing.op === "rename" ? "rename" : "merge", t.tag, next);
                            }}
                            disabled={!editing.value.trim() || editing.value.trim() === t.tag}
                            className={`text-[10px] font-bold uppercase tracking-wider text-slate-950 px-2 py-1 rounded transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                              editing.op === "rename" ? "bg-emerald-500 hover:bg-emerald-400" : "bg-amber-500 hover:bg-amber-400"
                            }`}
                          >
                            {editing.op === "rename" ? "Rename" : "Merge"}
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            className="text-[10px] font-mono text-slate-500 hover:text-slate-300 px-1"
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer hint */}
          <div className="px-4 py-2 border-t border-slate-800 flex-shrink-0">
            <p className="text-[10px] text-slate-600 leading-snug">
              Rename keeps the docs intact, just relabels. Merge combines two tags
              (de-duplicates docs that have both). Delete removes the tag from every
              doc that has it — the docs themselves stay.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
