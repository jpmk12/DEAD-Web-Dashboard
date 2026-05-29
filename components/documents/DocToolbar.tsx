"use client";

import { useState, useRef, useEffect } from "react";

interface DocToolbarProps {
  onBold: () => void;
  onItalic: () => void;
  onInlineCode: () => void;
  onHeading: (level: 1 | 2 | 3) => void;
  onUnorderedList: () => void;
  onOrderedList: () => void;
  onTaskList: () => void;
  onQuote: () => void;
  onCodeBlock: () => void;
  onRule: () => void;
  onLink: () => void;
  onWikiLink: () => void;
}

// Visible markdown affordances above the textarea. Surfaces the same actions
// the keyboard shortcuts and slash menu cover so the user doesn't need to
// memorize them — and so a fresh user can format a doc without ever leaving
// the mouse. Buttons are intentionally compact: 11px Unicode glyphs with
// title attributes carrying the shortcut hint.
//
// The `?` button on the right opens a cheatsheet popover with the underlying
// markdown patterns so users learn the syntax as they go.
export default function DocToolbar(props: DocToolbarProps) {
  const [cheatOpen, setCheatOpen] = useState(false);
  const cheatBtnRef = useRef<HTMLDivElement>(null);

  // Close the cheatsheet on outside click.
  useEffect(() => {
    if (!cheatOpen) return;
    const handler = (e: MouseEvent) => {
      if (cheatBtnRef.current && !cheatBtnRef.current.contains(e.target as Node)) {
        setCheatOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [cheatOpen]);

  const btn = "h-7 min-w-[28px] px-1.5 flex items-center justify-center text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded transition-all text-[12px] font-mono";
  const divider = <span className="w-px h-4 bg-slate-800 mx-0.5 self-center" />;

  return (
    <div className="border-b border-slate-800 bg-slate-950/60 px-3 py-1 flex items-center gap-0.5 flex-wrap relative">
      <button type="button" onClick={props.onBold}       title="Bold (⌘B)"        className={`${btn} font-bold`}>B</button>
      <button type="button" onClick={props.onItalic}     title="Italic (⌘I)"      className={`${btn} italic`}>I</button>
      <button type="button" onClick={props.onInlineCode} title="Inline code"      className={btn}>{"<>"}</button>

      {divider}

      <button type="button" onClick={() => props.onHeading(1)} title="Heading 1" className={`${btn} font-bold`}>H1</button>
      <button type="button" onClick={() => props.onHeading(2)} title="Heading 2" className={`${btn} font-bold`}>H2</button>
      <button type="button" onClick={() => props.onHeading(3)} title="Heading 3" className={`${btn} font-bold`}>H3</button>

      {divider}

      <button type="button" onClick={props.onUnorderedList} title="Bullet list"   className={btn}>•</button>
      <button type="button" onClick={props.onOrderedList}   title="Numbered list" className={btn}>1.</button>
      <button type="button" onClick={props.onTaskList}      title="Task list"     className={btn}>☐</button>

      {divider}

      <button type="button" onClick={props.onQuote}     title="Blockquote"      className={btn}>{`"`}</button>
      <button type="button" onClick={props.onCodeBlock} title="Code block"      className={btn}>{`{ }`}</button>
      <button type="button" onClick={props.onRule}      title="Horizontal rule" className={btn}>—</button>

      {divider}

      <button type="button" onClick={props.onLink}     title="External link (⌘K)" className={btn}>🔗</button>
      <button type="button" onClick={props.onWikiLink} title="Wiki link (⌘[)"    className={btn}>{"[[ ]]"}</button>

      <span className="flex-1" />

      <div ref={cheatBtnRef} className="relative">
        <button
          type="button"
          onClick={() => setCheatOpen((v) => !v)}
          title="Markdown cheatsheet"
          className={`${btn} ${cheatOpen ? "text-emerald-400 bg-slate-800" : ""}`}
        >
          ?
        </button>
        {cheatOpen && (
          <div className="absolute top-8 right-0 z-30 w-80 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-3 text-[11px] text-slate-300">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Markdown cheatsheet</p>
            <table className="w-full">
              <tbody>
                <tr><td className="py-0.5 pr-3 text-slate-500"># H1 / ## H2 / ### H3</td><td className="text-slate-400">Headings</td></tr>
                <tr><td className="py-0.5 pr-3 font-mono">**bold**</td><td className="text-slate-400">Bold</td></tr>
                <tr><td className="py-0.5 pr-3 font-mono">*italic*</td><td className="text-slate-400">Italic</td></tr>
                <tr><td className="py-0.5 pr-3 font-mono">`code`</td><td className="text-slate-400">Inline code</td></tr>
                <tr><td className="py-0.5 pr-3 font-mono">- item</td><td className="text-slate-400">Bullet list</td></tr>
                <tr><td className="py-0.5 pr-3 font-mono">1. item</td><td className="text-slate-400">Numbered list</td></tr>
                <tr><td className="py-0.5 pr-3 font-mono">- [ ] todo</td><td className="text-slate-400">Task (clickable)</td></tr>
                <tr><td className="py-0.5 pr-3 font-mono">{`> quote`}</td><td className="text-slate-400">Blockquote</td></tr>
                <tr><td className="py-0.5 pr-3 font-mono">---</td><td className="text-slate-400">Horizontal rule</td></tr>
                <tr><td className="py-0.5 pr-3 font-mono">[text](url)</td><td className="text-slate-400">External link</td></tr>
                <tr><td className="py-0.5 pr-3 font-mono">{`[[Doc Title]]`}</td><td className="text-slate-400">Wiki link</td></tr>
                <tr><td className="py-0.5 pr-3 font-mono">```code```</td><td className="text-slate-400">Code block</td></tr>
              </tbody>
            </table>
            <p className="mt-2 pt-2 border-t border-slate-800 text-[10px] text-slate-600">
              Shortcuts: <span className="font-mono">⌘B</span> bold · <span className="font-mono">⌘I</span> italic ·{" "}
              <span className="font-mono">⌘K</span> link · <span className="font-mono">⌘[</span> wiki-link ·{" "}
              <span className="font-mono">/</span> for command menu
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
