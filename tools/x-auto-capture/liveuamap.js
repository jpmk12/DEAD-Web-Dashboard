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
        // The event's own coordinates, when the markup carries them (the feed
        // entries have historically carried data-lat / data-lng; a few
        // spellings are tried on the entry and its ancestors). A placed event
        // is what lets the dashboard join it to a strait, a base or a country
        // by distance instead of by name; nothing is guessed when absent.
        let lat = null, lng = null;
        const coordNode = (a.closest("[data-lat],[data-latitude],[data-y]") || ev || a);
        const pick = (el, names) => { for (const n of names) { const v = el && el.getAttribute && el.getAttribute(n); if (v != null && v !== "" && isFinite(Number(v))) return Number(v); } return null; };
        lat = pick(coordNode, ["data-lat", "data-latitude", "data-y"]);
        lng = pick(coordNode, ["data-lng", "data-lon", "data-long", "data-longitude", "data-x"]);
        const item = { url: href, title: title.slice(0, 300), time: time.slice(0, 40), sourceUrl };
        if (lat != null && lng != null) { item.lat = lat; item.lng = lng; }
        store.set(href, item);
      } catch (e) { /* one bad node never kills the capture */ }
    });
  };

  const end = Date.now() + (durationMs || 20000);
  // A region map renders its feed well after the tab reports "complete";
  // nothing found yet is not "nothing to find" until this much has passed.
  const minEnd = Date.now() + Math.min(12000, durationMs || 20000);
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
    if (store.size === last) { still++; if (still >= 5 && (store.size > 0 || Date.now() >= minEnd)) break; } else { still = 0; last = store.size; }
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
