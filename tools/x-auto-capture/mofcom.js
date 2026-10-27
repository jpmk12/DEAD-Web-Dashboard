// Collector for a PRC Ministry of Commerce (MOFCOM) page — the announcements
// list (政务公开 → 公告 / the English "Policy Release" list), the official
// bulletin 中国对外经济贸易文告 (bgt.mofcom.gov.cn/wg/), or one notice.
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
//
// What the saved bulletin page (2026-10-27) taught, both fixed here:
//   1. The LIST IS RENDERED BY SCRIPT. The static HTML carries an empty
//      `.listCon` and a loader (`AuthorizedRead/unitbuild.js`, which asks the
//      CMS's `jpaas-publish-server` for the "信息列表" unit); the rows exist
//      only after that round trip. The collector now WAITS for a list
//      region to hold article links (up to the time budget) before it
//      harvests.
//   2. The page's own chrome carries article-shaped links — the sidebar's
//      "关于我们" rows (`/gywm/art/2026/art_….html`: 办公厅职能, 内设机构) —
//      which matched the permalink shape and would have been captured as
//      NOTICES. Worse, they made the store non-empty at once, so the old
//      "wait while empty" loop returned before the real list rendered.
//      Links inside aside / nav / header / footer / breadcrumbs, and any
//      path under /gywm/ (about us), are skipped.
export async function collectMofcom(durationMs, maxItems) {
  const MAX = maxItems || 200;
  const store = new Map();
  const OLD_ARTICLE = /\/article\/.*\/(20\d{6})\d*\.s?html?(\?|$)|\/(20\d{6})[^/]*\.s?html?(\?|$)/i;
  const NEW_ARTICLE = /\/art\/(20\d\d)\/art_[0-9a-f]{8,}\.s?html?(\?|#|$)/i;
  const ARTICLE = { test: (h) => OLD_ARTICLE.test(h) || NEW_ARTICLE.test(h) };
  const CHROME_PATH = /\/(?:gywm|about|lxwm|contact|wzdt|sitemap)\//i;   // "about us", contact, site map
  const DATE_RX = /(20\d\d)[-./年](\d{1,2})[-./月](\d{1,2})/;
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dateFrom = (text, href) => {
    const m = DATE_RX.exec(text || "");
    if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
    const p = OLD_ARTICLE.exec(href || "");
    const d = p && (p[1] || p[3]);
    return d ? d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8) : "";
  };
  // The page's own chrome: a link inside any of these is navigation, not a notice.
  const inChrome = (a) => !!a.closest("aside, nav, header, footer, .location, .breadcrumb, [class*='crumb'], [class*='nav'], [class*='menu'], [class*='footer'], [class*='header'], .jgRBox, [class*='rColumn']");
  // The list region(s) a CMS renders rows into — polled until they hold links.
  const listRegions = () => Array.from(document.querySelectorAll(".listCon, .listBox, [class*='listCon'], [class*='list-con'], ul[class*='list'], div[class*='list'], main, #content, .content"));
  const listLinks = () => {
    let n = 0;
    for (const r of listRegions()) r.querySelectorAll("a[href]").forEach((a) => { if (ARTICLE.test(a.href) && !inChrome(a) && !CHROME_PATH.test(a.pathname || "")) n++; });
    return n;
  };

  // 1. The list view: every article permalink on the page outside the chrome.
  const take = (a) => {
    try {
      if (store.size >= MAX) return;
      const href = a.href;
      if (!ARTICLE.test(href)) return;
      if (inChrome(a) || CHROME_PATH.test(a.pathname || "")) return;
      const title = clean(a.innerText || a.getAttribute("title"));
      if (!title || title.length < 6) return;
      if (store.has(href)) return;
      const row = a.closest("li, tr, .list-item, [class*='item'], p") || a.parentElement;
      const date = dateFrom(row ? row.innerText : "", href);
      store.set(href, { url: href, title: title.slice(0, 300), date });
    } catch (e) { /* one bad node never kills the capture */ }
  };
  const scan = () => { try { document.querySelectorAll('a[href*="/article/"], a[href*="/art/"], a[href$=".shtml"], a[href$=".html"]').forEach(take); } catch (e) { /* retry next tick */ } };

  // 2. A single notice page: title + body, so the parser sees the controlled
  //    items. Detected by an article-shaped location plus a heading.
  const onNotice = ARTICLE.test(location.href);
  if (onNotice) {
    try {
      const h = document.querySelector("h1, .artTitle, .art-title, [class*='title']");
      const title = clean(h ? h.innerText : document.title);
      const bodyEl = document.querySelector(".article-content, #zoom, .TRS_Editor, .content, article, .artCon, [class*='content']");
      const body = clean(bodyEl ? bodyEl.innerText : "").slice(0, 6000);
      const date = dateFrom(document.body.innerText.slice(0, 3000), location.href);
      if (title && title.length >= 6) store.set(location.href, { url: location.href, title: title.slice(0, 300), date, body });
    } catch (e) { /* fall through with the list */ }
  }

  // 3. Wait for the SCRIPT-RENDERED list: poll until a list region holds
  //    article links (or the budget ends), then harvest; keep scanning a
  //    few more ticks in case the list fills in pages.
  const end = Date.now() + Math.min(durationMs || 15000, 25000);
  let had = listLinks();
  while (Date.now() < end && had === 0 && !onNotice) { await sleep(700); had = listLinks(); }
  scan();
  if (!onNotice) {
    let stable = 0, last = store.size;
    while (Date.now() < end && stable < 3) {
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(700);
      scan();
      if (store.size === last) stable++; else { stable = 0; last = store.size; }
    }
  }

  return {
    format: "dead-notices",
    version: 1,
    capturedAt: new Date().toISOString(),
    source: { kind: "mofcom", label: "MOFCOM", host: location.hostname, pageTitle: clean(document.title).slice(0, 120) },
    // Said for the run log when the list never rendered: how many list
    // regions the page had and how many article links they held.
    diag: { listRegions: listRegions().length, listLinks: listLinks(), waitedMs: Math.min(durationMs || 15000, 25000) },
    items: Array.from(store.values()).slice(0, MAX),
  };
}
