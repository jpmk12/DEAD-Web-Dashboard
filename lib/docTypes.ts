// Doc-type vocabulary for the Docs tab. One kind per doc, one glyph + one
// colour per kind (same vocabulary discipline as lib/icons.tsx). PURE —
// client-imported; no node:*, no fetch.

export const DOC_TYPES = [
  { key: "note",      label: "Note",      icon: "·",  color: "text-slate-400" },
  { key: "theorist",  label: "Theorist",  icon: "◆",  color: "text-sky-300" },
  { key: "debate",    label: "Debate",    icon: "⚖",  color: "text-red-300" },
  { key: "thread",    label: "Thread",    icon: "🧵", color: "text-violet-300" },
  { key: "case",      label: "Case",      icon: "▣",  color: "text-amber-300" },
  { key: "term",      label: "Term",      icon: "≔",  color: "text-emerald-300" },
  { key: "synthesis", label: "Synthesis", icon: "⧉",  color: "text-fuchsia-300" },
] as const;

export type DocType = (typeof DOC_TYPES)[number]["key"];

export const DEFAULT_DOC_TYPE: DocType = "note";

export function isDocType(v: unknown): v is DocType {
  return typeof v === "string" && DOC_TYPES.some((t) => t.key === v);
}

export function docTypeMeta(key: string) {
  return DOC_TYPES.find((t) => t.key === key) ?? DOC_TYPES[0];
}
