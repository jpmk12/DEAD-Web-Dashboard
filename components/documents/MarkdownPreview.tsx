"use client";

import React from "react";
import { parseWikiInner, RELATION_GLYPHS, RELATION_CLASSES, type LinkRelation } from "@/lib/linkRelations";
import { parseThreadTrace, type TraceStop } from "@/lib/threadTrace";

interface MarkdownPreviewProps {
  text: string;
  onWikiLink?: (title: string) => void;
  onTaskToggle?: (lineIndex: number, checked: boolean) => void;
  // The doc's type; "thread" docs render their Trace list as a timeline.
  docType?: string;
}

// ─── Hover-preview data layer ────────────────────────────────────────────────
// Module-level caches shared by every preview instance: the title/alias index
// (one light fetch, 5-min TTL) and per-doc preview payloads. Hovering the same
// link twice costs nothing.

interface TitleIndexEntry { id: string; title: string; aliases: string[] }
let titleIndex: { at: number; docs: TitleIndexEntry[] } | null = null;
let titleIndexInflight: Promise<TitleIndexEntry[]> | null = null;

async function getTitleIndex(): Promise<TitleIndexEntry[]> {
  if (titleIndex && Date.now() - titleIndex.at < 5 * 60 * 1000) return titleIndex.docs;
  if (titleIndexInflight) return titleIndexInflight;
  titleIndexInflight = fetch("/api/documents/titles")
    .then((r) => r.json())
    .then((d) => {
      const docs: TitleIndexEntry[] = Array.isArray(d.docs) ? d.docs : [];
      titleIndex = { at: Date.now(), docs };
      return docs;
    })
    .catch(() => titleIndex?.docs ?? [])
    .finally(() => { titleIndexInflight = null; });
  return titleIndexInflight;
}

interface DocPreviewData { title: string; excerpt: string; tags: string[] }
const previewCache = new Map<string, DocPreviewData>();

// Rough prose-ification of markdown for the excerpt: drop headings markers,
// emphasis, wiki brackets (keeping titles), code ticks.
function excerptOf(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[\[([^\[\]|]+)(?:\|[^\[\]]*)?\]\]/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

// Resolve a wiki name (title OR alias, case-insensitive) to a preview payload.
async function previewByName(name: string): Promise<DocPreviewData | null> {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  const idx = await getTitleIndex();
  const hit =
    idx.find((d) => d.title.trim().toLowerCase() === key) ??
    idx.find((d) => (d.aliases ?? []).some((a) => a.trim().toLowerCase() === key));
  if (!hit) return null;
  const cached = previewCache.get(hit.id);
  if (cached) return cached;
  try {
    const res = await fetch(`/api/documents/${hit.id}`);
    const data = await res.json();
    if (!data.doc) return null;
    const p: DocPreviewData = {
      title: data.doc.title ?? hit.title,
      excerpt: excerptOf(data.doc.content ?? ""),
      tags: Array.isArray(data.doc.tags) ? data.doc.tags.slice(0, 4) : [],
    };
    previewCache.set(hit.id, p);
    return p;
  } catch {
    return null;
  }
}

interface HoverState {
  top: number;
  left: number;
  name: string;
  relation: string | null;
  note: string | null;
  data: DocPreviewData | null; // null = loading or unresolved
  resolved: boolean;
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
  // click handler; data-rel / data-note carry the typed-link metadata from
  // [[Title | relation: note]] for the relation chip + hover card. Only the
  // title renders as prose — relation shows as a superscript glyph.
  s = s.replace(/\[\[([^\[\]\n]{1,300})\]\]/g, (_m, t) => {
    const ref = parseWikiInner(String(t));
    const relChip = ref.relation
      ? `<sup class="ml-0.5 px-1 rounded border text-[9px] font-bold align-super ${RELATION_CLASSES[ref.relation as LinkRelation]}" title="${esc(ref.relation)}${ref.note ? ` — ${esc(ref.note)}` : ""}">${RELATION_GLYPHS[ref.relation as LinkRelation]}</sup>`
      : "";
    return stash(
      `<button data-wiki="${esc(ref.title)}"${ref.relation ? ` data-rel="${esc(ref.relation)}"` : ""}${ref.note ? ` data-note="${esc(ref.note)}"` : ""} class="text-emerald-400 hover:text-emerald-300 border-b border-emerald-500/30 hover:border-emerald-400">${esc(ref.title)}${relChip}</button>`
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

// Timeline HTML for a 🧵 thread doc's Trace list: numbered stops on a rail,
// clickable wiki buttons, relation chips, glosses. All user text escaped.
function threadTimelineHtml(stops: TraceStop[]): string {
  const items = stops.map((s, i) => {
    const relChip = s.relation
      ? `<span class="text-[9px] font-bold px-1 rounded border align-middle ml-1.5 ${RELATION_CLASSES[s.relation]}">${RELATION_GLYPHS[s.relation]} ${esc(s.relation)}</span>`
      : "";
    const head = s.title
      ? `<button data-wiki="${esc(s.title)}" class="text-violet-300 hover:text-violet-200 font-semibold text-[13px]">${esc(s.title)}</button>${relChip}`
      : `<span class="text-slate-200 font-semibold text-[13px]">${esc(s.gloss)}</span>`;
    const gloss = s.title && (s.gloss || s.note)
      ? `<div class="text-xs text-slate-400 leading-relaxed mt-0.5">${inline(s.gloss || s.note || "")}</div>`
      : "";
    return (
      `<div class="relative bg-slate-900/60 border border-slate-800 rounded-lg px-3.5 py-2.5">` +
        `<span class="absolute -left-[28px] top-3.5 w-3 h-3 rounded-full bg-slate-950 border-2 border-violet-400"></span>` +
        `<span class="absolute -left-[52px] top-3 text-[10px] font-bold text-slate-600 w-4 text-right">${i + 1}</span>` +
        head + gloss +
      `</div>`
    );
  }).join("");
  return `<div class="my-3 ml-12 pl-5 border-l-2 border-violet-500/35 space-y-3">${items}</div>`;
}

export default function MarkdownPreview({ text, onWikiLink, onTaskToggle, docType }: MarkdownPreviewProps) {
  // We render via dangerouslySetInnerHTML because we want inline code-block,
  // wiki-link, and task-checkbox nodes inline; all user-supplied content is
  // HTML-escaped above via esc() before any tag scaffolding. Each interactive
  // node (wiki button, task checkbox) carries its identifier on a data-
  // attribute and is picked up by the delegated click/change handlers below
  // so React state updates flow correctly.
  //
  // Thread docs get one extra render rule: the ordered list under a "Trace"
  // heading becomes a timeline. The timeline splits the source into pre/post
  // segments, which would break data-task-line indices (they're offsets into
  // the FULL source), so any doc containing task checkboxes renders the
  // normal way — correctness of task toggling beats the fancy view.
  const html = React.useMemo(() => {
    if (docType === "thread" && !/^\s*[-*]\s+\[[ xX]\]/m.test(text)) {
      const t = parseThreadTrace(text);
      if (t) return renderBlocks(t.pre) + threadTimelineHtml(t.stops) + renderBlocks(t.post);
    }
    return renderBlocks(text);
  }, [text, docType]);

  // Hover preview card for wiki links: delegated mouseover on the container,
  // positioned under the hovered link. A sequence counter guards against a
  // stale fetch landing after the pointer moved to another link.
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [hover, setHover] = React.useState<HoverState | null>(null);
  const hoverSeq = React.useRef(0);

  const onMouseOver = React.useCallback((e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest("[data-wiki]") as HTMLElement | null;
    const container = containerRef.current;
    if (!el || !container) return;
    const name = el.getAttribute("data-wiki") ?? "";
    if (!name || (hover && hover.name === name)) return;
    const seq = ++hoverSeq.current;
    const elRect = el.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    const state: HoverState = {
      top: elRect.bottom - cRect.top + 6,
      left: Math.max(0, Math.min(elRect.left - cRect.left, cRect.width - 300)),
      name,
      relation: el.getAttribute("data-rel"),
      note: el.getAttribute("data-note"),
      data: null,
      resolved: false,
    };
    setHover(state);
    previewByName(name).then((data) => {
      if (hoverSeq.current !== seq) return;
      setHover((h) => (h && h.name === name ? { ...h, data, resolved: true } : h));
    });
  }, [hover]);

  const onMouseOut = React.useCallback((e: React.MouseEvent) => {
    const to = e.relatedTarget as HTMLElement | null;
    // Keep the card while the pointer stays on a wiki link (or its children).
    if (to && typeof to.closest === "function" && to.closest("[data-wiki]")) return;
    hoverSeq.current++;
    setHover(null);
  }, []);

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
    <div ref={containerRef} className="relative" onMouseOver={onMouseOver} onMouseOut={onMouseOut}>
      <div
        className="prose prose-invert max-w-none text-sm"
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {hover && (
        <div
          className="absolute z-30 w-[290px] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl px-3.5 py-3 pointer-events-none"
          style={{ top: hover.top, left: hover.left }}
        >
          <p className="text-xs font-bold text-slate-100 leading-snug">
            {hover.resolved && hover.data ? hover.data.title : hover.name}
          </p>
          {(hover.relation || hover.note) && (
            <p className="text-[10px] text-violet-300 mt-0.5">
              {hover.relation ? `${RELATION_GLYPHS[hover.relation as LinkRelation] ?? ""} ${hover.relation}` : "note"}
              {hover.note ? ` — ${hover.note}` : ""}
            </p>
          )}
          <p className="text-[11px] text-slate-400 leading-relaxed mt-1.5 line-clamp-4">
            {!hover.resolved
              ? "Loading…"
              : hover.data
              ? hover.data.excerpt || <span className="italic text-slate-600">Empty doc</span>
              : <span className="italic text-slate-600">No doc with this title yet — click to create it</span>}
          </p>
          {hover.resolved && hover.data && hover.data.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {hover.data.tags.map((t) => (
                <span key={t} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400/80 border border-violet-500/20">{t}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
