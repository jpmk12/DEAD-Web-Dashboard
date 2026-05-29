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
}

function diagnose(opts: { url: string; status?: number; xml?: string; error?: string }): { hint?: string } {
  const { url, status, xml, error } = opts;
  // Twitter / X via rsshub: the most reliable failure mode by far. Surface a
  // specific suggestion when we see the pattern.
  const isTwitterBridge =
    /rsshub|nitter/i.test(url) &&
    /\b(twitter|x\.com|status|user)\b/i.test(url);
  if (error?.includes("aborted") || error?.includes("timeout")) {
    return { hint: "Upstream did not respond in 8 s — rsshub instances are frequently overloaded. Try a different instance." };
  }
  if (status === 429 || status === 403) {
    return { hint: "Upstream rate-limited or blocked us. For Twitter/X this is normal — try a different bridge instance." };
  }
  if (status === 404) {
    return { hint: "Upstream returned 404 — the bridge route may have been removed or renamed." };
  }
  if (status && status >= 500) {
    return { hint: "Upstream returned a 5xx error — bridge is having problems. Try again later or use a different instance." };
  }
  if (status === 200 && xml !== undefined) {
    const itemCount = (xml.match(/<item\b/gi) || []).length;
    const entryCount = (xml.match(/<entry\b/gi) || []).length;
    if (itemCount === 0 && entryCount === 0) {
      if (isTwitterBridge) {
        return { hint: "Empty feed. X/Twitter actively blocks scrapers — rsshub.app for Twitter is broken most days. Try one of the alternative instances suggested below." };
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

    const { hint } = diagnose({ url, status: res.status, xml });
    if (hint) result.hint = hint;
  } catch (err) {
    clearTimeout(tid);
    const msg = err instanceof Error ? err.message : "Unknown fetch error";
    result.error = msg.includes("aborted") ? "Timed out after 8 s" : msg;
    const { hint } = diagnose({ url, error: msg });
    if (hint) result.hint = hint;
  }

  result.durationMs = Date.now() - start;
  return NextResponse.json(result);
}
