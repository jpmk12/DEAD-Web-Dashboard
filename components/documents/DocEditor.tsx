"use client";

import { useEffect, useMemo, useRef, useState, KeyboardEvent } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import MarkdownPreview from "./MarkdownPreview";
import DocChatPanel from "./DocChatPanel";

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
  onChanged?: () => void;
  onDeleted?: () => void;
  onOpenByTitle?: (title: string) => void;
  onOpenById?: (id: string) => void;
}

type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";

const SAVE_DEBOUNCE_MS = 1200;

// Slash-command palette. `insert` is either a literal string or a function
// (used for date / time so the value is evaluated at insertion time, not at
// module load). `cursorOffset` is where the caret should land relative to the
// start of the inserted text — defaults to "end of insert" when omitted.
type SlashCommand = {
  id: string;
  label: string;
  insert: string | (() => string);
  cursorOffset?: number;
};
const SLASH_COMMANDS: SlashCommand[] = [
  { id: "h1",    label: "Heading 1",       insert: "# " },
  { id: "h2",    label: "Heading 2",       insert: "## " },
  { id: "h3",    label: "Heading 3",       insert: "### " },
  { id: "quote", label: "Quote",           insert: "> " },
  { id: "task",  label: "Task list item",  insert: "- [ ] " },
  { id: "list",  label: "Bullet list",     insert: "- " },
  { id: "ol",    label: "Numbered list",   insert: "1. " },
  { id: "code",  label: "Code block",      insert: "```\n\n```", cursorOffset: 4 },
  { id: "hr",    label: "Horizontal rule", insert: "\n---\n" },
  { id: "wiki",  label: "Wiki link",       insert: "[[]]",     cursorOffset: 2 },
  { id: "link",  label: "External link",   insert: "[](url)",  cursorOffset: 1 },
  { id: "today", label: "Today's date",    insert: () => new Date().toISOString().slice(0, 10) },
  { id: "now",   label: "Today + time",    insert: () => new Date().toISOString().slice(0, 16).replace("T", " ") },
];

// Look backward from `cursorPos` to find a slash-prefixed token at the start
// of a word. Returns `open: true` only when a / immediately follows whitespace
// or the document start — never matches paths like "https://" or "a/b".
function detectSlash(value: string, cursorPos: number): { open: boolean; query: string; pos: number } {
  let i = cursorPos - 1;
  while (i >= 0 && !/\s/.test(value[i])) i--;
  const start = i + 1;
  const token = value.substring(start, cursorPos);
  if (!token.startsWith("/")) return { open: false, query: "", pos: -1 };
  // Require start-of-doc or whitespace before the slash so URL paths don't trigger.
  if (start !== 0 && !/\s/.test(value[start - 1])) return { open: false, query: "", pos: -1 };
  return { open: true, query: token.slice(1), pos: start };
}

export default function DocEditor({ docId, onChanged, onDeleted, onOpenByTitle, onOpenById }: DocEditorProps) {
  const [doc, setDoc] = useState<DocFull | null>(null);
  const [backlinks, setBacklinks] = useState<BacklinkRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("clean");
  const [tagInput, setTagInput] = useState("");
  const [splitView, setSplitView] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [slashState, setSlashState] = useState<{ open: boolean; query: string; pos: number; selectedIdx: number }>({
    open: false, query: "", pos: -1, selectedIdx: 0,
  });

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<{ title: string; content: string }>({ title: "", content: "" });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setLoading(true);
    setSlashState({ open: false, query: "", pos: -1, selectedIdx: 0 });
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
    setDoc({ ...doc, title: v });
    latestRef.current.title = v;
    scheduleSave();
  };
  const updateContent = (v: string) => {
    if (!doc) return;
    setDoc({ ...doc, content: v });
    latestRef.current.content = v;
    scheduleSave();
  };

  // Restore caret + (optional) selection after React applies the new textarea
  // value. requestAnimationFrame waits one frame so the DOM reflects the
  // controlled-component update before we call setSelectionRange.
  const moveCursorTo = (pos: number, selectionEnd?: number) => {
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(pos, selectionEnd ?? pos);
    });
  };

  // Wrap the current selection in prefix/suffix (e.g. ** / *). If nothing's
  // selected, drops the markers around the caret and selects the empty middle
  // so the next keystroke replaces it.
  const wrapSelection = (prefix: string, suffix: string = prefix) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = ta.value.substring(start, end);
    const newValue = ta.value.substring(0, start) + prefix + selected + suffix + ta.value.substring(end);
    updateContent(newValue);
    moveCursorTo(start + prefix.length, start + prefix.length + selected.length);
  };

  const insertLinkAtSelection = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const sel = ta.value.substring(start, end);
    const inserted = `[${sel}](url)`;
    const newValue = ta.value.substring(0, start) + inserted + ta.value.substring(end);
    updateContent(newValue);
    // Select the "url" placeholder so the user can immediately paste/type.
    const urlStart = start + 1 + sel.length + 2;
    moveCursorTo(urlStart, urlStart + 3);
  };

  const applySlashCommand = (cmd: SlashCommand) => {
    const ta = textareaRef.current;
    if (!ta || !slashState.open) return;
    const insertText = typeof cmd.insert === "function" ? cmd.insert() : cmd.insert;
    const cursorOffset = cmd.cursorOffset ?? insertText.length;
    const before = ta.value.substring(0, slashState.pos);
    const tail = ta.value.substring(slashState.pos + 1 + slashState.query.length);
    const newValue = before + insertText + tail;
    updateContent(newValue);
    moveCursorTo(slashState.pos + cursorOffset);
    setSlashState({ open: false, query: "", pos: -1, selectedIdx: 0 });
  };

  // Filter commands by the current query (matches id prefix or label substring).
  const filteredCmds = useMemo(() => {
    if (!slashState.open) return [] as SlashCommand[];
    const q = slashState.query.toLowerCase();
    if (!q) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter((c) => c.id.startsWith(q) || c.label.toLowerCase().includes(q));
  }, [slashState.open, slashState.query]);

  const onContentInput = (v: string) => {
    updateContent(v);
    const ta = textareaRef.current;
    if (!ta) return;
    // Detect on the *new* value before React syncs the ref — selectionStart
    // on the live element is already at the post-input position.
    requestAnimationFrame(() => {
      const ta2 = textareaRef.current;
      if (!ta2) return;
      const result = detectSlash(ta2.value, ta2.selectionStart);
      setSlashState((prev) => {
        if (!result.open) return prev.open ? { open: false, query: "", pos: -1, selectedIdx: 0 } : prev;
        const sameWord = prev.open && prev.pos === result.pos;
        return { open: true, query: result.query, pos: result.pos, selectedIdx: sameWord ? prev.selectedIdx : 0 };
      });
    });
  };

  const onTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash-menu navigation when open: arrow keys / enter / tab / escape are
    // consumed by the menu, not by the textarea.
    if (slashState.open && filteredCmds.length > 0) {
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashState({ open: false, query: "", pos: -1, selectedIdx: 0 });
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashState((s) => ({ ...s, selectedIdx: Math.min(s.selectedIdx + 1, filteredCmds.length - 1) }));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashState((s) => ({ ...s, selectedIdx: Math.max(s.selectedIdx - 1, 0) }));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const cmd = filteredCmds[Math.min(slashState.selectedIdx, filteredCmds.length - 1)];
        if (cmd) applySlashCommand(cmd);
        return;
      }
    }

    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;
    if (e.key === "b") { e.preventDefault(); wrapSelection("**"); return; }
    if (e.key === "i") { e.preventDefault(); wrapSelection("*"); return; }
    if (e.key === "k") { e.preventDefault(); insertLinkAtSelection(); return; }
    // ⌘[ creates a wiki-link. Use the literal key — browsers also fire "{"
    // for shift+[ on some layouts, which we don't want.
    if (e.key === "[") { e.preventDefault(); wrapSelection("[[", "]]"); return; }
  };

  // Flip the `[ ]` ↔ `[x]` marker on the clicked task line. Line index is
  // derived from the rendered output, so it reflects the current content state.
  const onTaskToggle = (lineIdx: number, checked: boolean) => {
    if (!doc) return;
    const lines = doc.content.split("\n");
    if (lineIdx < 0 || lineIdx >= lines.length) return;
    const newLine = lines[lineIdx].replace(
      /^(\s*[-*]\s+)\[[ xX]\]/,
      `$1[${checked ? "x" : " "}]`
    );
    if (newLine === lines[lineIdx]) return;
    lines[lineIdx] = newLine;
    updateContent(lines.join("\n"));
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
              onClick={() => setChatOpen((v) => !v)}
              title={chatOpen ? "Close chat panel" : "Ask Claude about this doc"}
              className={`text-[10px] font-mono px-2 py-0.5 rounded transition-all border ${
                chatOpen
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                  : "text-slate-500 hover:text-slate-300 border-slate-700 hover:border-slate-500"
              }`}
            >
              💬 Ask
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

      {/* Editor / preview split, plus optional chat column on the right.
          Grid columns: editor [+ preview if split] [+ chat if open]. Each
          panel shares the row height; flex layout inside each cell scrolls
          independently. */}
      <div className={`flex-1 min-h-0 grid divide-x divide-slate-800 ${
        splitView && chatOpen ? "grid-cols-[1fr_1fr_minmax(320px,420px)]" :
        splitView             ? "grid-cols-2" :
        chatOpen              ? "grid-cols-[1fr_minmax(320px,420px)]" :
                                "grid-cols-1"
      }`}>
        {/* Editor pane is relative so the slash-command popover anchors here. */}
        <div className="relative h-full min-h-0">
          <textarea
            ref={textareaRef}
            value={doc.content}
            onChange={(e) => onContentInput(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            onBlur={() => {
              // Close the slash menu on blur, but defer so a mouseDown on a
              // menu entry has time to fire applySlashCommand first.
              setTimeout(() => setSlashState({ open: false, query: "", pos: -1, selectedIdx: 0 }), 120);
            }}
            spellCheck={false}
            placeholder={`# Heading
Markdown here. Shortcuts: ⌘B bold · ⌘I italic · ⌘K link · ⌘[ wiki-link
Type / for the command menu (/h2, /task, /code, /today, …)`}
            className="w-full h-full bg-slate-950 text-slate-200 placeholder-slate-700 font-mono text-sm p-5 outline-none resize-none leading-relaxed"
          />
          {slashState.open && filteredCmds.length > 0 && (
            <div className="absolute bottom-3 left-3 right-3 max-h-56 overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-20">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-slate-600 border-b border-slate-800 font-mono">
                /{slashState.query || "…"}
              </div>
              {filteredCmds.map((c, idx) => (
                <button
                  key={c.id}
                  // onMouseDown rather than onClick so the textarea's blur
                  // handler doesn't dismiss the menu before the click lands.
                  onMouseDown={(e) => { e.preventDefault(); applySlashCommand(c); }}
                  className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between ${
                    idx === slashState.selectedIdx
                      ? "bg-emerald-500/10 text-emerald-300"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <span>{c.label}</span>
                  <span className="text-[10px] text-slate-600 font-mono">/{c.id}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {splitView && (
          <div className="h-full overflow-y-auto p-5 bg-slate-900/40">
            <MarkdownPreview text={doc.content} onWikiLink={onOpenByTitle} onTaskToggle={onTaskToggle} />
          </div>
        )}
        {chatOpen && (
          // Key on docId so switching docs forces a clean panel — the chat
          // history is doc-scoped and shouldn't carry over.
          <DocChatPanel key={docId} docId={docId} docTitle={doc.title} onClose={() => setChatOpen(false)} />
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
