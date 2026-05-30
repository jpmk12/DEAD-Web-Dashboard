import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Diagnostic endpoint for the OSINT Feeds editor. Runs the same fetch
// pipeline as /api/osint/feed against a single user-supplied URL and reports
// what came back — HTTP status, content type, byte size, item / entry tag
// count, parsed-item count, and the first item's title as proof the parser
// saw something.
//
// Common failure modes the UI surfaces from this output:
//   - status 4xx/5xx → upstream rejected
//   - status 200 but 0 items found → likely a Twitter-bridge block
//   - hint for known-problematic upstreams (rsshub.app + twitter pattern)

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

function extractTitle(xml: string): string {
  // Try RSS first, then Atom — match the very first occurrence, not the
  // channel-level title (which would be the feed name, not a post title).
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/i;
  const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/i;
  const m = xml.match(itemRe) || xml.match(entryRe);
  if (!m) return "";
  const titleM = m[1].match(/<title\b[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
  return titleM ? titleM[1].replace(/\s+/g, " ").trim().slice(0, 180) : "";
}

interface DiagnosticResult {
  ok: boolean;
  url: string;
  // The HTTP layer
  status?: number;
  statusText?: string;
  contentType?: string;
  bytes?: number;
  // The parse layer
  itemTagCount?: number;
  entryTagCount?: number;
  parsedItems?: number;
  firstTitle?: string;
  // Top-level diagnostic
  durationMs: number;
  error?: string;
  hint?: string;
  // Alternative URLs the client can offer as one-click swaps when we can
  // recognise the bridge pattern and the upstream is blocking us.
  alternatives?: string[];
}

// Known-alive (as of late 2025) alternative public RSSHub instances. They
// rotate availability constantly — the user's network may reach one when
// rsshub.app is blocked. If all of them fail too, self-hosting is the only
// durable answer.
const RSSHUB_INSTANCES = [
  "rsshub.app",
  "rsshub.atgw.io",
  "rsshub.kkkk.icu",
  "rsshub.rssforever.com",
];

// Build alternative URLs by swapping the rsshub host for each instance the
// caller isn't already on. Returns at most 3 to keep the test panel compact.
function rsshubAlternatives(url: string): string[] {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return []; }
  const host = parsed.hostname.toLowerCase();
  if (!/(^|\.)rsshub\./.test(host) && host !== "rsshub.app") return [];
  const others = RSSHUB_INSTANCES.filter((h) => h !== host);
  return others.slice(0, 3).map((h) => {
    const next = new URL(url);
    next.hostname = h;
    return next.toString();
  });
}

function diagnose(opts: { url: string; status?: number; xml?: string; error?: string }): { hint?: string; alternatives?: string[] } {
  const { url, status, xml, error } = opts;
  const lowerUrl = url.toLowerCase();
  const isRsshub = /(^|\.)rsshub\.|rsshub\.app/.test(new URL(url).hostname.toLowerCase());
  const isTwitterPath = /\b(twitter|x\.com|user\/|status\/)\b/.test(lowerUrl) && isRsshub;
  const isTelegramPath = /\/telegram\//.test(lowerUrl) && isRsshub;
  const alternatives = rsshubAlternatives(url);

  if (error?.includes("aborted") || error?.includes("timeout") || error?.includes("Timed out")) {
    if (isRsshub) {
      return {
        hint: "Bridge timed out (8 s). The instance is overloaded — try a different rsshub instance below, or self-host (https://docs.rsshub.app).",
        alternatives,
      };
    }
    return { hint: "Upstream did not respond in 8 s." };
  }
  if (status === 429 || status === 403) {
    if (isTelegramPath) {
      return {
        hint: "This rsshub instance is blocking your network (Telegram itself doesn't block scrapers — the bridge does). Try a different instance below, or self-host.",
        alternatives,
      };
    }
    if (isTwitterPath) {
      return {
        hint: "Upstream (Twitter/X) blocked the bridge. Twitter actively bans scrapers — try a different rsshub instance, but Twitter bridges are unreliable across the board.",
        alternatives,
      };
    }
    if (isRsshub) {
      return {
        hint: "This rsshub instance is rate-limiting your network. Try a different instance below.",
        alternatives,
      };
    }
    return { hint: "Upstream rate-limited or blocked us." };
  }
  if (status === 404) {
    if (isRsshub) {
      return {
        hint: "Route not found on this instance. The channel/account slug may be wrong (verify on t.me/SLUG) or this instance disabled the route.",
        alternatives,
      };
    }
    return { hint: "Upstream returned 404 — the bridge route may have been removed or renamed." };
  }
  if (status && status >= 500) {
    if (isRsshub) {
      return {
        hint: "Bridge instance returned 5xx. Try a different instance below.",
        alternatives,
      };
    }
    return { hint: "Upstream returned a 5xx error — bridge is having problems." };
  }
  if (status === 200 && xml !== undefined) {
    const itemCount = (xml.match(/<item\b/gi) || []).length;
    const entryCount = (xml.match(/<entry\b/gi) || []).length;
    if (itemCount === 0 && entryCount === 0) {
      if (isTwitterPath) {
        return {
          hint: "Empty feed. X/Twitter actively blocks scrapers; even when rsshub returns 200 the items vanish. Twitter bridges are unreliable across the board.",
          alternatives,
        };
      }
      if (isTelegramPath) {
        return {
          hint: "Empty feed. Either the slug is wrong (search t.me/SLUG to verify) or this bridge instance is serving a stub.",
          alternatives,
        };
      }
      return { hint: "Feed returned 200 but contains no <item> or <entry> blocks. The bridge may be returning an error page disguised as RSS." };
    }
  }
  return {};
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: { url?: string } = {};
  try { body = await req.json(); } catch { /* fall through */ }
  const url = typeof body.url === "string" ? body.url.trim() : "";

  const start = Date.now();
  const result: DiagnosticResult = { ok: false, url, durationMs: 0 };

  if (!url) {
    result.error = "Missing URL";
    result.durationMs = Date.now() - start;
    return NextResponse.json(result, { status: 400 });
  }

  // SSRF gate identical to the real feed route.
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      result.error = "Only http:// and https:// are allowed";
      result.durationMs = Date.now() - start;
      return NextResponse.json(result, { status: 400 });
    }
    if (parsed.username || parsed.password) {
      result.error = "URLs with embedded credentials are blocked";
      result.durationMs = Date.now() - start;
      return NextResponse.json(result, { status: 400 });
    }
    if (!isSafeHostname(parsed.hostname.toLowerCase())) {
      result.error = "Hostname is private or reserved";
      result.durationMs = Date.now() - start;
      return NextResponse.json(result, { status: 400 });
    }
  } catch {
    result.error = "Invalid URL";
    result.durationMs = Date.now() - start;
    return NextResponse.json(result, { status: 400 });
  }

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "DEAD-Dashboard/1.0",
        Accept: "application/rss+xml, application/atom+xml, application/xml",
      },
      cache: "no-store",
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    result.status = res.status;
    result.statusText = res.statusText;
    result.contentType = res.headers.get("content-type") ?? undefined;

    const xml = await res.text();
    result.bytes = xml.length;
    result.itemTagCount = (xml.match(/<item\b/gi) || []).length;
    result.entryTagCount = (xml.match(/<entry\b/gi) || []).length;
    result.firstTitle = extractTitle(xml);
    result.parsedItems = result.itemTagCount + result.entryTagCount;
    result.ok = res.ok && (result.itemTagCount > 0 || result.entryTagCount > 0);

    const d = diagnose({ url, status: res.status, xml });
    if (d.hint) result.hint = d.hint;
    if (d.alternatives && d.alternatives.length > 0) result.alternatives = d.alternatives;
  } catch (err) {
    clearTimeout(tid);
    const msg = err instanceof Error ? err.message : "Unknown fetch error";
    result.error = msg.includes("aborted") ? "Timed out after 8 s" : msg;
    const d = diagnose({ url, error: msg });
    if (d.hint) result.hint = d.hint;
    if (d.alternatives && d.alternatives.length > 0) result.alternatives = d.alternatives;
  }

  result.durationMs = Date.now() - start;
  return NextResponse.json(result);
}
