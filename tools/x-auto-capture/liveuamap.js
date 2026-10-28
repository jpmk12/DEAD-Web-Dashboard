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

  // Where the coordinates live is UNVERIFIED (the first runs carried 76
  // events and 0 positions), so the run log names it: the attribute names on
  // the first event entry and two ancestors, and every attribute on the page
  // whose NAME looks like a coordinate, with how often it appears. Names and
  // a short sample value only — the page is public.
  const items = Array.from(store.values());
  const diag = { placed: items.filter((i) => i.lat != null).length };
  try {
    const first = Array.from(document.querySelectorAll('a[href*="/en/20"]')).find((a) => EVENT_HREF.test(a.href));
    if (first) {
      const chain = [];
      let el = first;
      for (let i = 0; el && el !== document.body && i < 4; i++, el = el.parentElement) {
        const names = Array.from(el.attributes || []).map((x) => x.name).filter((n) => n !== "style").slice(0, 12);
        chain.push(el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "") + "[" + names.join(",") + "]");
      }
      diag.entry = chain.join(" < ").slice(0, 400);
    }
    const seen = {};
    document.querySelectorAll("*").forEach((n) => {
      for (const x of Array.from(n.attributes || [])) {
        if (/lat|lng|lon|coord|geo|point/i.test(x.name) && !/^(aria|on)/i.test(x.name)) {
          const k = x.name;
          if (!seen[k]) seen[k] = { n: 0, sample: String(x.value).slice(0, 40) };
          seen[k].n++;
        }
      }
    });
    const keys = Object.keys(seen);
    diag.coordAttrs = keys.length ? keys.slice(0, 8).map((k) => k + "×" + seen[k].n + "=" + seen[k].sample).join(", ") : "none";
  } catch (e) { /* the diagnostic is best-effort */ }

  const host = location.hostname;
  const label = host.replace(/\.liveuamap\.com$/, "").replace(/^www\./, "") || "liveuamap";
  return {
    format: "dead-events",
    version: 1,
    capturedAt: new Date().toISOString(),
    source: { kind: "liveuamap", label },
    items: items.slice(0, MAX),
    diag,
  };
}

// Run in the page's OWN world (executeScript world:"MAIN") after the
// collector: the 1.2.7 run showed no coordinate-looking attribute anywhere
// in the markup, so the positions live in the map's JavaScript. This looks
// in three places, reads only, and returns { found: [[path, lat, lng]],
// diag } for the background worker to join onto the captured events by
// permalink path:
//   1. Leaflet layers — any page global with `_layers` (a map or a layer
//      group): each layer with `_latlng` and a popup or options naming an
//      event permalink.
//   2. Arrays / maps of plain objects carrying a lat + lng and a string
//      field naming an event permalink.
//   3. Inline scripts: a count of "lat":…,"lng":… pairs and a sample, so a
//      shape this misses is named on the run log.
// Nothing is guessed: an object with coordinates but no permalink is
// counted, never joined.
export function probeLiveuamapCoords() {
  const EV = /\/en\/20\d\d\/[^"'\s<>?#]+/;
  const found = new Map();
  const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
  const ok = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(a === 0 && b === 0);
  const latOf = (o) => num(o.lat != null ? o.lat : o.latitude != null ? o.latitude : o.Lat);
  const lngOf = (o) => num(o.lng != null ? o.lng : o.lon != null ? o.lon : o.long != null ? o.long : o.longitude != null ? o.longitude : o.Lng);
  const linkIn = (o) => {
    try {
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (typeof v === "string") { const m = v.match(EV); if (m) return m[0]; }
      }
    } catch (e) { /* unreadable */ }
    return null;
  };
  const diag = { markers: 0, markersLinked: 0, objects: 0, objectsLinked: 0, arrays: [], scriptPairs: 0, scriptSample: "", map: "" };
  const scanObjects = (name, list) => {
    let withCoords = 0, linked = 0, keys = "";
    for (const o of list) {
      if (!o || typeof o !== "object") continue;
      const la = latOf(o), ln = lngOf(o);
      if (!ok(la, ln)) continue;
      withCoords++;
      if (!keys) keys = Object.keys(o).slice(0, 10).join(",");
      const link = linkIn(o);
      if (link) { linked++; if (!found.has(link)) found.set(link, [la, ln]); }
    }
    if (withCoords) { diag.objects += withCoords; diag.objectsLinked += linked; diag.arrays.push(name + "×" + withCoords + (linked ? "(linked " + linked + ")" : "") + "{" + keys + "}"); }
  };
  try {
    if (window.L) diag.map = "leaflet";
    else if (window.google && window.google.maps) diag.map = "google";
    for (const k of Object.keys(window)) {
      let v;
      try { v = window[k]; } catch (e) { continue; }
      if (!v || typeof v !== "object" || v === window || v === document) continue;
      try {
        if (v._layers && typeof v._layers === "object") {
          for (const layer of Object.values(v._layers)) {
            const ll = layer && layer._latlng;
            if (!ll) continue;
            diag.markers++;
            let html = "";
            const p = layer._popup;
            if (p) html = typeof p._content === "string" ? p._content : (p._content && p._content.innerHTML) || "";
            const m = html.match(EV);
            const link = m ? m[0] : (layer.options ? linkIn(layer.options) : null);
            if (link && ok(ll.lat, ll.lng)) { diag.markersLinked++; if (!found.has(link)) found.set(link, [ll.lat, ll.lng]); }
          }
        }
        if (Array.isArray(v) && v.length >= 3 && v[0] && typeof v[0] === "object") scanObjects(k, v.slice(0, 2000));
        else if (!Array.isArray(v) && !v._layers && !(v instanceof Node)) {
          const vals = Object.values(v);
          if (vals.length >= 3 && vals.length <= 5000 && vals[0] && typeof vals[0] === "object" && !Array.isArray(vals[0])) scanObjects(k + "{}", vals.slice(0, 2000));
        }
      } catch (e) { /* one odd global never kills the probe */ }
    }
    const PAIR = /"lat"\s*:\s*"?(-?\d{1,2}\.\d+)"?\s*,\s*"(?:lng|lon)"\s*:\s*"?(-?\d{1,3}\.\d+)/g;
    for (const s of Array.from(document.scripts)) {
      const t = s.textContent || "";
      if (!t || t.length > 3000000) continue;
      const hits = t.match(PAIR);
      if (hits) {
        diag.scriptPairs += hits.length;
        if (!diag.scriptSample) { const i = t.search(PAIR); diag.scriptSample = t.slice(Math.max(0, i - 80), i + 120).replace(/\s+/g, " "); }
      }
    }
  } catch (e) { /* best effort */ }
  diag.arrays = diag.arrays.slice(0, 5);
  return { found: Array.from(found.entries()).slice(0, 600).map(([path, c]) => [path, c[0], c[1]]), diag };
}
