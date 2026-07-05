// Pure helpers for the Docs tab's Compose (assemble many docs into one
// deliverable) and Split-at-headings (break one long doc into section docs).
//
// Client components import this directly, so it MUST stay dependency-free and
// side-effect-free — no node:* imports, no fetch, no DB (same load-bearing
// rule as lib/airfields.ts / lib/firData.ts). Everything here is string math,
// which also makes it unit-testable without fixtures.

export interface ComposeDoc {
  id: string;
  title: string;
  content: string;
  tags: string[];
  updatedAt?: string;
}

export interface ComposeOptions {
  title: string;
  titlePage: boolean;
  toc: boolean;
  // Rewrite [[wiki-links]] between included docs into #sec-N anchors.
  rewriteLinks: boolean;
  // Per-section "tags · updated" line under each heading.
  includeMeta: boolean;
  // Links to docs NOT in the compile become numbered footnotes instead of
  // dangling [[markers]] that mean nothing outside the app.
  footnoteExternal: boolean;
  // Injectable for tests; defaults to now.
  compiledAt?: Date;
}

const WIKI_RE = /\[\[([^\[\]\n]{1,200})\]\]/g;

interface FootnoteState {
  // title(lower) → footnote number, so repeat references share one footnote.
  index: Map<string, number>;
  titles: string[]; // ordered by number (1-based)
}

// Rewrite one doc's wiki links against the compile set. Internal targets
// become anchor links; external targets become footnote markers (or plain
// text when footnotes are off). No-op when rewriting is disabled.
function rewriteWikiLinks(
  content: string,
  sectionByTitle: Map<string, number>,
  opts: Pick<ComposeOptions, "rewriteLinks" | "footnoteExternal">,
  fns: FootnoteState,
): string {
  if (!opts.rewriteLinks) return content;
  return content.replace(WIKI_RE, (_m, raw) => {
    const title = String(raw).trim();
    const n = sectionByTitle.get(title.toLowerCase());
    if (n !== undefined) return `[${title}](#sec-${n})`;
    if (!opts.footnoteExternal) return title;
    let fn = fns.index.get(title.toLowerCase());
    if (fn === undefined) {
      fn = fns.titles.length + 1;
      fns.index.set(title.toLowerCase(), fn);
      fns.titles.push(title);
    }
    return `${title}[^${fn}]`;
  });
}

// Assemble the compiled markdown. Section anchors use explicit <a id> tags
// (renders inertly everywhere) rather than heading-slug links, which differ
// per renderer.
export function compileDocs(docs: ComposeDoc[], opts: ComposeOptions): string {
  const sectionByTitle = new Map<string, number>();
  docs.forEach((d, i) => sectionByTitle.set(d.title.trim().toLowerCase(), i + 1));
  const fns: FootnoteState = { index: new Map(), titles: [] };

  const date = (opts.compiledAt ?? new Date()).toISOString().slice(0, 10);
  const parts: string[] = [];

  if (opts.titlePage) {
    parts.push(`# ${opts.title.trim() || "Untitled synthesis"}`);
    parts.push(`_Compiled ${date} · ${docs.length} section${docs.length === 1 ? "" : "s"}_`);
    parts.push("---");
  }
  if (opts.toc && docs.length > 1) {
    parts.push(docs.map((d, i) => `- [${i + 1} · ${d.title}](#sec-${i + 1})`).join("\n"));
    parts.push("---");
  }

  docs.forEach((d, i) => {
    const n = i + 1;
    parts.push(`<a id="sec-${n}"></a>`);
    parts.push(`## ${n} · ${d.title}`);
    if (opts.includeMeta) {
      const meta = [
        d.tags.length > 0 ? `tags: ${d.tags.join(", ")}` : "",
        d.updatedAt ? `updated ${d.updatedAt.slice(0, 10)}` : "",
      ].filter(Boolean).join(" · ");
      if (meta) parts.push(`_${meta}_`);
    }
    const body = rewriteWikiLinks(d.content, sectionByTitle, opts, fns).trim();
    if (body) parts.push(body);
  });

  if (fns.titles.length > 0) {
    parts.push("---");
    parts.push(fns.titles.map((t, i) => `[^${i + 1}]: ${t} — not included in this compile`).join("\n"));
  }

  return parts.join("\n\n") + "\n";
}

// ─── Split at headings ───────────────────────────────────────────────────────

export interface SplitSection {
  title: string;
  body: string; // section content WITHOUT the heading line
}

// Find sections that start at exactly `level` (## for 2, etc.). Headings
// inside fenced code blocks are ignored. Content before the first heading is
// the preamble. Deeper headings stay inside their parent section's body.
export function splitAtHeadings(content: string, level: 1 | 2 | 3): { preamble: string; sections: SplitSection[] } {
  const lines = content.split("\n");
  const re = new RegExp(`^#{${level}}\\s+(.+?)\\s*$`);
  let inFence = false;
  const marks: { idx: number; title: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (/^(```|~~~)/.test(trimmed)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = lines[i].match(re);
    if (m) marks.push({ idx: i, title: m[1].trim() });
  }
  if (marks.length === 0) return { preamble: content, sections: [] };

  const preamble = lines.slice(0, marks[0].idx).join("\n").replace(/\s+$/, "");
  const sections = marks.map((mk, j) => {
    const end = j + 1 < marks.length ? marks[j + 1].idx : lines.length;
    return { title: mk.title, body: lines.slice(mk.idx + 1, end).join("\n").trim() };
  });
  return { preamble, sections };
}

// Rebuild the master doc's content after a split: extracted sections become
// [[wiki-link]] bullets (consecutive extractions group into one list), while
// sections the user chose to keep stay inline verbatim. The preamble is
// always preserved.
export function buildMasterAfterSplit(
  preamble: string,
  sections: SplitSection[],
  extractedIdx: Set<number>,
  level: 1 | 2 | 3,
): string {
  const hashes = "#".repeat(level);
  const parts: string[] = [];
  if (preamble.trim()) parts.push(preamble.trimEnd());

  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length > 0) { parts.push(bullets.join("\n")); bullets = []; }
  };
  sections.forEach((s, i) => {
    if (extractedIdx.has(i)) {
      bullets.push(`- [[${s.title}]]`);
    } else {
      flush();
      parts.push(`${hashes} ${s.title}${s.body ? `\n\n${s.body}` : ""}`);
    }
  });
  flush();
  return parts.join("\n\n") + "\n";
}

// ─── Minimal markdown → HTML (for the standalone notebook export) ────────────
//
// Deliberately small: headings, hr, blockquotes, fenced code, flat lists,
// task items, bold/italic/inline code, links (http + #anchor), footnote
// markers, leftover [[wiki]] spans, paragraphs. Everything is HTML-escaped
// FIRST, so raw HTML in a doc renders as text — no injection surface. This
// hand-rolled converter exists because the export must be self-contained and
// the project deliberately avoids new npm dependencies.

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineHtml(line: string): string {
  const stash: string[] = [];
  const put = (html: string): string => {
    stash.push(html);
    return `\x00${stash.length - 1}\x00`;
  };
  let s = esc(line);
  // Inline code first so nothing inside backticks is transformed.
  s = s.replace(/`([^`\n]+)`/g, (_m, c) => put(`<code>${c}</code>`));
  // Footnote markers [^N] → superscript anchors.
  s = s.replace(/\[\^(\d+)\]/g, (_m, n) => put(`<sup id="fnref-${n}"><a href="#fn-${n}">${n}</a></sup>`));
  // Leftover wiki links (rewriting off / unresolved) render as inert spans.
  s = s.replace(/\[\[([^\[\]\n]{1,200})\]\]/g, (_m, t) => put(`<span class="wl">${esc(String(t).trim())}</span>`));
  // [text](url): http(s) opens a tab, #anchor stays internal, anything else is text.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => {
    if (/^#[\w-]+$/.test(url)) return put(`<a href="${url}">${text}</a>`);
    if (/^https?:\/\//i.test(url)) return put(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`);
    return put(`<span>${text}</span>`);
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  return s.replace(/\x00(\d+)\x00/g, (_m, i) => stash[Number(i)]);
}

export function miniMarkdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inFence = false;
  let fenceBuf: string[] = [];
  let listBuf: string[] = [];
  let listTag: "ul" | "ol" | null = null;
  let paraBuf: string[] = [];

  const flushPara = () => {
    if (paraBuf.length > 0) { out.push(`<p>${paraBuf.map(inlineHtml).join("<br>")}</p>`); paraBuf = []; }
  };
  const flushList = () => {
    if (listTag && listBuf.length > 0) out.push(`<${listTag}>${listBuf.join("")}</${listTag}>`);
    listBuf = []; listTag = null;
  };

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (/^(```|~~~)/.test(trimmed)) {
      if (inFence) { out.push(`<pre><code>${esc(fenceBuf.join("\n"))}</code></pre>`); fenceBuf = []; inFence = false; }
      else { flushPara(); flushList(); inFence = true; }
      continue;
    }
    if (inFence) { fenceBuf.push(line); continue; }

    // Raw anchor tags emitted by compileDocs pass through un-escaped.
    const anchorM = line.match(/^<a id="(sec-\d+)"><\/a>\s*$/);
    if (anchorM) { flushPara(); flushList(); out.push(`<a id="${anchorM[1]}"></a>`); continue; }

    const hM = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (hM) { flushPara(); flushList(); const lv = hM[1].length; out.push(`<h${lv}>${inlineHtml(hM[2])}</h${lv}>`); continue; }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { flushPara(); flushList(); out.push("<hr>"); continue; }
    if (/^>\s?/.test(trimmed)) { flushPara(); flushList(); out.push(`<blockquote>${inlineHtml(trimmed.replace(/^>\s?/, ""))}</blockquote>`); continue; }

    const taskM = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
    const ulM = !taskM ? trimmed.match(/^[-*]\s+(.*)$/) : null;
    const olM = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (taskM || ulM || olM) {
      flushPara();
      const tag: "ul" | "ol" = olM ? "ol" : "ul";
      if (listTag && listTag !== tag) flushList();
      listTag = tag;
      if (taskM) listBuf.push(`<li class="task">${taskM[1] === " " ? "☐" : "☑"} ${inlineHtml(taskM[2])}</li>`);
      else listBuf.push(`<li>${inlineHtml((ulM ?? olM)![1])}</li>`);
      continue;
    }
    if (trimmed === "") { flushPara(); flushList(); continue; }
    flushList();
    paraBuf.push(line);
  }
  if (inFence && fenceBuf.length > 0) out.push(`<pre><code>${esc(fenceBuf.join("\n"))}</code></pre>`);
  flushPara(); flushList();
  return out.join("\n");
}

// ─── Standalone HTML notebook export ─────────────────────────────────────────

// Self-contained dark-themed page: title header, ToC, one <section> per doc,
// footnotes. No external assets (fonts/scripts/styles all inline) so the file
// works from disk, email, or a share drive.
export function renderNotebookHtml(docs: ComposeDoc[], opts: ComposeOptions): string {
  const sectionByTitle = new Map<string, number>();
  docs.forEach((d, i) => sectionByTitle.set(d.title.trim().toLowerCase(), i + 1));
  const fns: FootnoteState = { index: new Map(), titles: [] };
  const date = (opts.compiledAt ?? new Date()).toISOString().slice(0, 10);
  const title = opts.title.trim() || "Untitled synthesis";

  const sectionsHtml = docs.map((d, i) => {
    const n = i + 1;
    const body = rewriteWikiLinks(d.content, sectionByTitle, opts, fns).trim();
    const meta = opts.includeMeta
      ? [
          d.tags.length > 0 ? `tags: ${d.tags.join(", ")}` : "",
          d.updatedAt ? `updated ${d.updatedAt.slice(0, 10)}` : "",
        ].filter(Boolean).join(" · ")
      : "";
    return [
      `<section id="sec-${n}">`,
      `<h2><span class="n">${n}</span>${esc(d.title)}</h2>`,
      meta ? `<p class="meta">${esc(meta)}</p>` : "",
      miniMarkdownToHtml(body),
      `</section>`,
    ].filter(Boolean).join("\n");
  }).join("\n");

  const tocHtml = opts.toc && docs.length > 1
    ? `<nav class="toc"><div class="toc-t">Contents</div>${docs.map((d, i) =>
        `<a href="#sec-${i + 1}"><span class="n">${i + 1}</span>${esc(d.title)}</a>`).join("")}</nav>`
    : "";

  const footnotesHtml = fns.titles.length > 0
    ? `<footer class="fns"><hr><ol>${fns.titles.map((t, i) =>
        `<li id="fn-${i + 1}">${esc(t)} — not included in this compile <a href="#fnref-${i + 1}">↩</a></li>`).join("")}</ol></footer>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 780px; padding: 40px 22px 80px; background: #060a14;
    color: #cbd5e1; font: 15px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  header.top { border-bottom: 1px solid #1e293b; padding-bottom: 18px; margin-bottom: 22px; }
  header.top h1 { margin: 0 0 6px; font-size: 26px; color: #f1f5f9; letter-spacing: .01em; }
  header.top .sub { font-size: 12px; color: #64748b; font-family: ui-monospace, monospace; }
  .toc { background: #0b1220; border: 1px solid #1e293b; border-radius: 10px; padding: 14px 16px; margin-bottom: 26px; }
  .toc-t { font-size: 10px; letter-spacing: .18em; text-transform: uppercase; color: #64748b; font-weight: 700; margin-bottom: 8px; }
  .toc a { display: block; color: #7dd3fc; text-decoration: none; font-size: 13.5px; padding: 2.5px 0; }
  .toc a:hover { color: #bae6fd; }
  .n { display: inline-block; min-width: 22px; color: #10b981; font-family: ui-monospace, monospace; font-size: .85em; margin-right: 8px; }
  section { margin-bottom: 34px; }
  section h2 { font-size: 19px; color: #f1f5f9; border-bottom: 1px solid #1e293b; padding-bottom: 6px; margin: 0 0 10px; }
  h3 { color: #e2e8f0; font-size: 15.5px; margin: 18px 0 6px; }
  h4, h5, h6 { color: #cbd5e1; margin: 14px 0 4px; }
  p { margin: 0 0 10px; }
  .meta { font-size: 11px; color: #64748b; font-family: ui-monospace, monospace; }
  a { color: #7dd3fc; }
  code { background: #111a2e; color: #6ee7b7; border-radius: 4px; padding: 1px 5px; font-size: .88em; font-family: ui-monospace, monospace; }
  pre { background: #0b1220; border: 1px solid #1e293b; border-radius: 8px; padding: 12px 14px; overflow-x: auto; }
  pre code { background: none; padding: 0; color: #cbd5e1; }
  blockquote { border-left: 3px solid #334155; margin: 10px 0; padding: 2px 14px; color: #94a3b8; }
  ul, ol { margin: 0 0 10px; padding-left: 24px; }
  li { margin: 2.5px 0; }
  li.task { list-style: none; margin-left: -18px; }
  hr { border: 0; border-top: 1px solid #1e293b; margin: 20px 0; }
  .wl { color: #34d399; border-bottom: 1px dashed rgba(52, 211, 153, .5); }
  sup a { text-decoration: none; color: #f59e0b; }
  .fns { font-size: 12.5px; color: #94a3b8; }
  .fns a { text-decoration: none; }
  strong { color: #f1f5f9; }
</style>
</head>
<body>
<header class="top">
  <h1>${esc(title)}</h1>
  <div class="sub">Compiled ${date} · ${docs.length} section${docs.length === 1 ? "" : "s"}</div>
</header>
${tocHtml}
<main>
${sectionsHtml}
</main>
${footnotesHtml}
</body>
</html>
`;
}
