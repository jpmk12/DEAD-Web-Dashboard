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

/**
 * Parse a model reply that SHOULD be one JSON object, repairing a reply that
 * was cut off (max_tokens) instead of discarding it. The Economy read lost
 * every reply for a week this way (2026-10-06): eight actor calls did not
 * fit the output cap, `JSON.parse` threw on the truncated tail, and the
 * route saw `{}`. Strategy: slice to the object, then repeatedly (a) close
 * any open string and every open bracket and try to parse, (b) on failure
 * cut the candidate back to its last `,` (dropping the dangling partial
 * value or key) and try again. Bounded; returns `null` when nothing
 * object-shaped survives, and reports `truncated` so the caller can say so.
 */
export function salvageJsonObject(raw: string): { value: Record<string, unknown> | null; truncated: boolean } {
  if (!raw || raw.indexOf("{") < 0) return { value: null, truncated: false };
  const s = extractJsonObject(raw);
  try {
    const v = JSON.parse(s);
    return { value: v && typeof v === "object" && !Array.isArray(v) ? v : null, truncated: false };
  } catch { /* fall through to repair */ }
  let cand = s;
  for (let i = 0; i < 60 && cand.length > 1; i++) {
    const closers = closersFor(cand);
    try {
      const v = JSON.parse(cand + closers);
      return { value: v && typeof v === "object" && !Array.isArray(v) ? v : null, truncated: true };
    } catch { /* cut back */ }
    const cut = lastCutPoint(cand);
    if (cut <= 0) break;
    cand = cand.slice(0, cut);
  }
  return { value: null, truncated: true };
}

/** The closing characters that would balance `s` (an unterminated string
 *  is closed first, then brackets innermost-first). */
function closersFor(s: string): string {
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = inStr ? "\"" : "";
  // A dangling `"key":` or trailing comma cannot take a closer on its own.
  const tail = (s + out).replace(/\s+$/, "");
  if (/[:,]$/.test(tail)) out += /:$/.test(tail) ? "null" : "";
  return out + stack.reverse().join("");
}

/** Index of the last top-level-ish `,` outside strings — the cut that
 *  drops the dangling partial. */
function lastCutPoint(s: string): number {
  let inStr = false, esc = false, last = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") inStr = true;
    else if (ch === ",") last = i;
  }
  return last;
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
