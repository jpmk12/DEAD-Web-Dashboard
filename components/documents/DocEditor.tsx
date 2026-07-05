"use client";

import { useEffect, useMemo, useRef, useState, KeyboardEvent } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import MarkdownPreview from "./MarkdownPreview";
import DocChatPanel from "./DocChatPanel";
import DocToolbar from "./DocToolbar";
import DocTOC from "./DocTOC";
import DocHistoryModal from "./DocHistoryModal";
import DocSplitModal from "./DocSplitModal";
import { useIsMobile } from "@/lib/useIsMobile";

interface DocFull {
  id: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  archived?: boolean;
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
  // Special-cased in applySlashCommand: opens the template picker instead of
  // inserting a literal (templates are docs tagged "template", fetched live).
  { id: "template", label: "Insert template…", insert: "" },
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
  const [tocOpen, setTocOpen] = useState(false);
  // On phones the multi-pane grid collapses to one full-width pane at a time,
  // chosen by a segmented switcher (the desktop toc/split/chat flags above
  // drive the side-by-side layout only at lg+).
  const isMobile = useIsMobile();
  const [mobilePane, setMobilePane] = useState<"editor" | "preview" | "toc" | "chat">("editor");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  // /template picker: insertion position captured when the slash command was
  // chosen; the list is docs tagged "template", fetched when the picker opens.
  const [tplPicker, setTplPicker] = useState<{ pos: number } | null>(null);
  const [templates, setTemplates] = useState<{ id: string; title: string }[] | null>(null);
  const [slashState, setSlashState] = useState<{ open: boolean; query: string; pos: number; selectedIdx: number }>({
    open: false, query: "", pos: -1, selectedIdx: 0,
  });
  const [findState, setFindState] = useState<{ open: boolean; query: string; replace: string; caseSensitive: boolean }>({
    open: false, query: "", replace: "", caseSensitive: false,
  });
  const findInputRef = useRef<HTMLInputElement>(null);

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

  // Toggle a line-prefix marker (e.g. "# ", "- ", "> "). If the cursor's
  // current line already starts with `prefix`, strip it. If it starts with
  // one of `alternatives`, swap it out for `prefix`. Otherwise insert.
  // Used by the toolbar so clicking H1 twice doesn't stack `# # heading`.
  const toggleLinePrefix = (prefix: string, alternatives: string[] = []) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const before = ta.value.substring(0, pos);
    const lineStart = before.lastIndexOf("\n") + 1;
    const lineEndRel = ta.value.substring(lineStart).indexOf("\n");
    const lineEnd = lineEndRel === -1 ? ta.value.length : lineStart + lineEndRel;
    const lineText = ta.value.substring(lineStart, lineEnd);

    let newLine: string;
    let cursorDelta: number;
    if (lineText.startsWith(prefix)) {
      newLine = lineText.slice(prefix.length);
      cursorDelta = -prefix.length;
    } else {
      const altMatch = alternatives.find((a) => lineText.startsWith(a));
      if (altMatch) {
        newLine = prefix + lineText.slice(altMatch.length);
        cursorDelta = prefix.length - altMatch.length;
      } else {
        newLine = prefix + lineText;
        cursorDelta = prefix.length;
      }
    }
    const newValue = ta.value.substring(0, lineStart) + newLine + ta.value.substring(lineEnd);
    updateContent(newValue);
    moveCursorTo(pos + cursorDelta);
  };

  // Drop literal text at the current cursor. `cursorOffset` lets callers
  // land the caret inside the insertion (e.g. between code-fence lines).
  const insertAtCursor = (text: string, cursorOffset?: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const newValue = ta.value.substring(0, pos) + text + ta.value.substring(pos);
    updateContent(newValue);
    moveCursorTo(pos + (cursorOffset ?? text.length));
  };

  // ─── Find / replace ──────────────────────────────────────────────────
  // No visual highlighting (would need an overlay div mirroring the textarea
  // — high-effort, not MVP-worthy). Instead, "Find next" jumps the cursor
  // selection to the next match, wrapping around at the end. Match search
  // honours the case-sensitive toggle but stays plain-text (no regex).
  const findNext = (fromPos?: number) => {
    const ta = textareaRef.current;
    if (!ta || !findState.query) return;
    const q = findState.caseSensitive ? findState.query : findState.query.toLowerCase();
    const hay = findState.caseSensitive ? ta.value : ta.value.toLowerCase();
    const start = fromPos ?? ta.selectionEnd;
    let idx = hay.indexOf(q, start);
    if (idx === -1) idx = hay.indexOf(q, 0); // wrap
    if (idx === -1) return;
    moveCursorTo(idx, idx + findState.query.length);
  };

  const replaceCurrent = () => {
    const ta = textareaRef.current;
    if (!ta || !findState.query) return;
    const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
    const matches = findState.caseSensitive
      ? sel === findState.query
      : sel.toLowerCase() === findState.query.toLowerCase();
    // Only replace if the current selection is in fact the match — otherwise
    // a stray click while the bar is open would replace unrelated text.
    if (!matches) {
      findNext();
      return;
    }
    const newValue =
      ta.value.substring(0, ta.selectionStart) +
      findState.replace +
      ta.value.substring(ta.selectionEnd);
    updateContent(newValue);
    const nextCursor = ta.selectionStart + findState.replace.length;
    moveCursorTo(nextCursor);
    // Auto-advance to the next match.
    setTimeout(() => findNext(nextCursor), 0);
  };

  const replaceAll = () => {
    const ta = textareaRef.current;
    if (!ta || !findState.query) return;
    if (findState.caseSensitive) {
      // Plain split-join — fast, no regex escaping concerns.
      const next = ta.value.split(findState.query).join(findState.replace);
      if (next !== ta.value) updateContent(next);
      return;
    }
    // Case-insensitive: build a regex with escaped query, preserve case via
    // simple replacement (no smart-casing — just substitute the literal).
    const escaped = findState.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const next = ta.value.replace(new RegExp(escaped, "gi"), findState.replace);
    if (next !== ta.value) updateContent(next);
  };

  const openFind = () => {
    setFindState((s) => ({ ...s, open: true }));
    // Pre-seed with the current selection if there is one.
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
        if (sel && sel.length < 100) {
          setFindState((s) => ({ ...s, query: sel }));
        }
      }
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  };
  const closeFind = () => {
    setFindState((s) => ({ ...s, open: false }));
    textareaRef.current?.focus();
  };

  const applySlashCommand = (cmd: SlashCommand) => {
    const ta = textareaRef.current;
    if (!ta || !slashState.open) return;
    // "/template" opens the picker instead of inserting text: strip the slash
    // token, remember where it sat, and fetch the template list.
    if (cmd.id === "template") {
      const before = ta.value.substring(0, slashState.pos);
      const tail = ta.value.substring(slashState.pos + 1 + slashState.query.length);
      updateContent(before + tail);
      setTplPicker({ pos: slashState.pos });
      setSlashState({ open: false, query: "", pos: -1, selectedIdx: 0 });
      if (templates === null) {
        fetch("/api/documents?tag=template")
          .then((r) => r.json())
          .then((d) => setTemplates(Array.isArray(d.docs) ? d.docs.map((x: { id: string; title: string }) => ({ id: x.id, title: x.title })) : []))
          .catch(() => setTemplates([]));
      }
      return;
    }
    const insertText = typeof cmd.insert === "function" ? cmd.insert() : cmd.insert;
    const cursorOffset = cmd.cursorOffset ?? insertText.length;
    const before = ta.value.substring(0, slashState.pos);
    const tail = ta.value.substring(slashState.pos + 1 + slashState.query.length);
    const newValue = before + insertText + tail;
    updateContent(newValue);
    moveCursorTo(slashState.pos + cursorOffset);
    setSlashState({ open: false, query: "", pos: -1, selectedIdx: 0 });
  };

  // Insert the chosen template's body at the position captured by /template.
  const insertTemplate = async (tplId: string) => {
    const at = tplPicker?.pos ?? textareaRef.current?.selectionStart ?? 0;
    setTplPicker(null);
    try {
      const res = await fetch(`/api/documents/${tplId}`);
      const data = await res.json();
      const body: string = data.doc?.content ?? "";
      if (!body) return;
      const ta = textareaRef.current;
      const cur = ta ? ta.value : (doc?.content ?? "");
      const pos = Math.min(at, cur.length);
      updateContent(cur.substring(0, pos) + body + cur.substring(pos));
      moveCursorTo(pos + body.length);
    } catch { /* ignore */ }
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
    if (e.key === "f") { e.preventDefault(); openFind(); return; }
    // ⌘[ creates a wiki-link. Use the literal key — browsers also fire "{"
    // for shift+[ on some layouts, which we don't want.
    if (e.key === "[") { e.preventDefault(); wrapSelection("[[", "]]"); return; }
  };

  // Move the textarea cursor to the start of the given source line. Used
  // by the TOC sidebar when the user clicks a heading. Also scrolls the
  // textarea so the line is roughly centred — textarea scroll math is
  // approximate (uses cached lineHeight read from computed style), good
  // enough for navigation purposes.
  const jumpToLine = (lineIdx: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const lines = ta.value.split("\n");
    if (lineIdx < 0 || lineIdx >= lines.length) return;
    let pos = 0;
    for (let i = 0; i < lineIdx; i++) pos += lines[i].length + 1;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    // Approximate vertical scroll: lineHeight * lineIdx - third of viewport.
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 22;
    const targetScroll = Math.max(0, lineHeight * lineIdx - ta.clientHeight / 3);
    ta.scrollTop = targetScroll;
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
    if (!confirm(`Delete "${doc.title}"? This can't be undone — use Archive (▢) if you want to hide it but keep it.`)) return;
    const res = await fetch(`/api/documents/${docId}`, { method: "DELETE" });
    if (res.ok) {
      onChanged?.();
      onDeleted?.();
    }
  };

  // Soft-delete toggle. Archived docs are excluded from default views and
  // from chat context, but stay restorable from the Archived smart view.
  const onToggleArchive = async () => {
    if (!doc) return;
    const nextArchived = !doc.archived;
    setDoc({ ...doc, archived: nextArchived });
    await fetch(`/api/documents/${docId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: nextArchived }),
    }).catch(() => {});
    onChanged?.();
    // Drop selection on archive so the editor exits cleanly — the doc is
    // gone from the default sidebar view it was opened from.
    if (nextArchived) onDeleted?.();
  };

  const updatedLabel = useMemo(() => {
    if (!doc) return "";
    try { return formatDistanceToNow(parseISO(doc.updatedAt), { addSuffix: true }); }
    catch { return ""; }
  }, [doc]);

  // Word count + estimated read time. Words = whitespace-separated runs of
  // non-space chars; close enough for narrative prose without needing a real
  // tokenizer. 200 wpm is the standard "comfortable adult reader" rate.
  const stats = useMemo(() => {
    if (!doc) return { words: 0, chars: 0, minutes: 0 };
    const text = doc.content;
    const words = (text.match(/\S+/g) ?? []).length;
    return {
      words,
      chars: text.length,
      minutes: Math.max(1, Math.round(words / 200)),
    };
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
            {/* Desktop pane toggles (side-by-side layout) */}
            <div className="hidden lg:flex items-center gap-2">
              <button
                onClick={() => setTocOpen((v) => !v)}
                title={tocOpen ? "Hide outline" : "Show outline (TOC)"}
                className={`text-[10px] font-mono px-2 py-0.5 rounded transition-all border ${
                  tocOpen
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                    : "text-slate-500 hover:text-slate-300 border-slate-700 hover:border-slate-500"
                }`}
              >
                ≣ TOC
              </button>
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
            </div>

            {/* Phone pane switcher — one full-width pane at a time */}
            <div className="flex lg:hidden items-center gap-0.5 rounded-md border border-slate-700 p-0.5">
              {([
                ["editor", "Edit"],
                ["preview", "View"],
                ["toc", "TOC"],
                ["chat", "Ask"],
              ] as const).map(([pane, label]) => (
                <button
                  key={pane}
                  onClick={() => setMobilePane(pane)}
                  className={`text-[10px] font-mono px-2 py-1 rounded transition-all touch-manipulation ${
                    mobilePane === pane
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setHistoryOpen(true)}
              title="Version history — snapshots are saved on edits, last 25 kept"
              className="text-[10px] font-mono text-slate-500 hover:text-slate-300 border border-slate-700 hover:border-slate-500 px-2 py-0.5 rounded transition-all"
            >
              📜 History
            </button>
            <button
              onClick={() => setSplitOpen(true)}
              title="Split at headings — break this doc into linked section docs (undoable via History)"
              className="text-[10px] font-mono text-slate-500 hover:text-slate-300 border border-slate-700 hover:border-slate-500 px-2 py-0.5 rounded transition-all"
            >
              ✂ Split
            </button>
            <a
              href={`/api/documents/${docId}/export`}
              download
              title="Export this doc as markdown (.md) with YAML frontmatter"
              className="text-[10px] font-mono text-slate-500 hover:text-slate-300 border border-slate-700 hover:border-slate-500 px-2 py-0.5 rounded transition-all"
            >
              ⬇ MD
            </a>
            <button
              onClick={onToggleArchive}
              title={doc.archived ? "Restore from archive" : "Archive — soft-delete (restore from the Archived view in the sidebar)"}
              className={`text-base transition-colors ${doc.archived ? "text-emerald-400 hover:text-emerald-300" : "text-slate-600 hover:text-slate-300"}`}
            >
              {doc.archived ? "↺" : "▢"}
            </button>
            <button
              onClick={onDelete}
              title="Delete (permanent)"
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

      {/* Layout columns, in order from left to right:
          [TOC if open] · editor · [preview if split] · [chat if open].
          The TOC column is fixed-width on the left; editor + optional
          preview share the centre as 1fr each; chat docks on the right
          with min/max constraints to stay readable. */}
      <div className={`flex-1 min-h-0 grid divide-x divide-slate-800 ${
        isMobile ? "grid-cols-1" :
        tocOpen && splitView && chatOpen ? "grid-cols-[minmax(160px,200px)_1fr_1fr_minmax(320px,420px)]" :
        tocOpen && splitView             ? "grid-cols-[minmax(160px,200px)_1fr_1fr]" :
        tocOpen && chatOpen              ? "grid-cols-[minmax(160px,200px)_1fr_minmax(320px,420px)]" :
        tocOpen                          ? "grid-cols-[minmax(160px,200px)_1fr]" :
        splitView && chatOpen            ? "grid-cols-[1fr_1fr_minmax(320px,420px)]" :
        splitView                        ? "grid-cols-2" :
        chatOpen                         ? "grid-cols-[1fr_minmax(320px,420px)]" :
                                           "grid-cols-1"
      }`}>
        {(isMobile ? mobilePane === "toc" : tocOpen) && (
          <DocTOC text={doc.content} onJumpToLine={jumpToLine} onClose={() => setTocOpen(false)} />
        )}
        {/* Editor pane is relative so the slash-command popover anchors here.
            DocToolbar sits at the top of the column; the textarea fills the
            remaining height via flex. */}
        <div className={`relative h-full min-h-0 flex flex-col ${isMobile && mobilePane !== "editor" ? "hidden" : ""}`}>
          <DocToolbar
            onBold       ={() => wrapSelection("**")}
            onItalic     ={() => wrapSelection("*")}
            onInlineCode ={() => wrapSelection("`")}
            onHeading    ={(level) => {
              // Headings toggle between levels rather than stacking — clicking
              // H2 on a line that already starts with `# ` swaps it.
              const prefixes = { 1: "# ", 2: "## ", 3: "### " } as const;
              const all: string[] = ["# ", "## ", "### ", "#### ", "##### ", "###### "];
              toggleLinePrefix(prefixes[level], all.filter((p) => p !== prefixes[level]));
            }}
            onUnorderedList ={() => toggleLinePrefix("- ",     ["* ", "1. "])}
            onOrderedList   ={() => toggleLinePrefix("1. ",    ["- ", "* "])}
            onTaskList      ={() => toggleLinePrefix("- [ ] ", ["- ", "* ", "- [x] ", "- [X] "])}
            onQuote         ={() => toggleLinePrefix("> ")}
            onCodeBlock     ={() => insertAtCursor("```\n\n```", 4)}
            onRule          ={() => insertAtCursor("\n---\n")}
            onLink          ={insertLinkAtSelection}
            onWikiLink      ={() => wrapSelection("[[", "]]")}
          />
          {findState.open && (
            <div className="border-b border-slate-800 bg-slate-900/80 px-3 py-1.5 flex items-center gap-2 text-xs">
              <input
                ref={findInputRef}
                value={findState.query}
                onChange={(e) => setFindState((s) => ({ ...s, query: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); findNext(); }
                  if (e.key === "Escape") { e.preventDefault(); closeFind(); }
                }}
                placeholder="Find"
                className="flex-1 min-w-0 bg-slate-950 border border-slate-800 focus:border-emerald-500/40 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-700 outline-none"
              />
              <input
                value={findState.replace}
                onChange={(e) => setFindState((s) => ({ ...s, replace: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); replaceCurrent(); }
                  if (e.key === "Escape") { e.preventDefault(); closeFind(); }
                }}
                placeholder="Replace"
                className="flex-1 min-w-0 bg-slate-950 border border-slate-800 focus:border-emerald-500/40 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-700 outline-none"
              />
              <button
                type="button"
                onClick={() => setFindState((s) => ({ ...s, caseSensitive: !s.caseSensitive }))}
                title="Case sensitive"
                className={`text-[10px] font-mono font-bold w-9 h-9 lg:w-7 lg:h-7 rounded transition-all border ${
                  findState.caseSensitive
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                    : "text-slate-500 border-slate-700 hover:text-slate-300 hover:border-slate-500"
                }`}
              >
                Aa
              </button>
              <button
                type="button"
                onClick={() => findNext()}
                disabled={!findState.query}
                title="Find next (Enter)"
                className="text-[10px] font-bold uppercase tracking-wider bg-slate-800/80 hover:bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 px-2 py-1 rounded transition-all disabled:opacity-40"
              >
                Next
              </button>
              <button
                type="button"
                onClick={replaceCurrent}
                disabled={!findState.query}
                title="Replace current match"
                className="text-[10px] font-bold uppercase tracking-wider bg-slate-800/80 hover:bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 px-2 py-1 rounded transition-all disabled:opacity-40"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={replaceAll}
                disabled={!findState.query}
                title="Replace all"
                className="text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 hover:text-amber-300 px-2 py-1 rounded transition-all disabled:opacity-40"
              >
                All
              </button>
              <button
                type="button"
                onClick={closeFind}
                title="Close (Esc)"
                className="text-slate-600 hover:text-slate-300 w-9 h-9 lg:w-6 lg:h-6 flex items-center justify-center text-lg leading-none rounded hover:bg-slate-800 transition-all"
              >
                ×
              </button>
            </div>
          )}
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
            className="w-full flex-1 min-h-0 bg-slate-950 text-slate-200 placeholder-slate-700 font-mono text-sm p-5 outline-none resize-none leading-relaxed"
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
          {/* /template picker — lists docs tagged "template"; picking one
              inserts its body at the captured position. */}
          {tplPicker && (
            <div className="absolute bottom-3 left-3 right-3 max-h-56 overflow-y-auto bg-slate-900 border border-violet-500/40 rounded-lg shadow-2xl z-20">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-violet-300 border-b border-slate-800 font-mono flex items-center justify-between">
                <span>Insert template</span>
                <button onMouseDown={(e) => { e.preventDefault(); setTplPicker(null); }} className="text-slate-500 hover:text-slate-300">×</button>
              </div>
              {templates === null && (
                <p className="px-3 py-2 text-xs text-slate-500">Loading…</p>
              )}
              {templates !== null && templates.length === 0 && (
                <p className="px-3 py-2 text-[11px] text-slate-500 leading-relaxed">
                  No templates yet — tag any doc <span className="text-violet-300 font-mono">template</span> to
                  list it here, or use the New ▾ menu&apos;s starter set.
                </p>
              )}
              {(templates ?? []).map((t) => (
                <button
                  key={t.id}
                  onMouseDown={(e) => { e.preventDefault(); insertTemplate(t.id); }}
                  className="w-full text-left px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-violet-300"
                >
                  {t.title}
                </button>
              ))}
            </div>
          )}
        </div>
        {(isMobile ? mobilePane === "preview" : splitView) && (
          <div className="h-full overflow-y-auto p-5 bg-slate-900/40">
            <MarkdownPreview text={doc.content} onWikiLink={onOpenByTitle} onTaskToggle={onTaskToggle} />
          </div>
        )}
        {(isMobile ? mobilePane === "chat" : chatOpen) && (
          // Key on docId so switching docs forces a clean panel — the chat
          // history is doc-scoped and shouldn't carry over.
          <DocChatPanel key={docId} docId={docId} docTitle={doc.title} onClose={() => setChatOpen(false)} />
        )}
      </div>

      {/* Stats strip: word count + read time. Always rendered (even on an
          empty doc) so the user has a stable footer anchor. */}
      <div className="border-t border-slate-800 px-5 py-1.5 bg-slate-950 flex items-center justify-end gap-3 text-[10px] font-mono text-slate-600">
        <span>{stats.words.toLocaleString()} word{stats.words === 1 ? "" : "s"}</span>
        <span className="text-slate-800">·</span>
        <span>{stats.chars.toLocaleString()} chars</span>
        {stats.words > 0 && (
          <>
            <span className="text-slate-800">·</span>
            <span>~{stats.minutes} min read</span>
          </>
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

      <DocHistoryModal
        open={historyOpen}
        docId={docId}
        onClose={() => setHistoryOpen(false)}
        onRestored={() => {
          // Force the editor to refetch the active doc after restore so the
          // textarea / preview reflect the restored content.
          setDoc(null);
          setLoading(true);
          fetch(`/api/documents/${docId}`)
            .then((r) => r.json())
            .then((data) => {
              setDoc(data.doc ?? null);
              latestRef.current = { title: data.doc?.title ?? "", content: data.doc?.content ?? "" };
              setSaveState("clean");
            })
            .catch(() => setDoc(null))
            .finally(() => setLoading(false));
          onChanged?.();
        }}
      />

      {splitOpen && doc && (
        <DocSplitModal
          docId={docId}
          title={doc.title}
          content={doc.content}
          tags={doc.tags}
          onClose={() => setSplitOpen(false)}
          onDone={(newMaster) => {
            // The modal already PATCHed the master server-side; sync the
            // editor's local state so a pending autosave can't clobber it.
            setSplitOpen(false);
            setDoc((d) => (d ? { ...d, content: newMaster } : d));
            latestRef.current.content = newMaster;
            setSaveState("clean");
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
