"use client";

import React from "react";

interface MarkdownPreviewProps {
  text: string;
  onWikiLink?: (title: string) => void;
  onTaskToggle?: (lineIndex: number, checked: boolean) => void;
}

// HTML-escape user content before injecting it into the rendered output.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Apply inline markdown after escaping. Order matters: code first so we don't
// process markup inside backticks, then [[wiki]] links, then regular
// [text](url), then bold / italic.
//
// Stashes use \x00<idx>\x00 as a sentinel — NUL bytes can't appear in user
// content via a textarea (HTML spec strips them on input) and esc() runs
// before stashing, so the placeholder is guaranteed unique. The original
// implementation used " <idx> " (digit-with-spaces), which silently collided
// with user content like "Step 5 done" once the doc had a few code spans or
// wiki links.
function inline(line: string): string {
  const placeholders: string[] = [];
  const stash = (html: string): string => {
    const idx = placeholders.length;
    placeholders.push(html);
    return `\x00${idx}\x00`;
  };

  let s = esc(line);

  // Inline code
  s = s.replace(/`([^`\n]+)`/g, (_m, c) => stash(
    `<code class="bg-slate-800 text-emerald-300 px-1 py-0.5 rounded text-[12px] font-mono">${c}</code>`
  ));

  // Wiki links → buttons. data-wiki carries the title for the delegated
  // click handler on the rendered output.
  s = s.replace(/\[\[([^\[\]\n]{1,200})\]\]/g, (_m, t) => {
    const title = String(t).trim();
    return stash(
      `<button data-wiki="${esc(title)}" class="text-emerald-400 hover:text-emerald-300 border-b border-emerald-500/30 hover:border-emerald-400">${esc(title)}</button>`
    );
  });

  // Standard [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
    if (!/^https?:\/\//i.test(url)) return stash(`<span>${esc(text)}</span>`);
    return stash(
      `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="text-sky-400 hover:text-sky-300 underline">${esc(text)}</a>`
    );
  });

  // Bold then italic. Match non-greedy.
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong class=\"text-slate-100\">$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  // Restore placeholders
  s = s.replace(/\x00(\d+)\x00/g, (_m, i) => placeholders[Number(i)]);
  return s;
}

// Block-level pass — handles headings, lists, code fences, blockquotes,
// horizontal rules. Whatever doesn't fit becomes a paragraph.
function renderBlocks(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^\s*```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(esc(lines[i]));
        i++;
      }
      i++; // consume closing fence
      out.push(`<pre class="bg-slate-900 border border-slate-800 rounded-md p-3 text-[12px] font-mono text-slate-200 overflow-x-auto"><code>${buf.join("\n")}</code></pre>`);
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const sizes: Record<number, string> = {
        1: "text-2xl font-bold text-slate-50 mt-6 mb-3",
        2: "text-xl font-bold text-slate-100 mt-5 mb-2",
        3: "text-lg font-bold text-slate-100 mt-4 mb-2",
        4: "text-base font-bold text-slate-200 mt-3 mb-1",
        5: "text-sm font-bold text-slate-200 uppercase tracking-wider mt-3 mb-1",
        6: "text-xs font-bold text-slate-300 uppercase tracking-wider mt-2 mb-1",
      };
      out.push(`<h${level} class="${sizes[level]}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*---+\s*$/.test(line)) {
      out.push(`<hr class="border-slate-800 my-3" />`);
      i++;
      continue;
    }

    // Blockquote
    if (/^\s*>\s/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(inline(lines[i].replace(/^\s*>\s?/, "")));
        i++;
      }
      out.push(`<blockquote class="border-l-2 border-slate-600 pl-3 my-2 text-slate-400 italic">${buf.join("<br />")}</blockquote>`);
      continue;
    }

    // Task list — has to come before the generic unordered-list handler since
    // `- [ ] x` would otherwise match `^[-*]\s+` and render as a plain bullet.
    // The data-task-line attribute carries the source-line index so the click
    // handler in the wrapper can flip the right line in the underlying
    // markdown.
    if (/^\s*[-*]\s+\[[ xX]\]\s/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+\[[ xX]\]\s/.test(lines[i])) {
        const m = lines[i].match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
        if (!m) break;
        const checked = m[1].toLowerCase() === "x";
        buf.push(
          `<li class="ml-1 flex items-start gap-2 list-none">` +
            `<input type="checkbox" data-task-line="${i}" ${checked ? "checked" : ""} ` +
              `class="mt-1 cursor-pointer accent-emerald-500 w-3.5 h-3.5 flex-shrink-0" />` +
            `<span class="${checked ? "line-through text-slate-500" : "text-slate-300"} flex-1">${inline(m[2])}</span>` +
          `</li>`
        );
        i++;
      }
      out.push(`<ul class="my-2 space-y-0.5">${buf.join("")}</ul>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        buf.push(`<li class="ml-5 list-disc">${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul class="my-2 text-slate-300 space-y-0.5">${buf.join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(`<li class="ml-5 list-decimal">${inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ol class="my-2 text-slate-300 space-y-0.5">${buf.join("")}</ol>`);
      continue;
    }

    // Blank line
    if (line.trim() === "") { i++; continue; }

    // Paragraph
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6}\s|\s*[-*]\s|\s*\d+\.\s|\s*>\s|\s*```|\s*---+\s*$)/.test(lines[i])) {
      buf.push(inline(lines[i]));
      i++;
    }
    out.push(`<p class="my-2 text-slate-300 leading-relaxed">${buf.join("<br />")}</p>`);
  }
  return out.join("\n");
}

export default function MarkdownPreview({ text, onWikiLink, onTaskToggle }: MarkdownPreviewProps) {
  // We render via dangerouslySetInnerHTML because we want inline code-block,
  // wiki-link, and task-checkbox nodes inline; all user-supplied content is
  // HTML-escaped above via esc() before any tag scaffolding. Each interactive
  // node (wiki button, task checkbox) carries its identifier on a data-
  // attribute and is picked up by the delegated click/change handlers below
  // so React state updates flow correctly.
  const html = React.useMemo(() => renderBlocks(text), [text]);

  // Click handler covers both wiki-link buttons and task-list checkboxes.
  // For checkboxes we read the data-task-line attribute and the post-click
  // `checked` state to compute the flip.
  const onClick = React.useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const wikiBtn = target.closest("[data-wiki]") as HTMLElement | null;
    if (wikiBtn && onWikiLink) {
      e.preventDefault();
      const title = wikiBtn.getAttribute("data-wiki") ?? "";
      if (title) onWikiLink(title);
      return;
    }
    if (target instanceof HTMLInputElement && target.type === "checkbox" && target.dataset.taskLine !== undefined) {
      const lineIdx = Number(target.dataset.taskLine);
      if (Number.isFinite(lineIdx) && onTaskToggle) {
        onTaskToggle(lineIdx, target.checked);
      }
    }
  }, [onWikiLink, onTaskToggle]);

  if (!text.trim()) {
    return (
      <div className="text-slate-600 italic text-sm">
        Preview will render here as you type. <code className="text-emerald-400">[[Doc Title]]</code> creates a wiki link.
      </div>
    );
  }

  return (
    <div
      className="prose prose-invert max-w-none text-sm"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
