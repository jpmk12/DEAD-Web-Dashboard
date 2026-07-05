// Doc-type vocabulary for the Docs tab. One kind per doc, one glyph + one
// colour per kind (same vocabulary discipline as lib/icons.tsx). PURE —
// client-imported; no node:*, no fetch.

// `color` = Tailwind class for text; `hex` = raw colour for SVG strokes
// (the local graph can't use utility classes on SVG attributes).
export const DOC_TYPES = [
  { key: "note",      label: "Note",      icon: "·",  color: "text-slate-400",   hex: "#94a3b8" },
  { key: "theorist",  label: "Theorist",  icon: "◆",  color: "text-sky-300",     hex: "#7dd3fc" },
  { key: "debate",    label: "Debate",    icon: "⚖",  color: "text-red-300",     hex: "#fca5a5" },
  { key: "thread",    label: "Thread",    icon: "🧵", color: "text-violet-300",  hex: "#c4b5fd" },
  { key: "case",      label: "Case",      icon: "▣",  color: "text-amber-300",   hex: "#fcd34d" },
  { key: "term",      label: "Term",      icon: "≔",  color: "text-emerald-300", hex: "#6ee7b7" },
  { key: "synthesis", label: "Synthesis", icon: "⧉",  color: "text-fuchsia-300", hex: "#f0abfc" },
] as const;

export type DocType = (typeof DOC_TYPES)[number]["key"];

export const DEFAULT_DOC_TYPE: DocType = "note";

export function isDocType(v: unknown): v is DocType {
  return typeof v === "string" && DOC_TYPES.some((t) => t.key === v);
}

export function docTypeMeta(key: string) {
  return DOC_TYPES.find((t) => t.key === key) ?? DOC_TYPES[0];
}
