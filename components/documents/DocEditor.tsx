"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import MarkdownPreview from "./MarkdownPreview";

interface DocFull {
  id: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

interface BacklinkRef {
  id: string;
  title: string;
  updatedAt: string;
}

interface DocEditorProps {
  docId: string;
  onChanged?: () => void;       // sidebar should refetch list
  onDeleted?: () => void;       // clear selection
  onOpenByTitle?: (title: string) => void;  // wiki-link click
  onOpenById?: (id: string) => void;        // backlink click
}

type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";

// Auto-save is debounced 1.2 s after the last keystroke. Title and content
// share one save call; tags and pin fire immediately on toggle.
const SAVE_DEBOUNCE_MS = 1200;

export default function DocEditor({ docId, onChanged, onDeleted, onOpenByTitle, onOpenById }: DocEditorProps) {
  const [doc, setDoc] = useState<DocFull | null>(null);
  const [backlinks, setBacklinks] = useState<BacklinkRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("clean");
  const [tagInput, setTagInput] = useState("");
  const [splitView, setSplitView] = useState(true);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<{ title: string; content: string }>({ title: "", content: "" });

  // Load the doc + its backlinks whenever the selection changes.
  useEffect(() => {
    setLoading(true);
    fetch(`/api/documents/${docId}`)
      .then((r) => r.json())
      .then((data) => {
        setDoc(data.doc ?? null);
        const bl: BacklinkRef[] = (data.backlinks ?? []).map((d: DocFull) => ({
          id: d.id, title: d.title, updatedAt: d.updatedAt,
        }));
        setBacklinks(bl);
        latestRef.current = { title: data.doc?.title ?? "", content: data.doc?.content ?? "" };
        setSaveState("clean");
      })
      .catch(() => setDoc(null))
      .finally(() => setLoading(false));

    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [docId]);

  // Push a debounced PATCH whenever title/content changes locally.
  const scheduleSave = () => {
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState("saving");
      try {
        const res = await fetch(`/api/documents/${docId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(latestRef.current),
        });
        if (!res.ok) throw new Error("save failed");
        setSaveState("saved");
        onChanged?.();
        setTimeout(() => setSaveState((s) => (s === "saved" ? "clean" : s)), 1200);
      } catch {
        setSaveState("error");
      }
    }, SAVE_DEBOUNCE_MS);
  };

  const updateTitle = (v: string) => {
    if (!doc) return;
    const next = { ...doc, title: v };
    setDoc(next);
    latestRef.current.title = v;
    scheduleSave();
  };
  const updateContent = (v: string) => {
    if (!doc) return;
    const next = { ...doc, content: v };
    setDoc(next);
    latestRef.current.content = v;
    scheduleSave();
  };

  const togglePinned = async () => {
    if (!doc) return;
    const next = !doc.pinned;
    setDoc({ ...doc, pinned: next });
    await fetch(`/api/documents/${docId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: next }),
    }).catch(() => {});
    onChanged?.();
  };

  const addTag = async () => {
    const t = tagInput.trim();
    if (!doc || !t || doc.tags.includes(t)) return;
    const tags = [...doc.tags, t].slice(0, 20);
    setDoc({ ...doc, tags });
    setTagInput("");
    await fetch(`/api/documents/${docId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    }).catch(() => {});
    onChanged?.();
  };
  const removeTag = async (t: string) => {
    if (!doc) return;
    const tags = doc.tags.filter((x) => x !== t);
    setDoc({ ...doc, tags });
    await fetch(`/api/documents/${docId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    }).catch(() => {});
    onChanged?.();
  };

  const onDelete = async () => {
    if (!doc) return;
    if (!confirm(`Delete "${doc.title}"? This can't be undone.`)) return;
    const res = await fetch(`/api/documents/${docId}`, { method: "DELETE" });
    if (res.ok) {
      onChanged?.();
      onDeleted?.();
    }
  };

  const updatedLabel = useMemo(() => {
    if (!doc) return "";
    try { return formatDistanceToNow(parseISO(doc.updatedAt), { addSuffix: true }); }
    catch { return ""; }
  }, [doc]);

  if (loading || !doc) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-600 text-sm font-mono">
        {loading ? "Loading…" : "Document not found"}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header strip — title, pin, save state, view toggle, delete */}
      <div className="border-b border-slate-800 px-5 py-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={togglePinned}
            title={doc.pinned ? "Unpin" : "Pin"}
            className={`text-base transition-colors ${doc.pinned ? "text-amber-400 hover:text-amber-300" : "text-slate-600 hover:text-amber-400"}`}
          >
            {doc.pinned ? "★" : "☆"}
          </button>
          <input
            value={doc.title}
            onChange={(e) => updateTitle(e.target.value)}
            placeholder="Untitled"
            className="flex-1 bg-transparent text-lg font-bold text-slate-100 placeholder-slate-700 outline-none"
          />
          <div className="flex-shrink-0 flex items-center gap-2">
            <span className={`text-[10px] font-mono ${
              saveState === "error" ? "text-red-400" :
              saveState === "saving" || saveState === "dirty" ? "text-slate-500" :
              saveState === "saved" ? "text-emerald-400" : "text-slate-700"
            }`}>
              {saveState === "saving" ? "Saving…" :
               saveState === "dirty"  ? "Editing…" :
               saveState === "saved"  ? "✓ Saved" :
               saveState === "error"  ? "✗ Save failed" :
               updatedLabel ? `Updated ${updatedLabel}` : ""}
            </span>
            <button
              onClick={() => setSplitView((v) => !v)}
              title={splitView ? "Editor only" : "Split view"}
              className="text-[10px] font-mono text-slate-500 hover:text-slate-300 border border-slate-700 hover:border-slate-500 px-2 py-0.5 rounded transition-all"
            >
              {splitView ? "◫ Split" : "▭ Edit"}
            </button>
            <button
              onClick={onDelete}
              title="Delete"
              className="text-slate-600 hover:text-red-400 text-base transition-colors"
            >
              🗑
            </button>
          </div>
        </div>

        {/* Tags row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {doc.tags.map((t) => (
            <span key={t} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-300 border border-violet-500/30">
              {t}
              <button onClick={() => removeTag(t)} className="opacity-60 hover:opacity-100 leading-none">×</button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); }
            }}
            onBlur={addTag}
            placeholder={doc.tags.length === 0 ? "+ tag" : ""}
            className="min-w-[80px] flex-shrink-0 bg-transparent text-[11px] text-slate-300 placeholder-slate-700 outline-none"
          />
        </div>
      </div>

      {/* Editor / preview split */}
      <div className={`flex-1 min-h-0 ${splitView ? "grid grid-cols-2 divide-x divide-slate-800" : ""}`}>
        <textarea
          value={doc.content}
          onChange={(e) => updateContent(e.target.value)}
          spellCheck={false}
          placeholder="# Heading
Markdown here. Use **bold**, *italic*, `code`, [[Other Doc]] for wiki links, [text](url) for external."
          className="w-full h-full bg-slate-950 text-slate-200 placeholder-slate-700 font-mono text-sm p-5 outline-none resize-none leading-relaxed"
        />
        {splitView && (
          <div className="h-full overflow-y-auto p-5 bg-slate-900/40">
            <MarkdownPreview text={doc.content} onWikiLink={onOpenByTitle} />
          </div>
        )}
      </div>

      {/* Backlinks footer */}
      {backlinks.length > 0 && (
        <div className="border-t border-slate-800 px-5 py-3 bg-slate-900/40">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
            ← Linked from ({backlinks.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {backlinks.map((b) => (
              <button
                key={b.id}
                onClick={() => onOpenById?.(b.id)}
                className="text-[11px] px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-emerald-500/40 text-slate-300 hover:text-emerald-400 transition-all"
              >
                {b.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
