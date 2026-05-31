// Shared extraction for Claude responses that should contain a single JSON
// object or array. Models occasionally wrap output in ```fences``` or add a
// sentence before/after; this strips fences and slices to the outermost
// bracket pair. Previously copy-pasted across digest / briefing / threads /
// newsletters / news-overview routes — consolidated here so hardening lands
// once. Returns the raw JSON string ready for JSON.parse (caller parses so it
// controls the expected shape and error handling).
function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\n?/im, "").replace(/\n?```\s*$/m, "").trim();
}

/** Slice to the outermost {...}. Returns "{}" when no object is present. */
export function extractJsonObject(raw: string): string {
  let s = stripFences(raw);
  const start = s.indexOf("{");
  if (start < 0) return "{}";
  if (start > 0) s = s.slice(start);
  const end = s.lastIndexOf("}");
  if (end >= 0 && end < s.length - 1) s = s.slice(0, end + 1);
  return s;
}

/** Slice to the outermost [...]. Returns "[]" when no array is present. */
export function extractJsonArray(raw: string): string {
  let s = stripFences(raw);
  const start = s.indexOf("[");
  if (start < 0) return "[]";
  if (start > 0) s = s.slice(start);
  const end = s.lastIndexOf("]");
  if (end >= 0 && end < s.length - 1) s = s.slice(0, end + 1);
  return s;
}
