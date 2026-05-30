"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow, parseISO, format } from "date-fns";

interface DocumentVersion {
  id: string;
  docId: string;
  title: string;
  content: string;
  tags: string[];
  savedAt: string;
}

interface DocHistoryModalProps {
  open: boolean;
  docId: string;
  onClose: () => void;
  // Called after a successful restore so the editor can reload the doc.
  onRestored: () => void;
}

// Two-pane history modal. Left pane: list of snapshots (newest first) with
// timestamps. Right pane: read-only preview of the selected snapshot. Bottom
// has a Restore button that snapshots the current state first (so the
// restore itself is undoable), then writes the selected version's content.
export default function DocHistoryModal({ open, docId, onClose, onRestored }: DocHistoryModalProps) {
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [selected, setSelected] = useState<DocumentVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    fetch(`/api/documents/${docId}/versions`)
      .then((r) => r.json())
      .then((d) => {
        const arr: DocumentVersion[] = Array.isArray(d?.versions) ? d.versions : [];
        setVersions(arr);
        if (arr.length > 0) setSelected(arr[0]);
      })
      .catch(() => setError("Failed to load history"))
      .finally(() => setLoading(false));
  }, [open, docId]);

  const restore = async () => {
    if (!selected) return;
    if (!confirm(`Restore this version from ${format(parseISO(selected.savedAt), "MMM d, yyyy h:mm a")}? Your current content gets saved as a new version first, so you can undo this.`)) return;
    setRestoring(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${docId}/versions/${selected.id}/restore`, { method: "POST" });
      if (!res.ok) {
        setError(`Restore failed (${res.status})`);
        return;
      }
      onRestored();
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setRestoring(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-3xl h-[75vh] flex flex-col pointer-events-auto shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-200">📜 Version history</h2>
              <p className="text-[10px] text-slate-600 font-mono">
                {loading ? "…" : versions.length === 0 ? "No prior versions" : `${versions.length} snapshot${versions.length === 1 ? "" : "s"} (last 25 kept)`}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-slate-600 hover:text-slate-300 text-lg leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-slate-800 transition-all"
            >
              ×
            </button>
          </div>

          {error && (
            <div className="px-4 py-2 border-b border-slate-800 flex-shrink-0">
              <p className="text-[11px] text-red-400 font-mono">⚠ {error}</p>
            </div>
          )}

          <div className="flex-1 flex min-h-0">
            {/* Left: snapshot list */}
            <div className="w-56 border-r border-slate-800 overflow-y-auto flex-shrink-0">
              {loading && <p className="text-[11px] text-slate-600 font-mono text-center py-6">Loading…</p>}
              {!loading && versions.length === 0 && (
                <p className="text-[11px] text-slate-600 font-mono text-center py-6 leading-relaxed px-3">
                  No prior versions yet. Snapshots fire on content edits and are throttled to one per 5 minutes.
                </p>
              )}
              {!loading && versions.length > 0 && (
                <ul>
                  {versions.map((v, idx) => (
                    <li key={v.id}>
                      <button
                        onClick={() => setSelected(v)}
                        className={`w-full text-left px-3 py-2 border-l-2 transition-colors ${
                          selected?.id === v.id
                            ? "bg-slate-800/70 border-emerald-500"
                            : "border-transparent hover:bg-slate-800/40"
                        }`}
                      >
                        <p className="text-xs text-slate-200 truncate">{v.title || "Untitled"}</p>
                        <p className="text-[9px] text-slate-500 font-mono mt-0.5">
                          {(() => { try { return formatDistanceToNow(parseISO(v.savedAt), { addSuffix: true }); } catch { return v.savedAt; } })()}
                        </p>
                        <p className="text-[9px] text-slate-700 font-mono">
                          {(() => { try { return format(parseISO(v.savedAt), "MMM d, h:mm a"); } catch { return ""; } })()}
                        </p>
                        {idx === 0 && (
                          <span className="text-[9px] text-emerald-400 font-mono mt-0.5 inline-block">most recent</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Right: preview of the selected snapshot */}
            <div className="flex-1 flex flex-col min-w-0">
              {selected ? (
                <>
                  <div className="px-4 py-3 border-b border-slate-800 flex-shrink-0">
                    <p className="text-sm font-bold text-slate-100 truncate">{selected.title || "Untitled"}</p>
                    <p className="text-[10px] text-slate-600 font-mono mt-0.5">
                      Saved {(() => { try { return format(parseISO(selected.savedAt), "MMM d, yyyy 'at' h:mm a"); } catch { return selected.savedAt; } })()}
                    </p>
                    {selected.tags.length > 0 && (
                      <p className="text-[10px] text-violet-400 font-mono mt-1 truncate">{selected.tags.join(" · ")}</p>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto px-4 py-3">
                    <pre className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap font-mono">{selected.content || "(empty)"}</pre>
                  </div>
                </>
              ) : (
                <p className="text-[11px] text-slate-600 font-mono text-center py-12">
                  {loading ? "" : "Select a version to preview"}
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800 flex-shrink-0">
            <p className="text-[10px] text-slate-600 leading-snug">
              Restore copies the selected version's title / content / tags onto the
              current doc. Your current state is saved as a new version first, so
              the restore is itself undoable.
            </p>
            <button
              onClick={restore}
              disabled={!selected || restoring}
              className="text-[11px] font-bold uppercase tracking-wider bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3 py-1.5 rounded-md transition-all disabled:opacity-40 ml-3 flex-shrink-0"
            >
              {restoring ? "Restoring…" : "Restore"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
