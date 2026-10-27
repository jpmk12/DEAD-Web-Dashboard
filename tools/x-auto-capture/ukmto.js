// Collector for the UKMTO recent-incidents page (https://www.ukmto.org/
// recent-incidents). Injected by the background worker; runs in the user's
// own browser. UKMTO is reported to refuse automated fetches, so the
// dashboard's own server may never see the page — this is the door that
// always works: the rendered page's TEXT is posted as a `dead-ukmto` capture
// and the dashboard's parser (lib/ukmtoParse) reads the entries out of it.
// Self-contained for executeScript func injection — page globals only.
// Public site, no login, nothing is sent to UKMTO.
//
// What the saved page (2026-10-27) taught: the site is a Next.js / Sitecore
// app whose STATIC HTML carries "0 reports" and an EMPTY incident list
// (`ul[class*="IncidentList"]`); the incidents arrive by a client-side
// request after hydration. So the collector now WAITS for the list to hold
// items (or the "N reports" count to rise above 0) before it harvests,
// takes every list item as a block (the parser dedupes by reference), tries
// to open each collapsed item so its detail (position, narrative) is in the
// text, and records which JSON requests the page made (`apiHints`) so the
// run log can name the incident API — a structured feed with positions
// would beat text, and this is how its shape gets pinned.
//
// Robustness: nothing here depends on the hashed CSS classes beyond a
// substring (`IncidentList`); the whole-page text remains the contract.
export async function collectUkmto(durationMs, maxItems) {
  const MAX = maxItems || 300;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || "").replace(/[ \t\r\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const HEAD = /^\s*(?:UKMTO\s*)?\d{1,4}\s*-\s*\d{2}\s*[-–—:|]?\s*[A-Z]{2}/;
  const listEl = () => document.querySelector("ul[class*='IncidentList'], ul[class*='incidentList'], [class*='IncidentList'] ul, [data-list-panel] ul");
  const listItems = () => { const ul = listEl(); return ul ? Array.from(ul.querySelectorAll(":scope > li, li")) : []; };
  const reportCount = () => {
    const m = /(\d+)\s+reports?\b/i.exec(document.body.innerText || "");
    return m ? Number(m[1]) : null;
  };

  const budget = Math.min(durationMs || 20000, 40000);
  const end = Date.now() + budget;
  // 1. Wait for the client-side load: items in the list or a count above 0.
  const minWait = Date.now() + Math.min(12000, budget);
  while (Date.now() < end) {
    const n = listItems().length;
    const c = reportCount();
    if (n > 0 || (c != null && c > 0 && Date.now() >= minWait)) break;
    await sleep(600);
  }
  // 2. Scroll the list and the page so a lazy list renders; click an obvious
  //    "load more" if one exists.
  let lastLen = 0, still = 0;
  while (Date.now() < end) {
    const ul = listEl();
    const panel = ul ? (ul.closest("[class*='listScroll'], [class*='Scroll']") || ul.parentElement) : null;
    if (panel) { try { panel.scrollTop = panel.scrollHeight; } catch (e) { /* ignore */ } }
    window.scrollTo(0, document.body.scrollHeight);
    const btn = Array.from(document.querySelectorAll("button, a")).find((el) => /\b(load|show|view)\s+more\b|\bmore incidents\b|\bnext\b/i.test((el.innerText || "").trim()) && (el.innerText || "").trim().length < 40);
    if (btn) { try { btn.click(); } catch (e) { /* ignore */ } }
    await sleep(800);
    const len = (document.body.innerText || "").length;
    if (len === lastLen) { still++; if (still >= 3) break; } else { still = 0; lastLen = len; }
  }
  // 3. Open each collapsed item so its detail is in the text. A click that
  //    navigates away is undone by stopping; the list text already taken
  //    stands. Only items whose text lacks a labelled field are opened.
  const items = listItems().slice(0, Math.min(MAX, 80));
  const startHref = location.href;
  for (const li of items) {
    if (Date.now() > end) break;
    const t = clean(li.innerText);
    if (/Incident (?:Date|Time)|Position:|Source:/i.test(t)) continue;
    try {
      const target = li.querySelector("button, a, [role='button'], summary, h2, h3") || li;
      target.click();
      await sleep(180);
      if (location.href !== startHref) { history.back(); await sleep(400); break; }
    } catch (e) { /* ignore */ }
  }
  window.scrollTo(0, 0);

  // 4. Blocks: every list item, plus any element whose own text starts with
  //    a reference header (the shape the parser was written against).
  const blocks = [];
  const seen = new Set();
  const push = (t) => { const key = t.slice(0, 40); if (!t || t.length < 12 || seen.has(key)) return; seen.add(key); blocks.push(t); };
  try { listItems().forEach((li) => { if (blocks.length < MAX) push(clean(li.innerText).slice(0, 6000)); }); } catch (e) { /* page text stands */ }
  try {
    document.querySelectorAll("article, li, section, div, tr, p").forEach((el) => {
      if (blocks.length >= MAX) return;
      const t = clean(el.innerText);
      if (!t || t.length < 20 || t.length > 6000 || !HEAD.test(t)) return;
      const inner = Array.from(el.children).some((c) => HEAD.test(clean(c.innerText)) && clean(c.innerText).length < t.length - 10);
      if (inner) return;
      push(t);
    });
  } catch (e) { /* fall through with the page text */ }

  // 5. The requests the page made for its data. The first run (2026-10-27)
  //    named them: the incidents come from the Royal Navy's SCCD —
  //    https://sccd.royalnavy.mod.uk/api/ukmto/all — a CROSS-origin JSON
  //    feed the page's own script reads (so CORS admits this origin and the
  //    page-context fetch below works). That body is carried WHOLE (≤1.5 MB)
  //    as `api[].body`: the dashboard reads its records, with positions,
  //    and the text parse becomes the fallback. Other data requests are
  //    sampled (1,500 chars) so a renamed endpoint shows in the run log.
  const apiHints = [];
  const api = [];
  try {
    const seenUrl = new Set();
    for (const e of performance.getEntriesByType("resource")) {
      const u = String(e.name || "");
      if (!u || seenUrl.has(u)) continue;
      if (/\/_next\/static\/|\.(?:css|js|png|jpg|svg|woff2?|ico)(?:\?|$)|googletagmanager|google-analytics|cookieControl|fonts\.|atlas\.microsoft\.com|\/styling\/|\/tileset|\/tile\//i.test(u)) continue;
      if (!/api|json|incident|graphql|sitecore|layout|data|search|ukmto/i.test(u)) continue;
      seenUrl.add(u);
      apiHints.push(u.slice(0, 300));
      if (apiHints.length >= 12) break;
    }
    // The incident feed first (whole), then up to three others (sampled).
    const ordered = apiHints.slice().sort((a, b) => Number(/\/api\/ukmto\/all\b/i.test(b)) - Number(/\/api\/ukmto\/all\b/i.test(a)));
    for (const u of ordered.slice(0, 4)) {
      const whole = /\/api\/ukmto\/all\b/i.test(u);
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(u, { credentials: u.startsWith(location.origin) ? "same-origin" : "omit", mode: "cors", signal: ctrl.signal });
        clearTimeout(to);
        const ct = r.headers.get("content-type") || "";
        const text = /json/i.test(ct) || whole ? await r.text() : "";
        const entry = { url: u.slice(0, 300), status: r.status, contentType: ct.slice(0, 60), sample: text.slice(0, 1500) };
        if (whole && r.ok && text) entry.body = text.slice(0, 1500000);
        api.push(entry);
      } catch (e) { api.push({ url: u.slice(0, 300), status: 0, contentType: "", sample: String((e && e.message) || e).slice(0, 120) }); }
    }
  } catch (e) { /* hints are best-effort */ }

  const text = clean(document.body.innerText).slice(0, 400000);
  const out = blocks.length ? blocks.map((b) => ({ text: b })) : text ? [{ text }] : [];
  return {
    format: "dead-ukmto",
    version: 1,
    capturedAt: new Date().toISOString(),
    source: { kind: "ukmto", label: "UKMTO", host: location.hostname, pageUrl: location.href.split("#")[0], pageTitle: clean(document.title).slice(0, 120) },
    text,
    blocks,
    items: out,
    diag: { reports: reportCount(), listItems: listItems().length, blocks: blocks.length, apiBody: api.some((a) => a.body) ? "carried" : "none" },
    apiHints,
    api,
  };
}
