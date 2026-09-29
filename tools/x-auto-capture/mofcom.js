// Collector for a PRC Ministry of Commerce (MOFCOM) page — the announcements
// list (政务公开 → 公告 / the English "Policy Release" list) or one notice.
// Injected by the background worker; runs in the user's own browser. MOFCOM
// has no API and its site is unfriendly to datacenter fetches, so the export-
// control / unreliable-entity / anti-dumping notices reach the dashboard only
// this way — the same capture-then-parse pattern as LiveUAMap. Self-contained
// for executeScript func injection — page globals only. Nothing is sent to
// MOFCOM; no login exists.
//
// Robustness: it keys off the ARTICLE PERMALINK shape MOFCOM's CMS has used
// for years (/article/…/2YYYMM/2YYYMMDD….shtml — the date is in the path) and
// on a nearby YYYY-MM-DD label, never on CSS classes. On a single notice page
// it also captures the body text so the parser can read what the notice
// controls (gallium, graphite, dual-use items…), not just its title.
export async function collectMofcom(durationMs, maxItems) {
  const MAX = maxItems || 200;
  const store = new Map();
  const ARTICLE = /\/article\/.*\/(20\d{6})\d*\.s?html?(\?|$)|\/(20\d{6})[^/]*\.s?html?(\?|$)/i;
  const DATE_RX = /(20\d\d)[-./年](\d{1,2})[-./月](\d{1,2})/;
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const dateFrom = (text, href) => {
    const m = DATE_RX.exec(text || "");
    if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
    const p = ARTICLE.exec(href || "");
    const d = p && (p[1] || p[3]);
    return d ? d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8) : "";
  };

  // 1. The list view: every article permalink on the page.
  document.querySelectorAll('a[href*="/article/"], a[href$=".shtml"], a[href$=".html"]').forEach((a) => {
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
  });

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

  // Give a slow CMS a moment to finish rendering a paginated list.
  const end = Date.now() + Math.min(durationMs || 5000, 8000);
  while (Date.now() < end && store.size === 0) await new Promise((r) => setTimeout(r, 500));

  return {
    format: "dead-notices",
    version: 1,
    capturedAt: new Date().toISOString(),
    source: { kind: "mofcom", label: "MOFCOM", host: location.hostname, pageTitle: clean(document.title).slice(0, 120) },
    items: Array.from(store.values()).slice(0, MAX),
  };
}
