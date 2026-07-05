"use client";

import { useEffect, useMemo, useState } from "react";
import MarkdownPreview from "./MarkdownPreview";
import { compileDocs, renderNotebookHtml, type ComposeDoc, type ComposeOptions } from "@/lib/composeDocs";

interface ComposeModalProps {
  docIds: string[];
  onClose: () => void;
  // Fired after "Save as doc" creates the compiled doc — parent selects it.
  onSaved: (newDocId: string) => void;
}

type OptKey = "titlePage" | "toc" | "rewriteLinks" | "includeMeta" | "footnoteExternal";

const OPT_LABELS: { key: OptKey; label: string; title: string }[] = [
  { key: "titlePage",        label: "Title page",        title: "Lead with a title + compile date header" },
  { key: "toc",              label: "Contents",          title: "Generated table of contents with anchor links" },
  { key: "rewriteLinks",     label: "[[links]] → anchors", title: "Wiki-links between included docs become internal #sec-N links" },
  { key: "footnoteExternal", label: "Footnote links out", title: "Wiki-links to docs NOT in the compile become numbered footnotes" },
  { key: "includeMeta",      label: "Doc metadata",      title: "Per-section tags + updated date line" },
];

function downloadBlob(filename: string, mime: string, text: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeFile(title: string, ext: string): string {
  const base = title.trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-").slice(0, 80) || "synthesis";
  return `${base}.${ext}`;
}

// Assemble N selected docs into one deliverable: pick order, toggle compile
// options, preview, then export (.md / standalone HTML) or save the compiled
// result back into Docs as a new doc tagged "synthesis".
export default function ComposeModal({ docIds, onClose, onSaved }: ComposeModalProps) {
  const [items, setItems] = useState<ComposeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("Synthesis");
  const [opts, setOpts] = useState<Record<OptKey, boolean>>({
    titlePage: true, toc: true, rewriteLinks: true, includeMeta: false, footnoteExternal: true,
  });
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      docIds.map((id) =>
        fetch(`/api/documents/${id}`)
          .then((r) => r.json())
          .then((d) => d.doc as ComposeDoc | undefined)
          .catch(() => undefined)
      )
    ).then((docs) => {
      if (cancelled) return;
      setItems(docs.filter((d): d is ComposeDoc => !!d));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [docIds]);

  const composeOpts: ComposeOptions = useMemo(
    () => ({ title, ...opts }),
    [title, opts]
  );
  const compiled = useMemo(
    () => (items.length > 0 ? compileDocs(items, composeOpts) : ""),
    [items, composeOpts]
  );
  const wordCount = useMemo(() => Math.round(compiled.length / 5), [compiled]);

  const move = (idx: number, dir: -1 | 1) => {
    setItems((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };
  const remove = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const saveAsDoc = async () => {
    if (saving || items.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || "Synthesis", content: compiled, tags: ["synthesis"] }),
      });
      const data = await res.json();
      if (!data.doc?.id) throw new Error(data.error || "Save failed");
      onSaved(data.doc.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-950 border border-slate-700/80 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-800 flex-shrink-0">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-300">⧉ Compose</h2>
          <span className="text-[10px] text-slate-600 font-mono">
            {loading ? "loading…" : `${items.length} section${items.length === 1 ? "" : "s"} · ~${wordCount.toLocaleString()} words`}
          </span>
          <button onClick={onClose} className="ml-auto text-slate-500 hover:text-slate-300 text-lg leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
              Deliverable title
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-800/70 border border-slate-700/80 rounded-md px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500/50"
            />
          </div>

          {/* Order list */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
              Compile order
            </label>
            {loading && <div className="h-24 bg-slate-900/60 border border-slate-800 rounded-lg animate-pulse" />}
            {!loading && items.length === 0 && (
              <p className="text-xs text-slate-500 py-3 text-center">Nothing to compile — all selected docs failed to load.</p>
            )}
            <ul className="space-y-1.5">
              {items.map((d, i) => (
                <li key={d.id} className="flex items-center gap-2.5 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2">
                  <span className="text-[10px] font-bold text-emerald-400 w-5 flex-shrink-0">{i + 1}</span>
                  <span className="flex-1 text-xs text-slate-200 font-medium truncate">{d.title || "Untitled"}</span>
                  <span className="text-[9px] text-slate-600 font-mono flex-shrink-0">~{Math.round(d.content.length / 5)}w</span>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up"
                      className="text-slate-500 hover:text-slate-200 disabled:opacity-25 px-1">↑</button>
                    <button onClick={() => move(i, 1)} disabled={i === items.length - 1} title="Move down"
                      className="text-slate-500 hover:text-slate-200 disabled:opacity-25 px-1">↓</button>
                    <button onClick={() => remove(i)} title="Remove from compile"
                      className="text-slate-600 hover:text-red-400 px-1">✕</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Options */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
              Options
            </label>
            <div className="flex flex-wrap gap-2">
              {OPT_LABELS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setOpts((prev) => ({ ...prev, [o.key]: !prev[o.key] }))}
                  title={o.title}
                  className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-md border transition-all ${
                    opts[o.key]
                      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                      : "bg-slate-800/60 text-slate-500 border-slate-700 hover:text-slate-300"
                  }`}
                >
                  {opts[o.key] ? "✓ " : ""}{o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div>
            <button
              onClick={() => setShowPreview((v) => !v)}
              className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-300 mb-1.5"
            >
              {showPreview ? "▾ Preview" : "▸ Preview"}
            </button>
            {showPreview && (
              <div className="bg-slate-900/50 border border-slate-800 rounded-lg px-4 py-3 max-h-72 overflow-y-auto">
                <MarkdownPreview text={compiled} />
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-slate-800 flex-shrink-0">
          <button
            onClick={saveAsDoc}
            disabled={saving || loading || items.length === 0}
            title='Create a new doc from the compiled result (tagged "synthesis")'
            className="text-[11px] font-bold uppercase tracking-wider bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3.5 py-2 rounded-md disabled:opacity-40 transition-all"
          >
            {saving ? "Saving…" : "Save as doc"}
          </button>
          <button
            onClick={() => downloadBlob(safeFile(title, "md"), "text/markdown", compiled)}
            disabled={loading || items.length === 0}
            title="Download the compiled markdown"
            className="text-[11px] font-bold uppercase tracking-wider border border-slate-700 hover:border-emerald-500/40 text-slate-300 hover:text-emerald-400 px-3.5 py-2 rounded-md disabled:opacity-40 transition-all"
          >
            Export .md
          </button>
          <button
            onClick={() => downloadBlob(safeFile(title, "html"), "text/html", renderNotebookHtml(items, composeOpts))}
            disabled={loading || items.length === 0}
            title="Download a self-contained dark-themed HTML notebook (works offline, shareable)"
            className="text-[11px] font-bold uppercase tracking-wider border border-violet-500/40 text-violet-300 hover:text-violet-200 hover:border-violet-400/60 px-3.5 py-2 rounded-md disabled:opacity-40 transition-all"
          >
            Export HTML notebook
          </button>
          <button onClick={onClose} className="ml-auto text-[11px] text-slate-500 hover:text-slate-300 px-2 py-2">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
