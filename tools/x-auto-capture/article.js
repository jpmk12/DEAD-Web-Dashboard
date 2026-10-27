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
//
// What the saved pages (2026-10-27) taught:
//   - Foreign Policy is a plain `<article>` with JSON-LD NewsArticle
//     (headline, datePublished, author) and no article:published_time meta.
//   - The Economist's "The world in brief" has NO `<article>`: it is
//     `<main id="content">` holding a dozen `<h2>` items, each a few
//     paragraphs — a DIGEST. Captured as one body, the dashboard's
//     corroboration read saw only the first two items. So: JSON-LD is read
//     FIRST for the masthead; `main` is preferred after `article`; and a
//     digest-shaped page (several headed sections of real text) is returned
//     as `sections[]` so the server stores one item per section.
export function extractArticle() {
  const meta = (name) => {
    const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
    return el ? (el.getAttribute("content") || "") : "";
  };
  const firstText = (sel) => {
    const el = document.querySelector(sel);
    return el ? (el.innerText || "").trim() : "";
  };
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  // JSON-LD: the publisher's own structured record. NewsArticle / Article
  // (also inside @graph), the first one wins.
  let ld = null;
  try {
    const nodes = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        const j = JSON.parse(s.textContent || "");
        const list = Array.isArray(j) ? j : j && Array.isArray(j["@graph"]) ? j["@graph"] : [j];
        list.forEach((n) => { if (n && typeof n === "object") nodes.push(n); });
      } catch (e) { /* a malformed block is skipped */ }
    });
    ld = nodes.find((n) => /^(?:News)?Article$|^(?:Report|ScholarlyArticle|BlogPosting|AnalysisNewsArticle|OpinionNewsArticle)$/.test(String(n["@type"] || "")) || (Array.isArray(n["@type"]) && n["@type"].some((t) => /Article/.test(String(t))))) || null;
  } catch (e) { ld = null; }
  const ldAuthor = (() => {
    if (!ld) return "";
    const a = ld.author;
    const name = (x) => (x && typeof x === "object" ? x.name : typeof x === "string" ? x : "") || "";
    return clean(Array.isArray(a) ? a.map(name).filter(Boolean).join(", ") : name(a));
  })();

  const title = clean((ld && ld.headline) || meta("og:title") || firstText("h1") || document.title || "");
  const byline = clean(ldAuthor || meta("author") || meta("article:author") ||
    firstText('[rel="author"], [itemprop="author"], .byline, [class*="byline"], [class*="Byline"], [data-testid*="author"]'));
  const publishedAt = (ld && (ld.datePublished || ld.dateCreated)) || meta("article:published_time") || meta("date") ||
    (document.querySelector("time[datetime]") ? document.querySelector("time[datetime]").getAttribute("datetime") : "") || "";

  // Body: prefer <article>; then <main>; else the container with the most paragraph text.
  const CHROME = "nav, aside, footer, header, form, [role='navigation'], [class*='newsletter'], [class*='subscribe'], [class*='related'], [class*='promo'], [class*='recommend'], [class*='paywall'], [class*='share'], [aria-hidden='true']";
  let container = document.querySelector("article");
  if (!container) container = document.querySelector("main");
  if (!container || container.querySelectorAll("p").length < 3) {
    let best = container, bestLen = 0;
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
  const sections = [];
  if (container) {
    const parts = [];
    // Walk headed sections as we go: an h2/h3 opens a section, the
    // paragraphs after it belong to it. A page with several substantial
    // sections is a digest.
    let cur = null;
    container.querySelectorAll("h2, h3, p, li, blockquote").forEach((el) => {
      if (el.closest(CHROME)) return;
      const t = (el.innerText || "").trim();
      if (!t || t.length < 2) return;
      parts.push(t);
      if (/^H[23]$/.test(el.tagName)) { cur = { heading: clean(t).slice(0, 200), parts: [] }; sections.push(cur); }
      else if (cur) cur.parts.push(t);
    });
    text = parts.join("\n\n");
  }
  if (text.length < 200) {
    // Fallback: whole-body innerText, trimmed. Better a rough capture than none.
    const bodyText = (document.body ? document.body.innerText : "") || "";
    if (bodyText.length > text.length) text = bodyText.slice(0, 40000);
  } else if (!text && ld && typeof ld.articleBody === "string" && ld.articleBody.length > 200) {
    text = ld.articleBody;
  }

  // Digest detection: at least four headed sections whose own text runs to
  // 120+ characters each, and most of the body inside them.
  const real = sections.map((s) => ({ heading: s.heading, text: s.parts.join("\n\n") })).filter((s) => s.heading.length >= 4 && s.text.length >= 120);
  const inSections = real.reduce((n, s) => n + s.text.length, 0);
  const digest = real.length >= 4 && inSections >= text.length * 0.5 ? real.slice(0, 24) : [];

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
    sections: digest,
    capturedAt: new Date().toISOString(),
  };
}
