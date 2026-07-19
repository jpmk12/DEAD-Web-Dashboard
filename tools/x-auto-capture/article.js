// Reader-capture extractor — injected into the ACTIVE tab when you click the
// toolbar icon while reading an article (e.g. WSJ via DoD MWR Libraries). Pulls
// the article's title/byline/date/body and returns a `dead-article` object for
// upload. Self-contained (serialized for executeScript func) — page globals only.
//
// MANUAL, one-article-at-a-time: this fires on YOUR click on the piece you're
// reading. It is not a harvester.
//
// Generic Readability-lite heuristics (the proxy DOM is unknown): if the body
// comes back thin/empty on a given source, tune the selectors here.
export function extractArticle() {
  const meta = (name) => {
    const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
    return el ? (el.getAttribute("content") || "") : "";
  };
  const firstText = (sel) => {
    const el = document.querySelector(sel);
    return el ? (el.innerText || "").trim() : "";
  };

  const title = (meta("og:title") || firstText("h1") || document.title || "").trim();
  const byline = (meta("author") || meta("article:author") ||
    firstText('[rel="author"], [itemprop="author"], .byline, [class*="byline"], [class*="Byline"], [data-testid*="author"]')).trim();
  const publishedAt = meta("article:published_time") || meta("date") ||
    (document.querySelector("time[datetime]") ? document.querySelector("time[datetime]").getAttribute("datetime") : "") || "";

  // Body: prefer <article>; else the container with the most paragraph text.
  let container = document.querySelector("article");
  if (!container) {
    let best = null, bestLen = 0;
    document.querySelectorAll("main, section, div, [class*='article'], [class*='Article'], [class*='body'], [class*='content']").forEach((el) => {
      const ps = el.querySelectorAll("p");
      if (ps.length < 3) return;
      let len = 0;
      ps.forEach((p) => { len += (p.innerText || "").length; });
      if (len > bestLen) { bestLen = len; best = el; }
    });
    container = best;
  }

  let text = "";
  if (container) {
    const parts = [];
    container.querySelectorAll("p, h2, h3, li, blockquote").forEach((el) => {
      // Skip obvious chrome/nav/aside blocks.
      if (el.closest("nav, aside, footer, header, form, [role='navigation']")) return;
      const t = (el.innerText || "").trim();
      if (t && t.length > 1) parts.push(t);
    });
    text = parts.join("\n\n");
  }
  if (text.length < 200) {
    // Fallback: whole-body innerText, trimmed. Better a rough capture than none.
    const bodyText = (document.body ? document.body.innerText : "") || "";
    if (bodyText.length > text.length) text = bodyText.slice(0, 40000);
  }

  const canonical = document.querySelector('link[rel="canonical"]');
  const url = (canonical && canonical.href) || location.href;
  const source = (meta("og:site_name") || location.hostname.replace(/^www\./, "")).slice(0, 80);

  return {
    format: "dead-article",
    version: 1,
    url,
    title,
    byline,
    publishedAt,
    source,
    text: text.slice(0, 60000),
    capturedAt: new Date().toISOString(),
  };
}
