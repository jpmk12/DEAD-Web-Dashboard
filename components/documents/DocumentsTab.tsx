"use client";

import { useEffect, useState } from "react";
import DocList from "./DocList";
import DocEditor from "./DocEditor";

const LAST_SELECTED_KEY = "docs-last-selected";
const RECENT_LIMIT = 6;

interface DocSummary {
  id: string;
  title: string;
  updatedAt?: string;
  pinned?: boolean;
}

// Orchestrates the sidebar list + main editor. Persists last-selected doc id
// in localStorage so reopening the tab restores context.
export default function DocumentsTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [recentDocs, setRecentDocs] = useState<DocSummary[]>([]);

  // Restore last-selected on mount.
  useEffect(() => {
    try {
      const v = localStorage.getItem(LAST_SELECTED_KEY);
      if (v) setSelectedId(v);
    } catch { /* ignore */ }
  }, []);

  // Keep a small list of recent docs in sync — used by the recent-docs strip
  // above the editor for one-click switching. Refreshes whenever the
  // listRefreshKey ticks (a new doc was created or an existing one was
  // edited / renamed). Pinned-DESC + updated-DESC ordering matches the
  // server default.
  useEffect(() => {
    fetch("/api/documents")
      .then((r) => r.json())
      .then((data) => {
        const list: DocSummary[] = Array.isArray(data?.docs) ? data.docs : [];
        setRecentDocs(list.slice(0, RECENT_LIMIT + 1));
      })
      .catch(() => {});
  }, [listRefreshKey]);

  const select = (id: string) => {
    setSelectedId(id);
    try { localStorage.setItem(LAST_SELECTED_KEY, id); } catch { /* ignore */ }
  };

  // "+ New document" — POST to /api/documents with a placeholder title, then
  // jump into the editor for it.
  const createNew = async () => {
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled", content: "" }),
      });
      const data = await res.json();
      if (data.doc?.id) {
        select(data.doc.id);
        setListRefreshKey((k) => k + 1);
      }
    } catch { /* ignore */ }
  };

  // Resolve a wiki link by title: find an existing doc, or create one on the
  // fly so the user can fill it in.
  const openByTitle = async (title: string) => {
    try {
      const params = new URLSearchParams({ search: title });
      const res = await fetch(`/api/documents?${params.toString()}`);
      const data = await res.json();
      const match: DocSummary | undefined = (data.docs ?? []).find((d: DocSummary) =>
        d.title.toLowerCase() === title.toLowerCase()
      );
      if (match) { select(match.id); return; }

      // Not found — create.
      const createRes = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content: "" }),
      });
      const createData = await createRes.json();
      if (createData.doc?.id) {
        select(createData.doc.id);
        setListRefreshKey((k) => k + 1);
      }
    } catch { /* ignore */ }
  };

  // Recent strip = the freshest docs minus the currently-open one, capped at
  // RECENT_LIMIT. Doing the filter at render time means the strip updates
  // instantly when the user switches docs without an extra fetch.
  const recentForStrip = recentDocs.filter((d) => d.id !== selectedId).slice(0, RECENT_LIMIT);

  return (
    <div className="flex bg-slate-950 border border-slate-800 rounded-xl overflow-hidden" style={{ height: "calc(100vh - 200px)", minHeight: 540 }}>
      <DocList
        selectedId={selectedId}
        onSelect={select}
        onCreate={createNew}
        refreshKey={listRefreshKey}
      />
      {selectedId ? (
        <div className="flex-1 flex flex-col min-w-0">
          {recentForStrip.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-800 bg-slate-900/40 overflow-x-auto flex-shrink-0">
              <span className="text-[10px] uppercase tracking-widest text-slate-600 font-bold flex-shrink-0 mr-1">Recent</span>
              {recentForStrip.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => select(d.id)}
                  title={d.title}
                  className="text-[11px] px-2 py-0.5 rounded-md border border-slate-800 bg-slate-900 hover:bg-slate-800 hover:border-emerald-500/40 text-slate-400 hover:text-emerald-400 transition-all max-w-[200px] truncate flex-shrink-0 flex items-center gap-1"
                >
                  {d.pinned && <span className="text-amber-400 text-[10px] leading-none">★</span>}
                  {d.title || "Untitled"}
                </button>
              ))}
            </div>
          )}
          <DocEditor
            key={selectedId}
            docId={selectedId}
            onChanged={() => setListRefreshKey((k) => k + 1)}
            onDeleted={() => { setSelectedId(null); try { localStorage.removeItem(LAST_SELECTED_KEY); } catch {} }}
            onOpenByTitle={openByTitle}
            onOpenById={select}
          />
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
          <p className="text-2xl mb-2">📝</p>
          <p className="text-sm font-bold text-slate-300 mb-1">No document selected</p>
          <p className="text-xs text-slate-500 max-w-sm">
            Pick a document from the sidebar or click <span className="text-emerald-400">+ New document</span> to start a fresh note.
          </p>
          <p className="text-[10px] text-slate-700 font-mono mt-4 max-w-md">
            Tip: write <code className="text-emerald-400">[[Other Doc]]</code> in any note to link to another doc.
            Backlinks show automatically on the linked doc's footer.
          </p>
        </div>
      )}
    </div>
  );
}
