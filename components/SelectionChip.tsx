"use client";

import { useEffect, useState } from "react";
import { openAppend } from "@/lib/appendClient";

// "Select text anywhere → ⧉ Append to…" (REVIEW-2026-10 §9 D4, decision 2).
// One `selectionchange` listener in the shell; a floating chip above the
// selection when it is real text (≥ 12 characters, outside inputs and the
// editor's textarea). The chip carries the active tab as the source and the
// nearest link as the source URL. Nothing else is global.

const MIN_CHARS = 12;

export default function SelectionChip() {
  const [chip, setChip] = useState<{ x: number; y: number; text: string; url?: string; title?: string } | null>(null);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const compute = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setChip(null); return; }
      const text = sel.toString().replace(/\s+/g, " ").trim();
      if (text.length < MIN_CHARS) { setChip(null); return; }
      const range = sel.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const el = (node.nodeType === 1 ? node : node.parentElement) as HTMLElement | null;
      if (!el) { setChip(null); return; }
      // Not inside an input, a textarea, the editor, or a dialog.
      if (el.closest("input, textarea, [contenteditable=true], [role=dialog], [data-no-append]")) { setChip(null); return; }
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) { setChip(null); return; }
      const a = el.closest("a[href^='http']") as HTMLAnchorElement | null;
      const card = el.closest("article, [data-title]") as HTMLElement | null;
      const title = card?.getAttribute("data-title") ?? card?.querySelector("h2, h3")?.textContent?.trim() ?? undefined;
      setChip({ x: Math.min(window.innerWidth - 150, Math.max(8, rect.left + rect.width / 2 - 70)), y: Math.max(8, rect.top - 34), text: text.slice(0, 4000), url: a?.href, title: title?.slice(0, 200) });
    };
    const onChange = () => { if (t) clearTimeout(t); t = setTimeout(compute, 180); };
    const onScroll = () => setChip(null);
    document.addEventListener("selectionchange", onChange);
    window.addEventListener("scroll", onScroll, true);
    return () => { document.removeEventListener("selectionchange", onChange); window.removeEventListener("scroll", onScroll, true); if (t) clearTimeout(t); };
  }, []);

  if (!chip) return null;
  const tab = typeof document !== "undefined" ? document.body.getAttribute("data-tab") ?? "" : "";
  const source = `selection${tab ? ` on ${tab[0].toUpperCase()}${tab.slice(1)}` : ""}`;
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onClick={() => { openAppend({ text: chip.text, source, sourceUrl: chip.url, sourceTitle: chip.title }); setChip(null); }}
      style={{ left: chip.x, top: chip.y }}
      className="fixed z-[65] inline-flex items-center gap-1.5 rounded-full border border-emerald-500/60 bg-slate-900 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300 shadow-2xl hover:bg-slate-800"
      title="Append the selected text to a running log"
    >
      ⧉ Append to…
    </button>
  );
}
