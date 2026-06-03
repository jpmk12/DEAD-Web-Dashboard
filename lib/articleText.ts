// Dependency-free article-text extraction. Best-effort: fetch the page over
// HTTPS, isolate the main content, strip markup, and return readable text — or
// null when the fetch fails, the page is blocked/paywalled, or there's too
// little text to be useful (callers fall back to the RSS summary).
//
// This is deliberately lightweight (no readability/cheerio dependency — the
// platform's esbuild constraints make heavy deps risky). It won't beat a real
// readability parser, but on most news sites it yields far more than the RSS
// blurb, which is what the thesis feature needs.

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 1_500_000;     // stop reading huge pages
const MAX_TEXT_CHARS = 6_000;    // plenty for a thesis; keeps token cost low
const MIN_USEFUL_CHARS = 600;    // below this, prefer the caller's summary

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BLOCK_TAGS = ["script", "style", "noscript", "svg", "head", "header", "footer", "nav", "aside", "form", "figure", "iframe"];

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
}

function stripToText(html: string): string {
  let h = html;
  for (const tag of BLOCK_TAGS) {
    h = h.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi"), " ");
  }
  // Prefer the main content region when present, to drop chrome/boilerplate.
  const region =
    h.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    h.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    h;
  return decodeEntities(
    region
      .replace(/<[^>]+>/g, " ")   // drop remaining tags
      .replace(/\s+/g, " ")       // collapse whitespace
      .trim()
  );
}

export async function extractArticleText(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") ?? "";
    if (!/html/i.test(ctype)) return null;

    // Read with a hard byte cap so a giant page can't blow memory.
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
        if (total >= MAX_BYTES) { await reader.cancel(); break; }
      }
    }
    const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");

    const text = stripToText(html);
    if (text.length < MIN_USEFUL_CHARS) return null;
    return text.slice(0, MAX_TEXT_CHARS);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
