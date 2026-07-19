// Collector for a LiveUAMap region page (e.g. iran.liveuamap.com). Injected by
// the background worker; runs in the user's own browser (LiveUAMap blocks
// datacenter IPs, so this can't be done server-side). Self-contained for
// executeScript func injection — page globals only.
//
// Robustness: it keys off the EVENT PERMALINK pattern (/en/20YY/…) rather than
// fragile CSS classes, so LiveUAMap's markup churn doesn't break it. It scrolls
// the event feed to load more, deduped by permalink, then returns a `dead-events`
// object. No login, nothing sent to LiveUAMap.
export async function collectLiveuamap(durationMs, maxItems) {
  const MAX = maxItems || 300;
  const store = new Map();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const EVENT_HREF = /\/en\/20\d\d\//;

  const grab = () => {
    document.querySelectorAll('a[href*="/en/20"]').forEach((a) => {
      try {
        if (store.size >= MAX) return;
        const href = a.href;
        if (!EVENT_HREF.test(href)) return;
        const title = (a.innerText || a.getAttribute("title") || "").replace(/\s+/g, " ").trim();
        if (!title || title.length < 15) return;
        if (store.has(href)) return;
        const ev = a.closest("[data-id], .event, article, li") || a.parentElement;
        let time = "";
        if (ev) {
          const t = ev.querySelector("time, .date_add, [class*='time'], [class*='date']");
          if (t) time = (t.getAttribute("datetime") || t.innerText || "").trim();
        }
        let sourceUrl = "";
        if (ev) {
          const s = ev.querySelector('a[href^="http"]:not([href*="liveuamap.com"])');
          if (s) sourceUrl = s.href;
        }
        store.set(href, { url: href, title: title.slice(0, 300), time: time.slice(0, 40), sourceUrl });
      } catch (e) { /* one bad node never kills the capture */ }
    });
  };

  const end = Date.now() + (durationMs || 20000);
  grab();
  let last = 0, still = 0;
  while (Date.now() < end && store.size < MAX) {
    window.scrollTo(0, document.body.scrollHeight);
    // The event feed is often its own scroll panel — nudge likely candidates too.
    document.querySelectorAll(".feedler, [class*='feed'], [class*='list'], [class*='timeline']").forEach((el) => {
      try { el.scrollTop = el.scrollHeight; } catch (e) {}
    });
    await sleep(800);
    grab();
    if (store.size === last) { still++; if (still >= 5) break; } else { still = 0; last = store.size; }
  }
  grab();

  const host = location.hostname;
  const label = host.replace(/\.liveuamap\.com$/, "").replace(/^www\./, "") || "liveuamap";
  return {
    format: "dead-events",
    version: 1,
    capturedAt: new Date().toISOString(),
    source: { kind: "liveuamap", label },
    items: Array.from(store.values()).slice(0, MAX),
  };
}
