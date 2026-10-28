// Reads posts out of the timeline responses X's own page fetched (kept by
// xhook.js). PURE — no DOM, no network — so it runs in the background worker
// and is unit-tested from the dashboard repo (tests/xGraphql.test.ts).
//
// It does not depend on X's exact response nesting, which X changes: it
// walks the JSON and takes every object shaped like a post — `__typename`
// "Tweet" with a `rest_id` and a `legacy` block (a "TweetWithVisibility
// Results" wrapper is unwrapped). It does NOT descend into a post it took,
// so a quoted or reposted post becomes part of its parent, never a second
// row. The output is the same item shape the DOM collector and the
// bookmarklet produce, which lib/xImport.ts validates on the server.

const MAX_DEPTH = 60;

function unwrap(o) {
  if (o && o.__typename === "TweetWithVisibilityResults" && o.tweet) return o.tweet;
  return o;
}

function isTweet(o) {
  return !!o && typeof o === "object" && o.__typename === "Tweet"
    && typeof o.rest_id === "string" && o.legacy && typeof o.legacy === "object";
}

function userOf(t) {
  const u = t && t.core && t.core.user_results && t.core.user_results.result;
  if (!u || typeof u !== "object") return { author: "", handle: "" };
  const handle = (u.core && u.core.screen_name) || (u.legacy && u.legacy.screen_name) || "";
  const author = (u.core && u.core.name) || (u.legacy && u.legacy.name) || "";
  return { author: String(author), handle: String(handle) };
}

// The text as a reader sees it: a long post's full note when present, t.co
// links expanded to where they go, and media links (the picture's own t.co)
// dropped.
function textOf(t) {
  const note = t.note_tweet && t.note_tweet.note_tweet_results && t.note_tweet.note_tweet_results.result;
  const legacy = t.legacy || {};
  let text = (note && typeof note.text === "string" && note.text) || (typeof legacy.full_text === "string" ? legacy.full_text : "");
  const entities = (note && note.entity_set) || legacy.entities || {};
  for (const u of Array.isArray(entities.urls) ? entities.urls : []) {
    if (u && typeof u.url === "string" && typeof u.expanded_url === "string") text = text.split(u.url).join(u.expanded_url);
  }
  const media = (legacy.entities && Array.isArray(legacy.entities.media)) ? legacy.entities.media : [];
  for (const m of media) {
    if (m && typeof m.url === "string") text = text.split(m.url).join("");
  }
  return text.replace(/[ \t]+\n/g, "\n").trim();
}

function timeOf(t) {
  const raw = t.legacy && t.legacy.created_at;
  const ms = typeof raw === "string" ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

function postOf(t) {
  // A repost is the original post: its author, its words, its id.
  const rt = t.legacy && t.legacy.retweeted_status_result && unwrap(t.legacy.retweeted_status_result.result);
  const src = isTweet(rt) ? rt : t;
  const { author, handle } = userOf(src);
  const text = textOf(src);
  if (!text) return null;
  const id = String(src.rest_id);
  const legacy = src.legacy || {};
  const post = {
    id,
    url: handle ? "https://x.com/" + handle + "/status/" + id : "https://x.com/i/status/" + id,
    author, handle,
    time: timeOf(src),
    text,
    metrics: {
      replies: typeof legacy.reply_count === "number" ? legacy.reply_count : undefined,
      reposts: typeof legacy.retweet_count === "number" ? legacy.retweet_count : undefined,
      likes: typeof legacy.favorite_count === "number" ? legacy.favorite_count : undefined,
    },
  };
  const q = src.quoted_status_result && unwrap(src.quoted_status_result.result);
  if (isTweet(q)) {
    const qu = userOf(q);
    const qt = textOf(q);
    if (qt) post.quoted = { author: qu.author, handle: qu.handle, text: qt.slice(0, 500) };
  }
  return post;
}

/** Every post in the given response bodies, in the order X sent them,
 *  deduplicated by id, at most `max`. Unparseable bodies are skipped. */
export function postsFromGraphql(texts, max = 200) {
  const out = new Map();
  const visit = (node, depth) => {
    if (out.size >= max || depth > MAX_DEPTH || !node || typeof node !== "object") return;
    const n = unwrap(node);
    if (isTweet(n)) {
      if (!out.has(n.rest_id)) {
        try { const p = postOf(n); if (p && !out.has(p.id)) out.set(p.id, p); } catch (e) { /* one odd post never kills the read */ }
      }
      return;
    }
    if (Array.isArray(n)) { for (const v of n) visit(v, depth + 1); return; }
    for (const k of Object.keys(n)) visit(n[k], depth + 1);
  };
  for (const t of Array.isArray(texts) ? texts : []) {
    let json;
    try { json = typeof t === "string" ? JSON.parse(t) : t; } catch (e) { continue; }
    visit(json, 0);
    if (out.size >= max) break;
  }
  return Array.from(out.values());
}

/** API posts first (full text, exact time), then any DOM-only post; a DOM
 *  quoted block fills an API post that lacks one. */
export function mergeXPosts(apiPosts, domPosts, max = 200) {
  const out = new Map();
  for (const p of apiPosts || []) if (p && p.id) out.set(p.id, p);
  for (const p of domPosts || []) {
    if (!p) continue;
    const key = p.id || p.url || (p.handle + "|" + (p.text || "").slice(0, 80));
    const have = p.id ? out.get(p.id) : null;
    if (have) { if (!have.quoted && p.quoted) have.quoted = p.quoted; continue; }
    if (!out.has(key)) out.set(key, p);
  }
  return Array.from(out.values()).slice(0, max);
}
