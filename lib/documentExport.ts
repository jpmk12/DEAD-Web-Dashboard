import { format, parseISO } from "date-fns";
import type { DocumentFull } from "./documents";

// Build a single doc's markdown representation with YAML frontmatter for
// its metadata. The frontmatter is round-trippable (standard YAML) so any
// markdown tool can read it; if the doc is later re-imported into another
// system, the title / tags / created / updated lives with the content.

function escapeYaml(s: string): string {
  // Wrap in quotes when needed (contains ':', leading/trailing space,
  // or quoting characters). Always escape backslash + quote.
  if (s === "") return '""';
  if (/^[a-zA-Z0-9_\- ]+$/.test(s) && !s.startsWith(" ") && !s.endsWith(" ")) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildMarkdownExport(doc: DocumentFull): string {
  const tagsLine = doc.tags.length > 0
    ? `tags: [${doc.tags.map(escapeYaml).join(", ")}]`
    : `tags: []`;
  const frontmatter = [
    "---",
    `title: ${escapeYaml(doc.title)}`,
    tagsLine,
    `pinned: ${doc.pinned ? "true" : "false"}`,
    `archived: ${doc.archived ? "true" : "false"}`,
    `created: ${doc.createdAt}`,
    `updated: ${doc.updatedAt}`,
    `id: ${doc.id}`,
    "---",
    "",
  ].join("\n");
  return frontmatter + (doc.content ?? "") + (doc.content?.endsWith("\n") ? "" : "\n");
}

// Sanitize a doc title for use as a filename. Replaces filesystem-unsafe
// characters with hyphens, collapses repeats, trims, and falls back to a
// timestamp-prefixed slug when the title is empty. Caps length at 80 chars
// so deep zip paths don't blow up on Windows extractors.
export function safeFilename(doc: DocumentFull): string {
  const base = (doc.title || "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "untitled";
  const datePrefix = (() => {
    try { return format(parseISO(doc.updatedAt), "yyyyMMdd"); }
    catch { return ""; }
  })();
  return datePrefix ? `${datePrefix}-${base}.md` : `${base}.md`;
}
