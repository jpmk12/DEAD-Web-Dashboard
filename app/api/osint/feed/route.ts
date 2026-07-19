import { NextResponse } from "next/server";
import { normEmail } from "@/lib/allowlist";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { recordDailySignals, topicTerms, watchTermsIn } from "@/lib/trends";
import { getXItems, type StoredXItem } from "@/lib/xStore";
import { getCapturedArticles, type StoredArticle } from "@/lib/articleStore";

export const dynamic = "force-dynamic";

interface OsintItem {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  summary: string;
  feedId: string;
  feedLabel: string;
  feedKind: string;
}

const TTL_MS = 5 * 60 * 1000;
// LRU-capped server cache. Renamed / churning feed URLs would otherwise
// accumulate entries forever on this long-lived process. Map iteration is
// insertion-order, so dropping `cache.keys().next().value` evicts the oldest.
const CACHE_MAX = 40;
// Per-feed cache entries also carry the last successful fetch timestamp +
// an `ok` flag (false = last attempt errored or returned nothing parseable)
// so the PreferencesDrawer health dots have something to render against.
const cache = new Map<string, { items: OsintItem[]; expires: number; fetchedAt: number; ok: boolean }>();

// Overall server-side budget for the whole batch. Per-feed timeout is 8 s,
// but with 20 stalled feeds running in parallel the client would still wait
// the full 8 s. Cap the route to 12 s and let any laggards drop to empty.
const TOTAL_BUDGET_MS = 12_000;

function isSafeHostname(h: string): boolean {
  if (!h) return false;
  if (h === "localhost" || h === "broadcasthost" || h === "ip6-localhost") return false;
  if (/^127\./.test(h)) return false;
  if (/^10\./.test(h)) return false;
  if (/^192\.168\./.test(h)) return false;
  if (/^169\.254\./.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (/^(::1|fe80:|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/i.test(h)) return false;
  if (/^0\.0\.0\.0$/.test(h)) return false;
  return true;
}

function extractTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
  if (!m) return "";
  return m[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// Strip HTML tags and decode the common entities from a fragment of markup.
function cleanHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&hellip;/g, "…")
    .replace(/\s+/g, " ")
    .trim();
}

// Telegram channels were previously bridged through the public rsshub.app
// instance, which is chronically rate-limited / IP-blocked from datacenter
// hosts and was the dominant cause of OSINT-tab flakiness. Instead we read the
// channel's own server-rendered preview page (https://t.me/s/<slug>) directly —
// public, HTTPS, and not throttled the way the shared bridge is. This helper
// recognises both the new t.me URLs and any legacy rsshub URLs still saved in a
// user's prefs, returning the channel slug (sanitised) or null for non-Telegram
// feeds. Slugs are [A-Za-z0-9_]{4,32} per Telegram's rules.
function telegramSlug(rawUrl: string): string | null {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return null; }
  const host = u.hostname.toLowerCase();
  let slug = "";
  if (host === "t.me" || host === "telegram.me") {
    const parts = u.pathname.split("/").filter(Boolean); // ["s","slug"] or ["slug"]
    slug = parts[0] === "s" ? (parts[1] ?? "") : (parts[0] ?? "");
  } else {
    // Any rsshub instance (rsshub.app or a mirror) bridges Telegram at this
    // path — match on the path, not the host, so legacy mirror URLs work too.
    const m = u.pathname.match(/\/telegram\/channel\/([^/]+)/i);
    if (m) slug = m[1];
  }
  return /^[A-Za-z0-9_]{4,32}$/.test(slug) ? slug : null;
}

async function fetchTelegram(slug: string, feedId: string, label: string, kind: string): Promise<OsintItem[]> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`https://t.me/s/${slug}`, {
      // A browser-ish UA: t.me serves the lightweight preview to generic
      // agents but this avoids any bot heuristics blanking the page.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DEAD-Dashboard/1.0; +https://github.com/jpmk12/dead-web-dashboard)", Accept: "text/html", "Accept-Language": "en" },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const html = await res.text();
    const items: OsintItem[] = [];
    // One block per message bubble. t.me/s/ lists oldest→newest top-to-bottom.
    const blocks = html.split("tgme_widget_message_wrap");
    for (const block of blocks) {
      const textM = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (!textM) continue;
      const text = cleanHtml(textM[1]);
      if (!text) continue;
      const linkM = block.match(/tgme_widget_message_date"\s+href="([^"]+)"/i);
      const link = linkM ? linkM[1].replace(/&amp;/g, "&") : `https://t.me/${slug}`;
      const timeM = block.match(/<time[^>]+datetime="([^"]+)"/i);
      const pubDate = timeM ? timeM[1] : "";
      items.push({
        id: link,
        title: text.slice(0, 160),
        link,
        pubDate,
        summary: text.slice(0, 400),
        feedId, feedLabel: label, feedKind: kind,
      });
    }
    // Most-recent first, capped — mirrors the RSS path's slice(0, 12).
    return items.slice(-12).reverse();
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAndParse(url: string, feedId: string, label: string, kind: string): Promise<OsintItem[]> {
  // Telegram channels (native t.me or legacy rsshub bridge URLs) are read from
  // the channel's own preview page rather than a third-party RSS bridge.
  const tg = telegramSlug(url);
  if (tg) return fetchTelegram(tg, feedId, label, kind);

  // SSRF re-validate at fetch time too — the URL was already sanitised on
  // write but defense in depth keeps the runtime fetch from hitting internal
  // addresses if validation logic ever weakens.
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
    if (parsed.username || parsed.password) return [];
    if (!isSafeHostname(parsed.hostname.toLowerCase())) return [];
  } catch { return []; }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8_000);
  try {
    // Reddit's RSS returns 429 to the generic UA from datacenter IPs; a
    // browser-ish UA (same trick as the Telegram path) gets the feed through.
    const isReddit = /(^|\.)reddit\.com$/i.test((() => { try { return new URL(url).hostname; } catch { return ""; } })());
    const ua = isReddit
      ? "Mozilla/5.0 (compatible; DEAD-Dashboard/1.0; +https://github.com/jpmk12/dead-web-dashboard)"
      : "DEAD-Dashboard/1.0";
    const res = await fetch(url, {
      headers: { "User-Agent": ua, Accept: "application/rss+xml, application/atom+xml, application/xml" },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: OsintItem[] = [];
    const seenLinks = new Set<string>();

    const push = (entry: OsintItem) => {
      // Dedupe by link when present; otherwise by title (some feeds carry
      // both <item> and <entry> blocks describing the same content).
      const key = entry.link || entry.title;
      if (seenLinks.has(key)) return;
      seenLinks.add(key);
      items.push(entry);
    };

    // RSS <item> blocks
    for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
      const block = m[1];
      const title = extractTag(block, "title");
      const link = extractTag(block, "link");
      const description = extractTag(block, "description");
      const pubDate = extractTag(block, "pubDate") || extractTag(block, "dc:date");
      if (!title) continue;
      push({
        id: link || `${feedId}:${title.slice(0, 60)}-${pubDate}`,
        title: title.slice(0, 400),
        link,
        pubDate,
        summary: description.slice(0, 400),
        feedId, feedLabel: label, feedKind: kind,
      });
    }

    // Atom <entry> blocks — always run (some feeds mix both formats).
    for (const m of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
      const block = m[1];
      const title = extractTag(block, "title");
      const summary = extractTag(block, "summary") || extractTag(block, "content");
      const linkM = block.match(/<link[^>]+href="([^"]+)"/i);
      const link = linkM ? linkM[1] : "";
      const pubDate = extractTag(block, "updated") || extractTag(block, "published");
      if (!title) continue;
      push({
        id: link || `${feedId}:${title.slice(0, 60)}-${pubDate}`,
        title: title.slice(0, 400),
        link,
        pubDate,
        summary: summary.slice(0, 400),
        feedId, feedLabel: label, feedKind: kind,
      });
    }

    return items.slice(0, 12);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// Imported X posts (dead-x-capture files, lib/xStore) ride the feed as kind
// "social" so they inherit clustering / triage / watchlist / trends for free.
// Best-effort: no DB (or an empty store) just contributes nothing.
// Captured analysis articles (reader-capture, lib/articleStore) ride the feed as
// kind "news" so they're visible alongside everything else.
function articleToOsint(a: { id: string; url: string; title: string; source: string; byline: string | null; publishedAt: string | null; text: string; capturedAt: string }): OsintItem {
  return {
    id: `cap:${a.id}`,
    title: a.title.slice(0, 200),
    link: a.url,
    pubDate: a.publishedAt ?? a.capturedAt,
    summary: `${a.byline ? `${a.byline} — ` : ""}${a.text}`.slice(0, 400),
    feedId: "article-capture",
    feedLabel: `📄 ${a.source}`,
    feedKind: "news",
  };
}

function xToOsint(x: StoredXItem): OsintItem {
  const quoted = x.quoted?.text
    ? ` ⟪quoting ${x.quoted.handle ? `@${x.quoted.handle}` : x.quoted.author || "post"}: ${x.quoted.text.slice(0, 140)}⟫`
    : "";
  return {
    id: `x:${x.id}`,
    title: x.text.slice(0, 160),
    link: x.url,
    pubDate: x.postedAt ?? x.importedAt,
    summary: `${x.handle ? `@${x.handle}: ` : ""}${x.text}${quoted}`.slice(0, 400),
    feedId: "x-import",
    feedLabel: `𝕏 ${x.sourceLabel}`,
    feedKind: "social",
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prefs = await getUserPrefs(normEmail(session.user?.email)).catch(() => null);
  const feeds = prefs?.osintFeeds ?? [];
  const xItems = await getXItems().catch(() => [] as StoredXItem[]);
  const articles = await getCapturedArticles(200).catch(() => [] as StoredArticle[]);
  if (feeds.length === 0 && xItems.length === 0 && articles.length === 0) return NextResponse.json({ feeds: [], items: [] });

  // Per-feed cache so a single broken feed doesn't burn the whole batch.
  // Race the whole batch against an overall budget so a wedged feed can't
  // hold the client beyond TOTAL_BUDGET_MS; unresolved feeds fall back to
  // [] for this request. Per-result `fetchedAt` and `ok` flow through to
  // the feeds[] response for the health-dot UI in PreferencesDrawer.
  const fetchAll = Promise.all(feeds.map(async (f) => {
    const hit = cache.get(f.url);
    if (hit && hit.expires > Date.now()) {
      return { feed: f, items: hit.items, fetchedAt: hit.fetchedAt, ok: hit.ok };
    }
    let items: OsintItem[] = [];
    let ok = true;
    try {
      items = await fetchAndParse(f.url, f.id, f.label, f.kind);
    } catch {
      ok = false;
    }
    const fetchedAt = Date.now();
    cache.set(f.url, { items, expires: fetchedAt + TTL_MS, fetchedAt, ok });
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    return { feed: f, items, fetchedAt, ok };
  }));
  const budget = new Promise<{ feed: typeof feeds[number]; items: OsintItem[]; fetchedAt: number; ok: boolean }[]>(
    (resolve) => setTimeout(() => resolve(feeds.map((f) => ({ feed: f, items: [], fetchedAt: 0, ok: false }))), TOTAL_BUDGET_MS)
  );
  const results = await Promise.race([fetchAll, budget]);

  // Flat merge sorted by pubDate desc — live feeds, imported X posts, captured articles.
  const flat = [...results.flatMap((r) => r.items), ...xItems.map(xToOsint), ...articles.map(articleToOsint)];
  flat.sort((a, b) => {
    const ta = new Date(a.pubDate).getTime();
    const tb = new Date(b.pubDate).getTime();
    if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
    if (!Number.isFinite(ta)) return 1;
    if (!Number.isFinite(tb)) return -1;
    return tb - ta;
  });

  // Trend recorder (P1): one count per item ever (signal_seen absorbs the 90 s
  // poll). Fire-and-forget; can never slow the feed response.
  recordDailySignals(flat.map((it) => ({
    id: `osint|${it.link || it.id}`,
    terms: [
      ...topicTerms(it.title),
      { kind: "category" as const, term: it.feedKind },
      ...watchTermsIn(`${it.title} ${it.summary}`, prefs?.watchlist ?? []),
    ],
  }))).catch(() => {});

  return NextResponse.json({
    feeds: [
      ...feeds.map((f) => {
        const r = results.find((r) => r.feed.id === f.id);
        return {
          id: f.id,
          label: f.label,
          kind: f.kind,
          count: r?.items.length ?? 0,
          fetchedAt: r?.fetchedAt ?? 0,
          ok: r?.ok ?? false,
        };
      }),
      // Synthetic row for the X import store so its presence is OBSERVABLE in
      // the pane (count in the feed list = the server really merged them; a
      // populated card but no row here means a stale server bundle).
      ...(xItems.length > 0
        ? [{ id: "x-import", label: "𝕏 Capture import", kind: "social", count: xItems.length, fetchedAt: Date.now(), ok: true }]
        : []),
      ...(articles.length > 0
        ? [{ id: "article-capture", label: "📄 Article capture", kind: "news", count: articles.length, fetchedAt: Date.now(), ok: true }]
        : []),
    ],
    items: flat,
  });
}
