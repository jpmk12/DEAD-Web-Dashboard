import Parser from "rss-parser";
import { NewsItem } from "./types";

const parser = new Parser({
  customFields: {
    item: [["media:content", "mediaContent", { keepArray: false }]],
  },
});

export interface FeedResult {
  source: string;
  items: NewsItem[];
  ok: boolean;
  error?: string;
}

// In-memory cache: keyed by URL, entries expire after 5 minutes
const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map<string, { items: NewsItem[]; fetchedAt: number }>();

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/rss+xml, application/xml, text/xml, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

function categorizeRssError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("ETIMEDOUT")) return "connection_error";
  if (msg.match(/HTTP\s+[45]\d\d/)) return "http_error";
  if (msg.includes("certificate") || msg.includes("SSL") || msg.includes("TLS")) return "tls_error";
  if (msg.includes("parse") || msg.includes("XML") || msg.includes("JSON")) return "parse_error";
  return "fetch_error";
}

export async function fetchFeed(
  url: string,
  source: string,
  category: string
): Promise<FeedResult> {
  // Serve from cache if fresh
  const cached = cache.get(url);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return { source, ok: true, items: cached.items };
  }

  try {
    // 10-second hard timeout per feed so one slow source can't block the others
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    let text: string;
    try {
      const res = await fetch(url, { signal: controller.signal, headers: FETCH_HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } finally {
      clearTimeout(timer);
    }

    const feed = await parser.parseString(text);
    const items: NewsItem[] = feed.items.slice(0, 12).map((item, i) => ({
      id: item.guid || item.link || `${source}-${i}`,
      title: item.title || "Untitled",
      source,
      category,
      pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
      summary: stripHtml(item.contentSnippet || item.summary || item.content || ""),
      link: item.link || "",
      imageUrl: extractImage(item),
    }));

    cache.set(url, { items, fetchedAt: Date.now() });
    return { source, ok: true, items };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`RSS fetch failed for ${source}: ${message}`);
    // Return stale cache on failure rather than an empty result
    const stale = cache.get(url);
    if (stale) return { source, ok: true, items: stale.items };
    return { source, ok: false, items: [], error: categorizeRssError(err) };
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractImage(item: any): string | undefined {
  if (item.mediaContent?.["$"]?.url) return item.mediaContent["$"].url;
  if (item.enclosure?.url) return item.enclosure.url;
  const match = (item.content || "").match(/<img[^>]+src="([^"]+)"/);
  return match?.[1];
}
