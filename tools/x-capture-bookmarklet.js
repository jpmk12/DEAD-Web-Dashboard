/*
 * DEAD X-capture bookmarklet — readable source.
 *
 * What it does: while you are on x.com in YOUR OWN logged-in browser, it reads
 * the posts currently rendered on the page (a list, your bookmarks, a search,
 * a profile, or the home timeline), packages them as a `dead-x-capture` v1
 * JSON file, and downloads it. You then upload that file on the dashboard's
 * OSINT → Social pane. Nothing is automated, no credentials are read or sent
 * anywhere, and no network request is made — it is a copy of what your screen
 * already shows.
 *
 * Install: copy the minified one-liner (lib/xBookmarklet.ts, or the Social
 * pane's "Bookmarklet" panel which shows the same string) into a new browser
 * bookmark's URL field. Keep THIS file as the maintained source: when X
 * changes its DOM and fields come back empty, fix the selectors here, then
 * re-minify into lib/xBookmarklet.ts (no build step — it's hand-minified).
 *
 * Selector notes (X DOM as of mid-2026, the usual churn suspects):
 * - each post:      article[data-testid="tweet"]
 * - body text:      [data-testid="tweetText"]
 * - author block:   [data-testid="User-Name"]  (innerText lines: name / @handle / time)
 * - permalink+time: a[href*="/status/"] > time[datetime]
 * - metrics:        button[data-testid="reply" | "retweet" | "like"] aria-label
 */
(() => {
  const posts = [];
  const seen = new Set();

  document.querySelectorAll('article[data-testid="tweet"]').forEach((a) => {
    try {
      // Permalink + timestamp: the <time> inside a /status/ link is the post's
      // own date line (embedded quote cards don't carry one at this level).
      const timeEl = a.querySelector('a[href*="/status/"] time');
      const linkEl = timeEl ? timeEl.closest('a') : null;
      const url = linkEl ? new URL(linkEl.getAttribute('href'), location.origin).href : '';
      const idMatch = url.match(/status\/(\d+)/);
      const id = idMatch ? idMatch[1] : '';
      if (id && seen.has(id)) return;

      const textEl = a.querySelector('[data-testid="tweetText"]');
      const text = textEl ? textEl.innerText : '';
      if (!text) return;

      let author = '';
      let handle = '';
      const nameEl = a.querySelector('[data-testid="User-Name"]');
      if (nameEl) {
        const lines = nameEl.innerText.split('\n');
        author = lines[0] || '';
        const h = lines.find((s) => s.startsWith('@'));
        handle = h ? h.slice(1) : '';
      }

      // Metric labels come back abbreviated ("1.2K") — the importer parses that.
      const metric = (tid) => {
        const el = a.querySelector('[data-testid="' + tid + '"]');
        if (!el) return undefined;
        const m = (el.getAttribute('aria-label') || el.innerText || '').match(/[\d.,]+\s*[KMB]?/);
        return m ? m[0].trim() : undefined;
      };

      if (id) seen.add(id);
      posts.push({
        id,
        url,
        author,
        handle,
        time: timeEl ? timeEl.getAttribute('datetime') || '' : '',
        text,
        metrics: { replies: metric('reply'), reposts: metric('retweet'), likes: metric('like') },
      });
    } catch (e) { /* one malformed card never kills the capture */ }
  });

  if (!posts.length) {
    alert('dead-x-capture: no posts found on this view. Scroll so posts are visible, then try again.');
    return;
  }

  const p = location.pathname;
  const kind =
    p.indexOf('/lists/') >= 0 ? 'list'
    : p.indexOf('/bookmarks') >= 0 ? 'bookmarks'
    : p.indexOf('/search') >= 0 ? 'search'
    : p === '/home' || p === '/' ? 'timeline'
    : 'profile';
  const label = (document.title || 'X capture').replace(/ [/|] X.*$/, '').slice(0, 80);

  const out = {
    format: 'dead-x-capture',
    version: 1,
    capturedAt: new Date().toISOString(),
    source: { kind, label },
    items: posts.slice(0, 200),
  };

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const dl = document.createElement('a');
  dl.href = URL.createObjectURL(blob);
  dl.download = 'x-capture-' + new Date().toISOString().replace(/[:.]/g, '').slice(0, 15) + 'Z.json';
  document.body.appendChild(dl);
  dl.click();
  dl.remove();
  alert('dead-x-capture: saved ' + out.items.length + ' posts. Import the file on the dashboard: OSINT → Social.');
})();
