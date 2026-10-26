// Collector for a PRC Ministry of Commerce (MOFCOM) page — the announcements
// list (政务公开 → 公告 / the English "Policy Release" list) or one notice.
// Injected by the background worker; runs in the user's own browser. MOFCOM
// has no API and its site is unfriendly to datacenter fetches, so the export-
// control / unreliable-entity / anti-dumping notices reach the dashboard only
// this way — the same capture-then-parse pattern as LiveUAMap. Self-contained
// for executeScript func injection — page globals only. Nothing is sent to
// MOFCOM; no login exists.
//
// Robustness: it keys off the ARTICLE PERMALINK shapes, never CSS classes:
//   - the CURRENT CMS (www.mofcom.gov.cn since the 2023 redesign, and the
//     official bulletin mirror bgt.mofcom.gov.cn, which republishes every
//     announcement): …/art/20YY/art_<hex>.html — only the YEAR is in the
//     path, so the date comes from the nearby YYYY-MM-DD label and is left
//     blank when none is near (never guessed);
//   - the OLD CMS (english.mofcom.gov.cn still): /article/…/2YYYMMDD….shtml
//     — the full date is in the path.
// The first real run (2026-10-26) found the old listing path 404 and the
// old shape alone would have matched nothing on the new one. On a single
// notice page it also captures the body text so the parser can read what
// the notice controls (gallium, graphite, dual-use items…), not its title only.
export async function collectMofcom(durationMs, maxItems) {
  const MAX = maxItems || 200;
  const store = new Map();
  const OLD_ARTICLE = /\/article\/.*\/(20\d{6})\d*\.s?html?(\?|$)|\/(20\d{6})[^/]*\.s?html?(\?|$)/i;
  const NEW_ARTICLE = /\/art\/(20\d\d)\/art_[0-9a-f]{8,}\.s?html?(\?|#|$)/i;
  const ARTICLE = { test: (h) => OLD_ARTICLE.test(h) || NEW_ARTICLE.test(h) };
  const DATE_RX = /(20\d\d)[-./年](\d{1,2})[-./月](\d{1,2})/;
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const dateFrom = (text, href) => {
    const m = DATE_RX.exec(text || "");
    if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
    const p = OLD_ARTICLE.exec(href || "");
    const d = p && (p[1] || p[3]);
    return d ? d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8) : "";
  };

  // 1. The list view: every article permalink on the page.
  const take = (a) => {
    try {
      if (store.size >= MAX) return;
      const href = a.href;
      if (!ARTICLE.test(href)) return;
      const title = clean(a.innerText || a.getAttribute("title"));
      if (!title || title.length < 6) return;
      if (store.has(href)) return;
      const row = a.closest("li, tr, .list-item, [class*='item'], p") || a.parentElement;
      const date = dateFrom(row ? row.innerText : "", href);
      store.set(href, { url: href, title: title.slice(0, 300), date });
    } catch (e) { /* one bad node never kills the capture */ }
  };
  document.querySelectorAll('a[href*="/article/"], a[href*="/art/"], a[href$=".shtml"], a[href$=".html"]').forEach(take);

  // 2. A single notice page: title + body, so the parser sees the controlled
  //    items. Detected by an article-shaped location plus a heading.
  if (ARTICLE.test(location.href)) {
    try {
      const h = document.querySelector("h1, .artTitle, .art-title, [class*='title']");
      const title = clean(h ? h.innerText : document.title);
      const bodyEl = document.querySelector(".article-content, #zoom, .TRS_Editor, .content, article, .artCon, [class*='content']");
      const body = clean(bodyEl ? bodyEl.innerText : "").slice(0, 6000);
      const date = dateFrom(document.body.innerText.slice(0, 3000), location.href);
      if (title && title.length >= 6) store.set(location.href, { url: location.href, title: title.slice(0, 300), date, body });
    } catch (e) { /* fall through with the list */ }
  }

  // Give a slow CMS a moment to finish rendering a paginated list — and look
  // AGAIN once it has (the first pass ran on whatever had rendered).
  const end = Date.now() + Math.min(durationMs || 12000, 15000);
  while (Date.now() < end && store.size === 0) {
    await new Promise((r) => setTimeout(r, 700));
    try { document.querySelectorAll("a[href]").forEach((a) => take(a)); } catch (e) { /* retry on the next tick */ }
  }

  return {
    format: "dead-notices",
    version: 1,
    capturedAt: new Date().toISOString(),
    source: { kind: "mofcom", label: "MOFCOM", host: location.hostname, pageTitle: clean(document.title).slice(0, 120) },
    items: Array.from(store.values()).slice(0, MAX),
  };
}
