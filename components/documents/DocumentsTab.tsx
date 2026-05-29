"use client";

import { useEffect, useState } from "react";
import DocList from "./DocList";
import DocEditor from "./DocEditor";

const LAST_SELECTED_KEY = "docs-last-selected";

interface DocSummary {
  id: string;
  title: string;
}

// Orchestrates the sidebar list + main editor. Persists last-selected doc id
// in localStorage so reopening the tab restores context.
export default function DocumentsTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listRefreshKey, setListRefreshKey] = useState(0);

  // Restore last-selected on mount.
  useEffect(() => {
    try {
      const v = localStorage.getItem(LAST_SELECTED_KEY);
      if (v) setSelectedId(v);
    } catch { /* ignore */ }
  }, []);

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

  return (
    <div className="flex bg-slate-950 border border-slate-800 rounded-xl overflow-hidden" style={{ height: "calc(100vh - 200px)", minHeight: 540 }}>
      <DocList
        selectedId={selectedId}
        onSelect={select}
        onCreate={createNew}
        refreshKey={listRefreshKey}
      />
      {selectedId ? (
        <DocEditor
          key={selectedId}
          docId={selectedId}
          onChanged={() => setListRefreshKey((k) => k + 1)}
          onDeleted={() => { setSelectedId(null); try { localStorage.removeItem(LAST_SELECTED_KEY); } catch {} }}
          onOpenByTitle={openByTitle}
          onOpenById={select}
        />
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
