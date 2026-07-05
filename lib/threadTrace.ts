// Thread-timeline parsing for 🧵 thread docs, plus the lexicon's definition
// extractor. PURE — client- and server-imported, unit-tested.

import { parseWikiInner, type LinkRelation } from "./linkRelations";

export interface TraceStop {
  // Wiki-link target of the stop, when the item leads with [[...]].
  title: string | null;
  relation: LinkRelation | null;
  note: string | null;
  // The prose after the link ("— gloss"), or the whole item for plain stops.
  gloss: string;
}

export interface ThreadTrace {
  pre: string;   // content up to and including the Trace heading
  stops: TraceStop[];
  post: string;  // content after the trace list
}

// Find a "Trace" heading (any level, word-bounded, outside code fences) and
// parse the ordered list that follows it. Returns null when the doc has no
// trace or fewer than 2 stops — callers fall back to the normal renderer.
export function parseThreadTrace(content: string): ThreadTrace | null {
  const lines = content.split("\n");
  let inFence = false;
  let headIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trimStart();
    if (/^(```|~~~)/.test(t)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (/^#{1,6}\s+.*\btrace\b/i.test(lines[i])) { headIdx = i; break; }
  }
  if (headIdx === -1) return null;

  // Skip blanks, then consume consecutive ordered-list items. A wrapped
  // continuation line (indented, non-list) appends to the previous gloss.
  let i = headIdx + 1;
  while (i < lines.length && lines[i].trim() === "") i++;
  const items: string[] = [];
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*\d+[.)]\s+/.test(line)) {
      items.push(line.replace(/^\s*\d+[.)]\s+/, "").trim());
      i++;
    } else if (items.length > 0 && /^\s+\S/.test(line)) {
      items[items.length - 1] += " " + line.trim();
      i++;
    } else {
      break;
    }
  }
  if (items.length < 2) return null;

  const stops: TraceStop[] = items.map((item) => {
    const m = item.match(/^\[\[([^\[\]\n]{1,300})\]\]\s*(.*)$/);
    if (!m) return { title: null, relation: null, note: null, gloss: item };
    const ref = parseWikiInner(m[1]);
    const gloss = m[2].replace(/^[—–-]\s*/, "").trim();
    return { title: ref.title || null, relation: ref.relation, note: ref.note, gloss };
  });

  return {
    pre: lines.slice(0, headIdx + 1).join("\n"),
    stops,
    post: lines.slice(i).join("\n"),
  };
}

// First prose paragraph of a doc, for lexicon definitions: skips headings,
// list markers, the "← part of [[...]]" breadcrumb, and code fences; strips
// inline markdown; caps length.
export function termDefinition(content: string, cap = 240): string {
  const lines = content.split("\n");
  let inFence = false;
  const buf: string[] = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (/^(```|~~~)/.test(t)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (buf.length === 0) {
      if (t === "" || /^#{1,6}\s/.test(t) || /^[-*]\s/.test(t) || /^\d+[.)]\s/.test(t)) continue;
      if (/^←/.test(t)) continue;
      buf.push(t);
    } else {
      if (t === "") break;
      buf.push(t);
    }
  }
  return buf.join(" ")
    .replace(/\[\[([^\[\]|]+)(?:\|[^\[\]]*)?\]\]/g, "$1")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, cap);
}
