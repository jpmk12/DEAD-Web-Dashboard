"use client";

import { useEffect, useState } from "react";
import DocList from "./DocList";
import DocEditor from "./DocEditor";
import FilesPanel from "./FilesPanel";
import FileViewer from "./FileViewer";

const LAST_SELECTED_KEY = "docs-last-selected";
const LAST_PANE_KEY = "docs-last-pane";
const LAST_FILE_KEY = "docs-last-file";
const RECENT_LIMIT = 6;

interface DocSummary {
  id: string;
  title: string;
  updatedAt?: string;
  pinned?: boolean;
}

type Pane = "docs" | "files";

// Orchestrates the sidebar list + main editor across two surfaces — docs
// and files. The top of the sidebar toggles between them; the rest of the
// state (selected doc id, selected file id, last-active pane) persists in
// localStorage so reopening the tab restores context.
export default function DocumentsTab() {
  const [pane, setPane] = useState<Pane>("docs");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [filesRefreshKey, setFilesRefreshKey] = useState(0);
  const [recentDocs, setRecentDocs] = useState<DocSummary[]>([]);

  // Restore last-selected pane + ids on mount.
  useEffect(() => {
    try {
      const lastPane = localStorage.getItem(LAST_PANE_KEY);
      if (lastPane === "docs" || lastPane === "files") setPane(lastPane);
      const v = localStorage.getItem(LAST_SELECTED_KEY);
      if (v) setSelectedId(v);
      const f = localStorage.getItem(LAST_FILE_KEY);
      if (f) setSelectedFileId(f);
    } catch { /* ignore */ }
  }, []);

  const switchPane = (p: Pane) => {
    setPane(p);
    try { localStorage.setItem(LAST_PANE_KEY, p); } catch {}
  };

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

  const selectFile = (id: string | null) => {
    setSelectedFileId(id);
    try {
      if (id) localStorage.setItem(LAST_FILE_KEY, id);
      else localStorage.removeItem(LAST_FILE_KEY);
    } catch { /* ignore */ }
  };

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

  const openByTitle = async (title: string) => {
    try {
      const params = new URLSearchParams({ search: title });
      const res = await fetch(`/api/documents?${params.toString()}`);
      const data = await res.json();
      const match: DocSummary | undefined = (data.docs ?? []).find((d: DocSummary) =>
        d.title.toLowerCase() === title.toLowerCase()
      );
      if (match) { select(match.id); return; }
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

  const recentForStrip = recentDocs.filter((d) => d.id !== selectedId).slice(0, RECENT_LIMIT);

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex flex-col" style={{ height: "calc(100vh - 200px)", minHeight: 540 }}>
      {/* Top-of-sidebar Docs / Files toggle, rendered above the whole row so
          it spans both panels. */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-800 flex-shrink-0 bg-slate-900/40">
        <button
          onClick={() => switchPane("docs")}
          className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded border transition-all ${
            pane === "docs"
              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
              : "border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500"
          }`}
        >
          📝 Docs
        </button>
        <button
          onClick={() => switchPane("files")}
          className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded border transition-all ${
            pane === "files"
              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
              : "border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500"
          }`}
        >
          📁 Files
        </button>
        <span className="text-[10px] text-slate-700 font-mono ml-2">
          {pane === "docs" ? "Markdown notes with wiki-links + version history" : "Uploaded files for safekeeping (30 MB per file)"}
        </span>
      </div>

      <div className="flex flex-1 min-h-0">
        {pane === "docs" ? (
          <>
            <DocList
              selectedId={selectedId}
              onSelect={select}
              onCreate={createNew}
              refreshKey={listRefreshKey}
              onRefresh={() => setListRefreshKey((k) => k + 1)}
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
                  Backlinks show automatically on the linked doc&apos;s footer.
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <FilesPanel
              selectedId={selectedFileId}
              onSelect={selectFile}
              refreshKey={filesRefreshKey}
              onRefresh={() => setFilesRefreshKey((k) => k + 1)}
              // When a doc is open in the Docs pane, auto-attach uploads to
              // it. Switching panes doesn't clear this — the doc id stays
              // around so a quick Docs → Files → upload trip keeps the
              // attachment intent.
              attachToDocId={selectedId}
            />
            {selectedFileId ? (
              <FileViewer
                key={selectedFileId}
                fileId={selectedFileId}
                onChanged={() => setFilesRefreshKey((k) => k + 1)}
                onDeleted={() => selectFile(null)}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
                <p className="text-2xl mb-2">📁</p>
                <p className="text-sm font-bold text-slate-300 mb-1">No file selected</p>
                <p className="text-xs text-slate-500 max-w-sm">
                  Upload a file with the <span className="text-emerald-400">↑ Upload</span> button or drop one onto the sidebar header.
                </p>
                <p className="text-[10px] text-slate-700 font-mono mt-4 max-w-md leading-relaxed">
                  PDFs preview in an inline iframe, images render full-size, small text files
                  preview as text. Everything else gets a Download button. 30 MB per-file,
                  250 MB aggregate.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
