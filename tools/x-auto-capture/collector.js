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
        const textEl = a.querySelector('[data-testid="tweetText"]');
        const text = textEl ? textEl.innerText : '';
        if (!text) return;
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
        });
      } catch (e) { /* one malformed card never kills the capture */ }
    });
  };

  // Auto-scroll loop: grab, scroll ~85% viewport, wait for the next batch to
  // render. Stops at the time budget, the post cap, or a stuck scroll position.
  const end = Date.now() + (durationMs || 25000);
  let lastY = -1, still = 0;
  window.scrollTo(0, 0);
  await sleep(400);
  while (Date.now() < end && store.size < MAX) {
    grab();
    window.scrollBy(0, Math.round(window.innerHeight * 0.85));
    await sleep(700);
    const y = window.scrollY;
    if (y === lastY) { still++; if (still >= 6) break; } else { still = 0; lastY = y; }
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
  };
}
