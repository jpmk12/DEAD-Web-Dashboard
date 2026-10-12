// Collector for the UKMTO recent-incidents page (https://www.ukmto.org/
// recent-incidents). Injected by the background worker; runs in the user's
// own browser. UKMTO is reported to refuse automated fetches, so the
// dashboard's own server may never see the page — this is the door that
// always works: the rendered page's TEXT is posted as a `dead-ukmto` capture
// and the dashboard's parser (lib/ukmtoParse) reads the entries out of it.
// Self-contained for executeScript func injection — page globals only.
// Public site, no login, nothing is sent to UKMTO.
//
// Robustness: nothing here depends on CSS classes. It scrolls to let a lazy
// list render, clicks an obvious "load more / show more" control a few
// times if one exists, then returns the whole body text plus, where the DOM
// makes it easy, one block per element whose text starts with a reference
// ("163-26 - ADVISORY"). The server joins both and dedupes by reference.
export async function collectUkmto(durationMs, maxItems) {
  const MAX = maxItems || 300;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || "").replace(/[ \t\r\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const HEAD = /^\s*(?:UKMTO\s*)?\d{1,4}\s*-\s*\d{2}\s*[-–—:|]?\s*[A-Z]{2}/;

  const end = Date.now() + Math.min(durationMs || 15000, 30000);
  let lastLen = 0, still = 0;
  while (Date.now() < end) {
    window.scrollTo(0, document.body.scrollHeight);
    // A "load more" control, if the list paginates by script.
    const btn = Array.from(document.querySelectorAll("button, a")).find((el) => /\b(load|show|view)\s+more\b|\bmore incidents\b|\bnext\b/i.test((el.innerText || "").trim()) && (el.innerText || "").trim().length < 40);
    if (btn) { try { btn.click(); } catch (e) { /* ignore */ } }
    await sleep(900);
    const len = (document.body.innerText || "").length;
    if (len === lastLen) { still++; if (still >= 3) break; } else { still = 0; lastLen = len; }
  }
  window.scrollTo(0, 0);

  // Per-entry blocks: the smallest elements whose own text starts with a
  // reference header. Best-effort — the whole-page text is the contract.
  const blocks = [];
  const seen = new Set();
  try {
    document.querySelectorAll("article, li, section, div, tr, p").forEach((el) => {
      if (blocks.length >= MAX) return;
      const t = clean(el.innerText);
      if (!t || t.length < 20 || t.length > 6000 || !HEAD.test(t)) return;
      // Prefer the innermost such element: skip when a child also qualifies.
      const inner = Array.from(el.children).some((c) => HEAD.test(clean(c.innerText)) && clean(c.innerText).length < t.length - 10);
      if (inner) return;
      const key = t.slice(0, 40);
      if (seen.has(key)) return;
      seen.add(key);
      blocks.push(t);
    });
  } catch (e) { /* fall through with the page text */ }

  const text = clean(document.body.innerText).slice(0, 400000);
  const items = blocks.length ? blocks.map((b) => ({ text: b })) : text ? [{ text }] : [];
  return {
    format: "dead-ukmto",
    version: 1,
    capturedAt: new Date().toISOString(),
    source: { kind: "ukmto", label: "UKMTO", host: location.hostname, pageUrl: location.href.split("#")[0], pageTitle: clean(document.title).slice(0, 120) },
    text,
    blocks,
    items,
  };
}
