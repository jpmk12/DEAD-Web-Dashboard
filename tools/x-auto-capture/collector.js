// Injected into the x.com tab by the background worker via
// chrome.scripting.executeScript({ func: collectXPosts, args: [...] }).
//
// MUST stay SELF-CONTAINED — it's serialized by source and runs in the page
// context, so it may reference only page globals (document/window/location) and
// its own args, never module-scope helpers or imports.
//
// It accumulates X's VIRTUALIZED timeline while auto-scrolling (posts leave the
// DOM as they scroll off, so a one-shot snapshot sees only ~5-10), then returns a
// `dead-x-capture` v1 object — the exact shape the bookmarklet downloads and the
// dashboard's parser (lib/xImport.ts) accepts. It downloads nothing, sends
// nothing to X, and reads no credentials.
//
// Selector churn lives HERE (same suspects as the bookmarklet): if captures come
// back with empty authors/text, X changed its DOM — fix the selectors below.
export async function collectXPosts(durationMs, maxPosts) {
  const MAX = maxPosts || 200;
  const store = new Map();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const grab = () => {
    document.querySelectorAll('article[data-testid="tweet"]').forEach((a) => {
      try {
        if (store.size >= MAX) return;
        const timeEl = a.querySelector('a[href*="/status/"] time');
        const linkEl = timeEl ? timeEl.closest('a') : null;
        const url = linkEl ? new URL(linkEl.getAttribute('href'), location.origin).href : '';
        const idMatch = url.match(/status\/(\d+)/);
        // The post's own text is the FIRST tweetText; a second one inside a
        // role=link block is the QUOTED post (its text matters — "6x KC-135
        // heading east" is often the quoted part of a comment).
        const texts = Array.from(a.querySelectorAll('[data-testid="tweetText"]'));
        const textEl = texts[0] || null;
        const text = textEl ? textEl.innerText : '';
        if (!text) return;
        let quoted;
        const qEl = texts.slice(1).find((el) => el.closest('[role="link"]') && el !== textEl);
        if (qEl) {
          const qBox = qEl.closest('[role="link"]');
          const qName = qBox ? qBox.querySelector('[data-testid="User-Name"]') : null;
          const qLines = qName ? qName.innerText.split('\n') : [];
          const qh = qLines.find((s) => s.startsWith('@'));
          quoted = { author: qLines[0] || '', handle: qh ? qh.slice(1) : '', text: qEl.innerText.slice(0, 500) };
        }
        let author = '', handle = '';
        const nameEl = a.querySelector('[data-testid="User-Name"]');
        if (nameEl) {
          const lines = nameEl.innerText.split('\n');
          author = lines[0] || '';
          const h = lines.find((s) => s.startsWith('@'));
          handle = h ? h.slice(1) : '';
        }
        const key = idMatch ? idMatch[1] : handle + '|' + text.slice(0, 80);
        if (store.has(key)) return;
        const metric = (tid) => {
          const el = a.querySelector('[data-testid="' + tid + '"]');
          if (!el) return undefined;
          const m = (el.getAttribute('aria-label') || el.innerText || '').match(/[\d.,]+\s*[KMB]?/);
          return m ? m[0].trim() : undefined;
        };
        store.set(key, {
          id: idMatch ? idMatch[1] : '',
          url, author, handle,
          time: timeEl ? (timeEl.getAttribute('datetime') || '') : '',
          text,
          metrics: { replies: metric('reply'), reposts: metric('retweet'), likes: metric('like') },
          ...(quoted && quoted.text ? { quoted } : {}),
        });
      } catch (e) { /* one malformed card never kills the capture */ }
    });
  };

  // Scroll-to-consume. X renders a list a FEW posts at a time: each batch
  // arrives from its API only after the bottom of the rendered list comes
  // into view, and that fetch can take several seconds. So the loop judges
  // progress by NEW POSTS (or a taller page), never by scroll position, and
  // only calls the timeline finished after STALL_MS with neither — while
  // stalled it nudges (up a screen, then back to the bottom) so X's loader
  // sees the bottom again, and presses a "Retry" X shows after a failed page.
  // Every rendered card is grabbed BEFORE each jump, and the jump only goes
  // to the last rendered cell, so a virtualized list never skips a post.
  const t0 = Date.now();
  const end = t0 + (durationMs || 45000);
  const STALL_MS = 12000;
  // A list that has not rendered at all is still loading, not empty.
  const minEnd = t0 + Math.min(15000, durationMs || 45000);
  const sc = () => document.scrollingElement || document.documentElement;
  let lastCount = -1, lastHeight = -1, lastProgress = Date.now();
  let scrolls = 0, nudges = 0, retries = 0, ended = "time budget";
  window.scrollTo(0, 0);
  await sleep(600);
  while (Date.now() < end) {
    grab();
    if (store.size >= MAX) { ended = "post cap"; break; }
    const h = sc().scrollHeight;
    if (store.size > lastCount || h > lastHeight) {
      lastCount = store.size; lastHeight = h; lastProgress = Date.now();
    } else if (Date.now() - lastProgress > STALL_MS && (store.size > 0 || Date.now() >= minEnd)) {
      ended = "no new posts for " + Math.round(STALL_MS / 1000) + " s";
      break;
    }
    try {
      const retry = Array.from(document.querySelectorAll('[role="button"], button'))
        .find((b) => /^(retry|try again)$/i.test((b.innerText || "").trim()));
      if (retry) { retry.click(); retries++; await sleep(1500); }
    } catch (e) { /* no retry control */ }
    const stalled = Date.now() - lastProgress;
    if (stalled > 3000 && scrolls % 3 === 0) {
      window.scrollBy(0, -Math.round(window.innerHeight * 0.9));
      nudges++;
      await sleep(400);
    }
    const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    const last = cells.length ? cells[cells.length - 1] : null;
    if (last && last.scrollIntoView) last.scrollIntoView({ block: "end" });
    window.scrollBy(0, Math.round(window.innerHeight * 0.5));
    scrolls++;
    await sleep(1000);
  }
  grab();

  const posts = Array.from(store.values());
  const p = location.pathname;
  const kind =
    p.indexOf('/lists/') >= 0 ? 'list'
    : p.indexOf('/bookmarks') >= 0 ? 'bookmarks'
    : p.indexOf('/search') >= 0 ? 'search'
    : (p === '/home' || p === '/') ? 'timeline'
    : 'profile';
  let label = (document.title || 'X capture').replace(/^\(\d+\)\s*/, '').replace(/ [/|] X.*$/, '').slice(0, 80);
  if (kind === 'list' && (/^List$/i.test(label) || !label)) {
    const h2 = document.querySelector('h2');
    if (h2 && h2.innerText) label = h2.innerText.split('\n')[0].slice(0, 80);
  }
  return {
    format: 'dead-x-capture',
    version: 1,
    capturedAt: new Date().toISOString(),
    source: { kind, label },
    items: posts.slice(0, MAX),
    // For the run log: why it stopped, how hard it scrolled, and whether the
    // tab was VISIBLE — Chrome pauses rendering in a hidden tab, and X's
    // timeline loads its next batch from rendering, so "hidden" with few
    // posts names the cause.
    diag: { ended, posts: posts.length, scrolls, nudges, retries, seconds: Math.round((Date.now() - t0) / 1000), tab: document.visibilityState },
  };
}
