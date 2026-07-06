// dead-x-capture v1 — pure parser/validator for the X (Twitter) capture files
// produced by the bookmarklet in tools/x-capture-bookmarklet.js.
//
// PURE + client-safe: no fetch, no DB, no node:* imports (same rule as
// lib/airfields.ts). All persistence lives in lib/xStore.ts (server-only).
//
// Design constraints (per the approved plan):
// - NO server-side X credentials or scraping — the user captures rendered
//   posts in their own logged-in browser and uploads the JSON here.
// - Idempotent re-imports: every item resolves to a stable id (explicit id →
//   status URL → deterministic hash of handle+text), which becomes the DB PK.
// - Liberal in what we accept (hand-edited files, DOM-derived "1.2K" metric
//   strings), strict in what we emit (capped, sanitized, typed).

export interface XPostMetrics {
  replies?: number;
  reposts?: number;
  likes?: number;
  views?: number;
}

export interface XQuoted {
  author: string;
  handle: string;
  text: string;
}

export interface XPost {
  id: string;        // numeric status id, or "h<hash>" fallback — stable per post
  url: string;       // canonical https://x.com/... status link, or "" if absent/invalid
  author: string;    // display name
  handle: string;    // without the leading @
  time: string;      // ISO 8601, or "" when the capture had no parseable time
  text: string;
  metrics?: XPostMetrics;
  quoted?: XQuoted;
}

export type XSourceKind = "list" | "bookmarks" | "timeline" | "search" | "profile" | "unknown";

export interface XCaptureSource {
  kind: XSourceKind;
  label: string;
}

export interface XCapture {
  capturedAt: string;      // ISO 8601, "" if absent
  source: XCaptureSource;
  items: XPost[];
}

export interface XParseOk {
  ok: true;
  capture: XCapture;
  skipped: number;         // items dropped (no text / over cap / duplicate id)
  warnings: string[];
}

export interface XParseErr {
  ok: false;
  error: string;
}

export const X_MAX_ITEMS = 200;
export const X_TEXT_MAX = 1000;
const QUOTED_TEXT_MAX = 500;
const LABEL_MAX = 80;
const AUTHOR_MAX = 120;
const HANDLE_MAX = 30;

const SOURCE_KINDS: readonly XSourceKind[] = ["list", "bookmarks", "timeline", "search", "profile", "unknown"];
const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]);

const asStr = (v: unknown): string => (typeof v === "string" ? v : "");

// "1234", "1,234", "1.2K", "3.4M", 1234 → a non-negative integer, else undefined.
// The bookmarklet emits whatever X renders in the button labels, which is the
// abbreviated form — accept it rather than forcing the capture to normalize.
export function parseMetric(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
  if (typeof v !== "string") return undefined;
  const m = v.trim().match(/^([\d.,]+)\s*([KMB])?$/i);
  if (!m) return undefined;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return undefined;
  const mult = m[2] ? { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase() as "K" | "M" | "B"] : 1;
  return Math.round(n * mult);
}

// Keep only real X/Twitter status permalinks; anything else becomes "" so a
// crafted capture file can't smuggle an arbitrary link into the feed UI.
export function sanitizeXUrl(v: unknown): string {
  const raw = asStr(v).trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return "";
    if (!X_HOSTS.has(u.hostname.toLowerCase())) return "";
    if (!/\/status\/\d{4,25}(\/|$)/.test(u.pathname)) return "";
    return `https://x.com${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return "";
  }
}

const idFromUrl = (url: string): string => {
  const m = url.match(/\/status\/(\d{4,25})/);
  return m ? m[1] : "";
};

// djb2 — deterministic fallback id so a post captured without a permalink
// still re-imports idempotently (same handle+text → same id).
const hashId = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `h${h.toString(16)}`;
};

const asIso = (v: unknown): string => {
  const t = Date.parse(asStr(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
};

const cleanHandle = (v: unknown): string =>
  asStr(v).trim().replace(/^@+/, "").replace(/[^\w.]/g, "").slice(0, HANDLE_MAX);

const cleanText = (v: unknown, max: number): string =>
  asStr(v).replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max);

export function parseXCapture(raw: string): XParseOk | XParseErr {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Not valid JSON — export the file with the DEAD X-capture bookmarklet and upload it unmodified." };
  }
  if (typeof doc !== "object" || doc === null) return { ok: false, error: "Capture file must be a JSON object." };
  const d = doc as Record<string, unknown>;
  if (d.format !== "dead-x-capture") {
    return { ok: false, error: 'Not a dead-x-capture file (missing format: "dead-x-capture") — use the bookmarklet to generate it.' };
  }
  if (d.version !== 1) {
    return { ok: false, error: `Unsupported capture version ${String(d.version)} — this build reads version 1.` };
  }
  if (!Array.isArray(d.items)) return { ok: false, error: "Capture file has no items array." };

  const srcRaw = (typeof d.source === "object" && d.source !== null ? d.source : {}) as Record<string, unknown>;
  const kind: XSourceKind = SOURCE_KINDS.includes(asStr(srcRaw.kind) as XSourceKind)
    ? (asStr(srcRaw.kind) as XSourceKind)
    : "unknown";
  const label = cleanText(srcRaw.label, LABEL_MAX) || kind;

  const warnings: string[] = [];
  let skippedNoText = 0;
  let skippedDupes = 0;
  const seen = new Set<string>();
  const items: XPost[] = [];

  const rawItems = d.items as unknown[];
  const overCap = Math.max(0, rawItems.length - X_MAX_ITEMS);

  for (const entry of rawItems) {
    if (items.length >= X_MAX_ITEMS) break;
    if (typeof entry !== "object" || entry === null) { skippedNoText++; continue; }
    const it = entry as Record<string, unknown>;
    const text = cleanText(it.text, X_TEXT_MAX);
    if (!text) { skippedNoText++; continue; }

    const url = sanitizeXUrl(it.url);
    const explicitId = asStr(it.id).trim();
    const handle = cleanHandle(it.handle);
    const id = /^\d{4,25}$/.test(explicitId) ? explicitId : idFromUrl(url) || hashId(`${handle}|${text}`);
    if (seen.has(id)) { skippedDupes++; continue; }
    seen.add(id);

    const post: XPost = {
      id,
      url,
      author: cleanText(it.author, AUTHOR_MAX),
      handle,
      time: asIso(it.time),
      text,
    };

    if (typeof it.metrics === "object" && it.metrics !== null) {
      const m = it.metrics as Record<string, unknown>;
      const metrics: XPostMetrics = {};
      const replies = parseMetric(m.replies);
      const reposts = parseMetric(m.reposts);
      const likes = parseMetric(m.likes);
      const views = parseMetric(m.views);
      if (replies !== undefined) metrics.replies = replies;
      if (reposts !== undefined) metrics.reposts = reposts;
      if (likes !== undefined) metrics.likes = likes;
      if (views !== undefined) metrics.views = views;
      if (Object.keys(metrics).length > 0) post.metrics = metrics;
    }

    if (typeof it.quoted === "object" && it.quoted !== null) {
      const q = it.quoted as Record<string, unknown>;
      const qText = cleanText(q.text, QUOTED_TEXT_MAX);
      if (qText) {
        post.quoted = { author: cleanText(q.author, AUTHOR_MAX), handle: cleanHandle(q.handle), text: qText };
      }
    }

    items.push(post);
  }

  if (items.length === 0) return { ok: false, error: "No usable posts in the capture (every item was empty or invalid)." };

  if (overCap > 0) warnings.push(`${overCap} item${overCap === 1 ? "" : "s"} beyond the ${X_MAX_ITEMS}-post cap dropped.`);
  if (skippedNoText > 0) warnings.push(`${skippedNoText} item${skippedNoText === 1 ? "" : "s"} skipped (no text).`);
  if (skippedDupes > 0) warnings.push(`${skippedDupes} duplicate post${skippedDupes === 1 ? "" : "s"} collapsed.`);

  return {
    ok: true,
    capture: { capturedAt: asIso(d.capturedAt), source: { kind, label }, items },
    skipped: skippedNoText + skippedDupes + overCap,
    warnings,
  };
}
