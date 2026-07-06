/*
 * DEAD X-capture bookmarklet v2 — readable source.
 *
 * What it does: while you are on x.com in YOUR OWN logged-in browser, it
 * COLLECTS posts as you scroll (X virtualizes its timeline — posts are
 * removed from the DOM as they leave the viewport, so a one-shot snapshot
 * only ever sees ~5-10 posts; v1 learned this the hard way). Flow:
 *
 *   1. Tap the bookmark ONCE on the list/bookmarks/search/profile view.
 *      A green counter button appears bottom-right.
 *   2. Scroll normally. The counter climbs as posts render (deduped by id,
 *      capped at 200).
 *   3. Tap the green counter to download the `dead-x-capture` v1 JSON,
 *      then upload it on the dashboard's OSINT → Social pane.
 *
 * Tapping the bookmark again while collecting also saves (same as the
 * button). Nothing is automated, no credentials are read, no network
 * request is made — it is a copy of what your screen already rendered.
 *
 * Install: copy the minified one-liner (lib/xBookmarklet.ts, or the Social
 * pane's "Bookmarklet" panel) into a new browser bookmark's URL field. Keep
 * THIS file as the maintained source: when X changes its DOM and fields come
 * back empty, fix the selectors here, then re-minify into lib/xBookmarklet.ts.
 *
 * Selector notes (X DOM, the usual churn suspects):
 * - each post:      article[data-testid="tweet"]
 * - body text:      [data-testid="tweetText"]
 * - author block:   [data-testid="User-Name"]  (innerText lines: name / @handle / time)
 * - permalink+time: a[href*="/status/"] > time[datetime]
 * - metrics:        button[data-testid="reply" | "retweet" | "like"] aria-label
 */
(() => {
  var W = window;
  if (W.__deadxcap) { W.__deadxcap.save(); return; }

  var MAX = 200;
  var store = new Map();

  var grab = () => {
    document.querySelectorAll('article[data-testid="tweet"]').forEach((a) => {
      try {
        if (store.size >= MAX) return;
        var timeEl = a.querySelector('a[href*="/status/"] time');
        var linkEl = timeEl ? timeEl.closest('a') : null;
        var url = linkEl ? new URL(linkEl.getAttribute('href'), location.origin).href : '';
        var idMatch = url.match(/status\/(\d+)/);
        var textEl = a.querySelector('[data-testid="tweetText"]');
        var text = textEl ? textEl.innerText : '';
        if (!text) return;
        var author = '', handle = '';
        var nameEl = a.querySelector('[data-testid="User-Name"]');
        if (nameEl) {
          var lines = nameEl.innerText.split('\n');
          author = lines[0] || '';
          var h = lines.find((s) => s.startsWith('@'));
          handle = h ? h.slice(1) : '';
        }
        // Dedupe key: the status id when we have it, else handle+text.
        var key = idMatch ? idMatch[1] : handle + '|' + text.slice(0, 80);
        if (store.has(key)) return;
        var metric = (tid) => {
          var el = a.querySelector('[data-testid="' + tid + '"]');
          if (!el) return undefined;
          var m = (el.getAttribute('aria-label') || el.innerText || '').match(/[\d.,]+\s*[KMB]?/);
          return m ? m[0].trim() : undefined;
        };
        store.set(key, {
          id: idMatch ? idMatch[1] : '',
          url: url,
          author: author,
          handle: handle,
          time: timeEl ? timeEl.getAttribute('datetime') || '' : '',
          text: text,
          metrics: { replies: metric('reply'), reposts: metric('retweet'), likes: metric('like') },
        });
      } catch (e) { /* one malformed card never kills the capture */ }
    });
    btn.textContent = '𝕏 ' + store.size + (store.size >= MAX ? ' (cap)' : '') + ' captured — tap to save';
  };

  var btn = document.createElement('button');
  btn.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:2147483647;background:#10b981;color:#022c22;font:700 13px system-ui;padding:10px 14px;border-radius:10px;border:0;box-shadow:0 4px 16px rgba(0,0,0,.5);cursor:pointer';
  btn.onclick = () => save();
  document.body.appendChild(btn);
  var iv = setInterval(grab, 500);
  grab();

  function save() {
    clearInterval(iv);
    btn.remove();
    delete W.__deadxcap;
    var posts = Array.from(store.values());
    if (!posts.length) {
      alert('dead-x-capture: no posts collected. Start it on a view with posts, scroll, then save.');
      return;
    }
    var p = location.pathname;
    var kind =
      p.indexOf('/lists/') >= 0 ? 'list'
      : p.indexOf('/bookmarks') >= 0 ? 'bookmarks'
      : p.indexOf('/search') >= 0 ? 'search'
      : p === '/home' || p === '/' ? 'timeline'
      : 'profile';
    // Title strips: notification count prefix "(20) " and the " / X" suffix.
    var label = (document.title || 'X capture').replace(/^\(\d+\)\s*/, '').replace(/ [/|] X.*$/, '').slice(0, 80);
    // List pages often title themselves just "List" — the list's real name
    // lives in the header h2.
    if (kind === 'list' && (/^List$/i.test(label) || !label)) {
      var h2 = document.querySelector('h2');
      if (h2 && h2.innerText) label = h2.innerText.split('\n')[0].slice(0, 80);
    }
    var out = {
      format: 'dead-x-capture',
      version: 1,
      capturedAt: new Date().toISOString(),
      source: { kind: kind, label: label },
      items: posts.slice(0, MAX),
    };
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    var dl = document.createElement('a');
    dl.href = URL.createObjectURL(blob);
    dl.download = 'x-capture-' + new Date().toISOString().replace(/[:.]/g, '').slice(0, 15) + 'Z.json';
    document.body.appendChild(dl);
    dl.click();
    dl.remove();
    alert('dead-x-capture: saved ' + out.items.length + ' posts. Import the file on the dashboard: OSINT → Social.');
  }

  W.__deadxcap = { save: save };
})();
