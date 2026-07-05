// Typed wiki-link vocabulary + parser, shared by the server link indexer
// (lib/documents.ts), the editor preview, and Compose. PURE — client
// components import this, so no node:* / fetch / DB (same rule as
// lib/airfields.ts).
//
// Syntax: [[Title | relation: note]]
//   [[Jomini]]                                  → plain link
//   [[Jomini | contradicts]]                    → typed link
//   [[Jomini | contradicts: principles vs …]]   → typed + annotated
//   [[Mahan | the concentration counterpoint]]  → plain link + note
// The pipe segment is NEVER an error: an unknown leading word simply means
// the whole segment is a free-text note.

export const LINK_RELATIONS = [
  "supports",
  "contradicts",
  "extends",
  "defines",
  "example-of",
  "see-also",
] as const;

export type LinkRelation = (typeof LINK_RELATIONS)[number];

// Rendering vocabulary: one glyph per relation, one meaning per glyph.
export const RELATION_GLYPHS: Record<LinkRelation, string> = {
  supports: "⊙",
  contradicts: "⊘",
  extends: "⊕",
  defines: "≔",
  "example-of": "▷",
  "see-also": "↪",
};

// Raw colours for SVG edges in the local graph (utility classes don't apply
// to SVG stroke attributes).
export const RELATION_HEX: Record<LinkRelation, string> = {
  supports: "#34d399",
  contradicts: "#f87171",
  extends: "#38bdf8",
  defines: "#fbbf24",
  "example-of": "#a78bfa",
  "see-also": "#94a3b8",
};

// Tailwind classes for the superscript relation chip in the doc preview.
export const RELATION_CLASSES: Record<LinkRelation, string> = {
  supports: "text-emerald-300 bg-emerald-500/10 border-emerald-500/40",
  contradicts: "text-red-300 bg-red-500/10 border-red-500/40",
  extends: "text-sky-300 bg-sky-500/10 border-sky-500/40",
  defines: "text-amber-300 bg-amber-500/10 border-amber-500/40",
  "example-of": "text-violet-300 bg-violet-500/10 border-violet-500/40",
  "see-also": "text-slate-400 bg-slate-500/10 border-slate-500/40",
};

export interface WikiLinkRef {
  title: string;
  relation: LinkRelation | null;
  note: string | null;
}

// Matches the full [[...]] marker; the inner text may carry one pipe segment.
export const WIKI_LINK_RE = /\[\[([^\[\]\n]{1,300})\]\]/g;

// Parse the inner text of a [[...]] marker into title / relation / note.
export function parseWikiInner(inner: string): WikiLinkRef {
  const pipe = inner.indexOf("|");
  if (pipe === -1) {
    return { title: inner.trim(), relation: null, note: null };
  }
  const title = inner.slice(0, pipe).trim();
  const seg = inner.slice(pipe + 1).trim();
  if (!seg) return { title, relation: null, note: null };

  // Leading word (before ":" or end) is a relation if it's in the vocabulary;
  // otherwise the whole segment is a note.
  const colon = seg.indexOf(":");
  const head = (colon === -1 ? seg : seg.slice(0, colon)).trim().toLowerCase();
  if ((LINK_RELATIONS as readonly string[]).includes(head)) {
    const note = colon === -1 ? null : seg.slice(colon + 1).trim() || null;
    return { title, relation: head as LinkRelation, note };
  }
  return { title, relation: null, note: seg };
}

// All wiki-link refs in a document, in order of appearance (duplicates kept —
// callers dedupe as needed).
export function extractWikiLinkRefs(content: string): WikiLinkRef[] {
  const out: WikiLinkRef[] = [];
  for (const m of content.matchAll(WIKI_LINK_RE)) {
    const ref = parseWikiInner(m[1]);
    if (ref.title) out.push(ref);
  }
  return out;
}
