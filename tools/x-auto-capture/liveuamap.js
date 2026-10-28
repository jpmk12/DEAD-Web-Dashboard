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
        // The feed entry's own id (the map's objects carry the same numeric
        // id — 1.2.8's probe showed "id":21878298 beside lat/lng), used by the
        // worker to join a map position onto this event.
        const idNode = a.closest("[data-id]");
        const eid = idNode ? idNode.getAttribute("data-id") : (ev && /^\d{5,}$/.test(ev.id || "") ? ev.id : "");
        if (eid && /^\d{4,}$/.test(String(eid))) item.eid = String(eid);
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
    const links = Array.from(document.querySelectorAll('a[href*="/en/20"]')).filter((a) => EVENT_HREF.test(a.href));
    const first = links.find((a) => !a.closest(".popup-text, .leaflet-popup, [class*='popup']")) || links[0];
    diag.withEid = items.filter((i) => i.eid).length;
    const firstEid = items.find((i) => i.eid);
    if (firstEid) diag.eidSample = firstEid.eid;
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
  const diag = { markers: 0, markersLinked: 0, objects: 0, objectsLinked: 0, arrays: [], scriptPairs: 0, scriptSample: "", map: "", markerSample: "" };
  // Second and third joins when no permalink is in reach: the object's numeric
  // id (the feed entry carries the same one as data-id) and its title text.
  const byId = new Map(), byTitle = new Map();
  const idOf = (o) => {
    if (!o || typeof o !== "object") return null;
    for (const k of ["id", "eid", "event_id", "eventId", "venue_id", "pid"]) {
      const v = o[k];
      if ((typeof v === "number" || typeof v === "string") && /^\d{4,}$/.test(String(v))) return String(v);
    }
    return null;
  };
  const textKey = (t) => String(t || "").replace(/<[^>]*>/g, " ").toLowerCase().replace(/[^a-z0-9\u0600-\u06ff\u0400-\u04ff]+/g, " ").trim().slice(0, 60);
  const titleOf = (o) => (o && (o.title || o.name || o.text || o.description)) || "";
  const ID_RX = /(?:^|\D)(\d{6,10})(?:\D|$)/;
  const noteLayerIds = (layer, la, ln) => {
    try {
      for (const k of ["id", "eid", "eventId", "event_id", "pid", "_id", "_eid"]) {
        const v = layer[k];
        if ((typeof v === "number" || typeof v === "string") && /^\d{4,}$/.test(String(v)) && !byId.has(String(v))) byId.set(String(v), [la, ln]);
      }
      const io = layer.options && layer.options.icon && layer.options.icon.options;
      if (io) for (const k of ["className", "iconUrl", "html", "id"]) { const m = typeof io[k] === "string" ? io[k].match(ID_RX) : null; if (m && !byId.has(m[1])) byId.set(m[1], [la, ln]); }
      const el = layer._icon;
      if (el && el.attributes) for (const x of Array.from(el.attributes)) { const m = String(x.value).match(ID_RX); if (m && !byId.has(m[1])) byId.set(m[1], [la, ln]); }
    } catch (e) { /* best effort */ }
  };
  // A table the page keeps from an event id to its marker — the key is the id.
  diag.layerMaps = [];
  const scanLayerMap = (name, obj) => {
    let n = 0;
    try {
      for (const k of Object.keys(obj).slice(0, 5000)) {
        const v = obj[k];
        const ll = v && v._latlng;
        if (!ll || !ok(ll.lat, ll.lng)) continue;
        n++;
        if (/^\d{4,}$/.test(k) && !byId.has(k)) byId.set(k, [ll.lat, ll.lng]);
        noteLayerIds(v, ll.lat, ll.lng);
      }
    } catch (e) { /* unreadable */ }
    if (n) diag.layerMaps.push(name + "×" + n);
  };
  const note = (o, la, ln) => {
    const id = idOf(o);
    if (id && !byId.has(id)) byId.set(id, [la, ln]);
    const tk = textKey(titleOf(o));
    if (tk.length >= 20 && !byTitle.has(tk)) byTitle.set(tk, [la, ln]);
  };
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
      note(o, la, ln);
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
            if (ok(ll.lat, ll.lng)) {
              const o = layer.options || {};
              note(o, ll.lat, ll.lng);
              // An id the page set on the marker itself, or one in its icon's
              // (inherited) options or rendered element (class / id / data-*).
              noteLayerIds(layer, ll.lat, ll.lng);
              if (layer.feature && layer.feature.properties) note(layer.feature.properties, ll.lat, ll.lng);
              const tip = layer._tooltip && layer._tooltip._content;
              const tk = textKey(html || (typeof tip === "string" ? tip : ""));
              if (tk.length >= 20 && !byTitle.has(tk)) byTitle.set(tk, [ll.lat, ll.lng]);
              if (!diag.markerSample) {
                let opts = "";
                try { opts = JSON.stringify(o, (k, v) => (typeof v === "object" && v !== null && k && !Array.isArray(v) && Object.keys(v).length > 8 ? "[obj]" : typeof v === "function" ? "[fn]" : v)).slice(0, 300); } catch (e) { opts = Object.keys(o).join(","); }
                const iconOpts = [];
                try { const io = o.icon && o.icon.options; if (io) for (const k in io) { const v = io[k]; if (typeof v === "string" || typeof v === "number") iconOpts.push(k + "=" + String(v).slice(0, 40)); } } catch (e) { /* none */ }
                const el = layer._icon;
                const elAttrs = el && el.attributes ? Array.from(el.attributes).map((x) => x.name + "=" + String(x.value).slice(0, 40)).slice(0, 6).join(" ") : "";
                const own = Object.keys(layer).filter((k) => !/^_(map|leaflet_id|latlng|icon|shadow|popup|tooltip|events|initHooksCalled|zoomAnimated|mapToAdd|firingCount|eventParents|zIndex|dragging)$/.test(k) && k !== "options" && k !== "dragging").slice(0, 10).join(",");
                diag.markerSample = "options " + opts + " · popup " + (p ? (typeof p._content) + " " + String(html).length + " chars “" + String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 50) + "”" : "none") + (layer.feature ? " · feature" : "") + (iconOpts.length ? " · icon " + iconOpts.slice(0, 5).join(" ") : "") + (elAttrs ? " · el " + elAttrs : "") + (own ? " · own " + own : "");
              }
            }
          }
        }
        if (!v._layers && !Array.isArray(v) && !(v instanceof Node)) {
          scanLayerMap(k, v);
          for (const k2 of Object.keys(v).slice(0, 200)) {
            let v2; try { v2 = v[k2]; } catch (e) { continue; }
            if (v2 && typeof v2 === "object" && !v2._layers && !(v2 instanceof Node) && v2 !== window) scanLayerMap(k + "." + k2, v2);
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
  diag.layerMaps = diag.layerMaps.slice(0, 5);
  diag.byId = byId.size;
  diag.byTitle = byTitle.size;
  return {
    found: Array.from(found.entries()).slice(0, 600).map(([path, c]) => [path, c[0], c[1]]),
    byId: Array.from(byId.entries()).slice(0, 1500).map(([id, c]) => [id, c[0], c[1]]),
    byTitle: Array.from(byTitle.entries()).slice(0, 1500).map(([t, c]) => [t, c[0], c[1]]),
    diag,
  };
}

// Last resort, run in the page's world when the joins above leave events
// unplaced: do what a reader does — click each feed entry. LiveUAMap answers
// a click on an entry by opening that event's popup on the map, and the
// popup's position IS the event's position (opening a popup needs no
// animation, so this works in a background tab). Only entries whose
// data-id the worker still needs are clicked; nothing is typed, submitted
// or followed; a click on a link inside an entry is prevented. Returns
// { byId: [[id, lat, lng]], diag }.
export async function clickProbeLiveuamap(ids, maxMs) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(a === 0 && b === 0);
  const diag = { asked: (ids || []).length, clicked: 0, opened: 0, moved: 0, map: false, sample: [] };
  let map = null;
  try {
    for (const k of Object.keys(window)) {
      let v; try { v = window[k]; } catch (e) { continue; }
      if (v && typeof v === "object" && v._layers && typeof v.getCenter === "function") { map = v; break; }
    }
  } catch (e) { /* none */ }
  if (!map) return { byId: [], diag };
  diag.map = true;
  const want = new Set((ids || []).map(String));
  const stopLinks = (e) => { try { const a = e.target && e.target.closest && e.target.closest("a"); if (a) e.preventDefault(); } catch (x) { /* ignore */ } };
  document.addEventListener("click", stopLinks, true);
  const out = [];
  const end = Date.now() + (maxMs || 20000);
  const llOfPopup = () => { const p = map._popup; return p && p._latlng ? [p._latlng.lat, p._latlng.lng] : null; };
  try {
    const entries = Array.from(document.querySelectorAll("div.event[data-id], [class*='event'][data-id]"))
      .filter((el) => want.has(String(el.getAttribute("data-id"))));
    for (const el of entries) {
      if (Date.now() > end) break;
      const id = String(el.getAttribute("data-id"));
      const before = llOfPopup();
      // Step the map a little off its centre first, so an event at the same
      // place as the one before it still registers as a move when the site
      // re-centres on it (LiveUAMap answers a click by re-centring, not with
      // a Leaflet popup — the 1.2.11 run read popups 0, moved 21).
      try {
        const c = map.getCenter(), z = map.getZoom ? map.getZoom() : undefined;
        if (map.setView) map.setView([c.lat + 0.37, c.lng + 0.41], z, { animate: false });
      } catch (e) { /* the shift is best-effort */ }
      let c0 = null; try { const c = map.getCenter(); c0 = [c.lat, c.lng]; } catch (e) { /* none */ }
      try { el.click(); diag.clicked++; } catch (e) { continue; }
      // Wait until the centre stops moving (an animated pan read mid-flight
      // would be a wrong position): two equal reads 150 ms apart, ≤2.5 s.
      await sleep(300);
      let last = null;
      for (let t = 0; t < 15; t++) {
        let cur = null; try { const c = map.getCenter(); cur = [c.lat, c.lng]; } catch (e) { break; }
        if (last && Math.abs(cur[0] - last[0]) < 1e-7 && Math.abs(cur[1] - last[1]) < 1e-7) break;
        last = cur;
        await sleep(150);
      }
      let ll = llOfPopup();
      if (ll && (!before || Math.abs(ll[0] - before[0]) > 1e-6 || Math.abs(ll[1] - before[1]) > 1e-6)) diag.opened++;
      else {
        ll = null;
        if (last && c0 && (Math.abs(last[0] - c0[0]) > 1e-4 || Math.abs(last[1] - c0[1]) > 1e-4)) { ll = last; diag.moved++; }
      }
      if (ll && ok(ll[0], ll[1])) {
        out.push([id, ll[0], ll[1]]);
        if (diag.sample.length < 3) diag.sample.push(id + "→" + ll[0].toFixed(3) + "," + ll[1].toFixed(3));
      }
    }
  } finally {
    document.removeEventListener("click", stopLinks, true);
    try { if (map.closePopup) map.closePopup(); } catch (e) { /* ignore */ }
  }
  return { byId: out, diag };
}
