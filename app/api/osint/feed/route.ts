import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";

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
const cache = new Map<string, { items: OsintItem[]; expires: number }>();

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

async function fetchAndParse(url: string, feedId: string, label: string, kind: string): Promise<OsintItem[]> {
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
    const res = await fetch(url, {
      headers: { "User-Agent": "DEAD-Dashboard/1.0", Accept: "application/rss+xml, application/atom+xml, application/xml" },
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

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prefs = await getUserPrefs().catch(() => null);
  const feeds = prefs?.osintFeeds ?? [];
  if (feeds.length === 0) return NextResponse.json({ feeds: [], items: [] });

  // Per-feed cache so a single broken feed doesn't burn the whole batch.
  // Race the whole batch against an overall budget so a wedged feed can't
  // hold the client beyond TOTAL_BUDGET_MS; unresolved feeds fall back to
  // [] for this request.
  const fetchAll = Promise.all(feeds.map(async (f) => {
    const hit = cache.get(f.url);
    if (hit && hit.expires > Date.now()) return { feed: f, items: hit.items };
    const items = await fetchAndParse(f.url, f.id, f.label, f.kind);
    cache.set(f.url, { items, expires: Date.now() + TTL_MS });
    // LRU evict the oldest entry if we've exceeded the soft cap.
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    return { feed: f, items };
  }));
  const budget = new Promise<{ feed: typeof feeds[number]; items: OsintItem[] }[]>(
    (resolve) => setTimeout(() => resolve(feeds.map((f) => ({ feed: f, items: [] }))), TOTAL_BUDGET_MS)
  );
  const results = await Promise.race([fetchAll, budget]);

  // Flat merge sorted by pubDate desc.
  const flat = results.flatMap((r) => r.items);
  flat.sort((a, b) => {
    const ta = new Date(a.pubDate).getTime();
    const tb = new Date(b.pubDate).getTime();
    if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
    if (!Number.isFinite(ta)) return 1;
    if (!Number.isFinite(tb)) return -1;
    return tb - ta;
  });

  return NextResponse.json({
    feeds: feeds.map((f) => ({ id: f.id, label: f.label, kind: f.kind, count: results.find((r) => r.feed.id === f.id)?.items.length ?? 0 })),
    items: flat,
  });
}
