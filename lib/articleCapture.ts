// Pure parser/validator for a captured analysis article — the reader-capture
// counterpart to lib/xImport (client-safe, no DB). Validates a `dead-article`
// payload (produced by the extension's "capture this article" action in the
// user's own authenticated browser) and normalizes it for storage.
//
// Scope discipline: this is for MANUAL, one-article-at-a-time capture of content
// the user is actively reading via their own legitimate access (e.g. DoD MWR
// Libraries WSJ). It is NOT a bulk harvester — the ingest stores single articles,
// personal-use, into the private dashboard.

export interface StoredArticleDraft {
  id: string;
  url: string;
  title: string;
  byline: string | null;
  publishedAt: string | null;
  source: string;
  text: string;
  capturedAt: string;
}

export type ParseArticleResult =
  | { ok: true; article: StoredArticleDraft }
  | { ok: false; error: string };

const MAX_TEXT = 60_000;

function httpsOrEmpty(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  try { const u = new URL(s); return u.protocol === "https:" ? u.href.slice(0, 600) : ""; } catch { return ""; }
}
// djb2 — stable id from the canonical url, else source+title, so re-capturing the
// same article is idempotent.
function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return "art_" + h.toString(36);
}
function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function parseArticleCapture(raw: string, nowIso = new Date().toISOString()): ParseArticleResult {
  let j: Record<string, unknown>;
  try { j = JSON.parse(raw) as Record<string, unknown>; } catch { return { ok: false, error: "Invalid JSON." }; }
  if (j.format !== "dead-article") return { ok: false, error: "Not a dead-article capture." };

  const title = (typeof j.title === "string" ? j.title : "").replace(/\s+/g, " ").trim().slice(0, 400);
  const text = (typeof j.text === "string" ? j.text : "").replace(/[ \t]+\n/g, "\n").trim().slice(0, MAX_TEXT);
  if (!title) return { ok: false, error: "Article has no title — is this an article page?" };
  if (text.length < 40) return { ok: false, error: "No article body found on this page." };

  const url = httpsOrEmpty(j.url);
  const source = (typeof j.source === "string" ? j.source : "").trim().slice(0, 80) || "Analysis";
  const byline = (typeof j.byline === "string" ? j.byline : "").replace(/\s+/g, " ").trim().slice(0, 160) || null;
  const publishedAt = isoOrNull(j.publishedAt);
  const capturedAt = isoOrNull(j.capturedAt) ?? nowIso;
  const id = url ? hashId(url) : hashId(source + "|" + title);

  return { ok: true, article: { id, url, title, byline, publishedAt, source, text, capturedAt } };
}
