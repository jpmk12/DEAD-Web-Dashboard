// DEAD X Auto-Capture — background service worker (MV3).
//
// On a schedule (or a "Run now" from options) it sweeps each configured X list:
// opens a background x.com tab, injects collector.js to scroll+collect in YOUR
// logged-in session, then POSTs the dead-x-capture JSON to your dashboard's
// /api/osint/x-import with your per-user upload token. It never sends anything to
// X and never touches credentials — the token only authorizes the upload.

import { collectXPosts } from "./collector.js";
import { postsFromGraphql, mergeXPosts } from "./xgraphql.js";
import { extractArticle } from "./article.js";
import { collectLiveuamap, probeLiveuamapCoords, clickProbeLiveuamap } from "./liveuamap.js";
import { collectMofcom } from "./mofcom.js";
import { collectUkmto } from "./ukmto.js";

const DEFAULTS = {
  dashboardUrl: "",
  token: "",
  listUrls: ["https://x.com/i/bookmarks"], // one or more views to sweep each run
  durationSec: 25,
  maxPosts: 200,
  xFront: false,                            // bring the X capture window to the front (renders more, takes focus)
  intervalHours: 24,                        // how often to capture; 6 = active watching
  hour: 6,                                  // preferred local hour, honored only when intervalHours >= 24
  enabled: true,
  alertsEnabled: true,                      // poll /api/alerts/check and raise OS notifications
  alertIntervalMin: 15,
};

async function cfg() {
  const raw = await chrome.storage.local.get(null);
  const c = { ...DEFAULTS, ...raw };
  // Migrate the old single-list setting → listUrls.
  if (!Array.isArray(raw.listUrls) && typeof raw.listUrl === "string" && raw.listUrl) c.listUrls = [raw.listUrl];
  if (!Array.isArray(c.listUrls) || !c.listUrls.length) c.listUrls = DEFAULTS.listUrls;
  return c;
}
function log(entry) { chrome.storage.local.set({ lastRun: { at: new Date().toISOString(), ...entry } }); }
function clampInterval(h) { return Math.max(3, Math.min(24, Number(h) || 24)); }

async function scheduleAlarm() {
  const c = await cfg();
  await chrome.alarms.clear("capture");
  await chrome.alarms.clear("daily-capture"); // legacy name
  await chrome.alarms.clear("alerts");
  if (c.alertsEnabled !== false) {
    const mins = Math.max(5, Math.min(120, Number(c.alertIntervalMin) || 15));
    chrome.alarms.create("alerts", { delayInMinutes: 1, periodInMinutes: mins });
  }
  if (!c.enabled) return;
  const hours = clampInterval(c.intervalHours);
  if (hours >= 24) {
    // Daily at the preferred local hour.
    const now = new Date();
    const next = new Date(now);
    next.setHours(Math.max(0, Math.min(23, Number(c.hour) || 6)), 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    chrome.alarms.create("capture", { when: next.getTime(), periodInMinutes: 1440 });
  } else {
    // Every N hours from now.
    chrome.alarms.create("capture", { delayInMinutes: hours * 60, periodInMinutes: hours * 60 });
  }
}

chrome.runtime.onInstalled.addListener(scheduleAlarm);
chrome.runtime.onStartup.addListener(scheduleAlarm);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "capture") runCapture(); else if (a.name === "alerts") checkAlerts(); });

chrome.runtime.onMessage.addListener((m, _sender, send) => {
  const type = typeof m === "string" ? m : m && m.type;
  if (type === "run-now") { runCapture().then(send); return true; }
  if (type === "reschedule") { scheduleAlarm().then(() => send({ ok: true })); return true; }
  return false;
});

// Toolbar-icon click = "capture THIS article" (the piece you're reading). Manual,
// on-demand — the reader-capture flow, separate from the scheduled list sweep.
chrome.action.onClicked.addListener((tab) => { if (tab && tab.id != null) captureArticle(tab); });

function badge(text, ok) {
  chrome.action.setBadgeBackgroundColor({ color: ok ? "#10b981" : "#ef4444" });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
}

async function captureArticle(tab) {
  const c = await cfg();
  if (!c.dashboardUrl || !c.token) { badge("SET", false); chrome.storage.local.set({ lastArticle: { at: new Date().toISOString(), ok: false, error: "Set dashboard URL + token in options first." } }); return; }
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractArticle });
    const art = results && results[0] && results[0].result;
    if (!art || !art.title || !art.text || art.text.length < 40) {
      badge("?", false);
      chrome.storage.local.set({ lastArticle: { at: new Date().toISOString(), ok: false, error: "Couldn't extract an article from this page." } });
      return;
    }
    const up = await fetch(c.dashboardUrl.replace(/\/+$/, "") + "/api/capture/article", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + c.token },
      body: JSON.stringify(art),
    });
    const d = await up.json().catch(() => ({}));
    if (up.ok && d.ok) {
      badge("✓", true);
      chrome.storage.local.set({ lastArticle: { at: new Date().toISOString(), ok: true, title: d.title, source: d.source, total: d.total } });
    } else {
      badge("✗", false);
      chrome.storage.local.set({ lastArticle: { at: new Date().toISOString(), ok: false, error: (d && d.error) || ("HTTP " + up.status) } });
    }
  } catch (e) {
    badge("✗", false);
    chrome.storage.local.set({ lastArticle: { at: new Date().toISOString(), ok: false, error: String((e && e.message) || e) } });
  }
}

function waitForTabLoad(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => { if (id === tabId && info.status === "complete") finish(); };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(finish, timeoutMs);
  });
}

// Route a capture target by host: LiveUAMap region maps use the event collector
// + the events ingest; MOFCOM (PRC Ministry of Commerce) pages use the notice
// collector + the notices ingest; UKMTO's recent-incidents page uses the
// page-text collector + the ukmto ingest; everything else is treated as an X
// list.
function targetKind(url) {
  try {
    const h = new URL(url).hostname;
    if (/(^|\.)liveuamap\.com$/.test(h)) return "liveuamap";
    if (/(^|\.)mofcom\.gov\.cn$/.test(h)) return "mofcom";
    if (/(^|\.)ukmto\.org$/.test(h)) return "ukmto";
    return "x";
  } catch (e) { return "x"; }
}
const COLLECTORS = { liveuamap: collectLiveuamap, mofcom: collectMofcom, ukmto: collectUkmto, x: collectXPosts };
const ENDPOINTS = { liveuamap: "/api/capture/events", mofcom: "/api/capture/notices", ukmto: "/api/capture/ukmto", x: "/api/osint/x-import" };
const EMPTY_MSG = {
  liveuamap: "No events collected — is this a LiveUAMap region page?",
  mofcom: "No notices collected — is this a MOFCOM announcements list or notice page?",
  ukmto: "No page text collected — is this the UKMTO recent-incidents page?",
  x: "No posts collected — check the URL and that you're logged into X.",
};

// What the tab actually showed when a collector found nothing — injected AFTER
// an empty collection so the run log can say WHY instead of "no items": a
// login wall, a bot challenge, a redirect to another page, a page that never
// rendered (0 characters), or a page that rendered but whose markup the
// collector no longer recognises (plenty of text and links, 0 items — that
// one needs the saved HTML). Self-contained for executeScript func injection.
function pageDiag() {
  const text = (document.body && document.body.innerText) || "";
  const title = (document.title || "").replace(/\s+/g, " ").trim().slice(0, 80);
  const low = (title + " " + text.slice(0, 2000)).toLowerCase();
  let wall = "";
  if (/just a moment|checking your browser|verify you are human|attention required|cloudflare/.test(low)) wall = "bot challenge";
  else if (/\blog in\b|\bsign in\b|\blogin\b/.test(low) && (/password/.test(low) || location.pathname.includes("login") || location.pathname.includes("/i/flow/"))) wall = "login wall";
  else if (/access denied|403 forbidden|blocked|rate limit/.test(low)) wall = "access refused";
  else if (/this page doesn.t exist|page not found|404|something went wrong|try again/.test(low) && text.length < 1500) wall = "not found / error page";
  return {
    title,
    href: location.href.slice(0, 200),
    chars: text.length,
    links: document.querySelectorAll("a[href]").length,
    wall,
  };
}
function diagLine(d, requested) {
  if (!d) return "";
  const parts = [];
  if (d.wall) parts.push(d.wall);
  try {
    const want = new URL(requested), got = new URL(d.href);
    if (want.hostname !== got.hostname || want.pathname.replace(/\/+$/, "") !== got.pathname.replace(/\/+$/, "")) parts.push("landed on " + got.hostname + got.pathname.slice(0, 60));
  } catch (e) { /* no comparison */ }
  parts.push(d.chars === 0 ? "page rendered no text" : d.chars + " chars · " + d.links + " links");
  if (d.title) parts.push("“" + d.title + "”");
  return " [page: " + parts.join(" · ") + "]";
}

const X_MIN_DURATION_MS = 45000;
// A bodiless 502/503/504 is retried after these waits (a restart of the host
// takes longer than one short pause), then the dashboard is asked whether it
// answers at all, so the log can tell "down" from "this route refused".
const UPLOAD_RETRY_MS = [8000, 30000];
const X_HOOK_ID = "dead-x-graphql-hook";

// Where a capture runs. Every site uses a background tab. Chrome pauses
// RENDERING in a tab that is not on screen — and a window behind another
// window counts as not on screen (1.2.7 tried an unfocused window of its own;
// the run log still read "tab hidden") — so on X the page only draws a few
// posts. 1.2.8 therefore reads X's own timeline responses (xhook.js), which
// arrive whether or not anything is drawn. The option "bring the X capture
// to the front" opens a FOCUSED window instead, so X can also render and
// load further batches as the collector scrolls; it takes the keyboard for
// the length of the capture, which is why it is off by default.
// Windows this worker is closing. A background tab created right after an X
// window closed landed in that window as it went away — "No tab with id" on
// the next target (2026-10-28 run log) — so a tab is always opened into a
// named window that is not on this list.
const closingWindows = new Set();
async function backgroundWindowId() {
  try {
    const wins = await chrome.windows.getAll({ windowTypes: ["normal"] });
    const usable = wins.filter((w) => !closingWindows.has(w.id) && w.state !== "minimized");
    const pick = usable.find((w) => w.focused) || usable[0] || wins.find((w) => !closingWindows.has(w.id));
    return pick ? pick.id : undefined;
  } catch (e) { return undefined; }
}

async function openCaptureTab(url, kind, c) {
  if (kind === "x" && c.xFront) {
    try {
      const w = await chrome.windows.create({ url, focused: true, state: "normal", type: "normal", width: 900, height: 1100 });
      const t = w && w.tabs && w.tabs[0];
      if (t && t.id != null) return { ...t, windowId: w.id, _ownWindow: true };
    } catch (e) { /* fall back to a tab */ }
  }
  const windowId = await backgroundWindowId();
  return await chrome.tabs.create(windowId != null ? { url, active: false, windowId } : { url, active: false });
}

// The response hook runs only for the capture target's own URL and only
// while the capture runs; it is removed in `finally`.
function hookMatches(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return ["https://x.com" + path + "*", "https://twitter.com" + path + "*"];
  } catch (e) { return null; }
}
async function armXHook(url) {
  const matches = hookMatches(url);
  if (!matches) return false;
  try { await chrome.scripting.unregisterContentScripts({ ids: [X_HOOK_ID] }); } catch (e) { /* none registered */ }
  try {
    await chrome.scripting.registerContentScripts([{ id: X_HOOK_ID, matches, js: ["xhook.js"], runAt: "document_start", world: "MAIN", persistAcrossSessions: false }]);
    return true;
  } catch (e) { return false; }
}
async function disarmXHook() {
  try { await chrome.scripting.unregisterContentScripts({ ids: [X_HOOK_ID] }); } catch (e) { /* already gone */ }
}
function readXHook() {
  const s = window.__deadX;
  return s ? { responses: s.responses.slice(0, 60), count: s.responses.length } : null;
}

// Is the dashboard answering at all? (after an upload the host refused)
async function dashboardAnswers(c) {
  try {
    const r = await fetch(c.dashboardUrl.replace(/\/+$/, "") + "/api/alerts/check", { headers: { "Authorization": "Bearer " + c.token } });
    return r.ok ? "dashboard answers (alerts check " + r.status + ") — this route was refused" : "dashboard alerts check also " + r.status;
  } catch (e) { return "dashboard unreachable"; }
}

// Capture + upload ONE target URL. Returns a per-target result.
async function captureOne(url, c) {
  const kind = targetKind(url);
  let tab = null, created = false, winId = null, hooked = false;
  try {
    if (kind === "x") hooked = await armXHook(url);
    tab = await openCaptureTab(url, kind, c);
    created = true;
    if (tab.windowId != null && tab._ownWindow) winId = tab.windowId;
    await waitForTabLoad(tab.id, 20000);
    await new Promise((r) => setTimeout(r, 3500)); // let the SPA render

    // X renders a few posts per batch and needs time to scroll through
    // them; a budget set for the other sites is too short for a list.
    const base = Math.max(5, Number(c.durationSec) || 25) * 1000;
    const dur = kind === "x" ? Math.max(base, X_MIN_DURATION_MS) : base;
    const max = Number(c.maxPosts) || (kind === "liveuamap" ? 300 : 200);
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: COLLECTORS[kind],
      args: [dur, max],
    });
    const capture = (results && results[0] && results[0].result) || null;

    // X: the posts in X's own timeline responses, merged with what was drawn.
    if (kind === "x" && capture) {
      let read = null;
      try {
        const r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: readXHook });
        read = r && r[0] && r[0].result;
      } catch (e) { /* the page may have navigated */ }
      const apiPosts = read ? postsFromGraphql(read.responses, max) : [];
      const drawn = Array.isArray(capture.items) ? capture.items.length : 0;
      capture.items = mergeXPosts(apiPosts, capture.items, max);
      capture.diag = { ...(capture.diag || {}), drawn, fromResponses: read ? apiPosts.length + " posts in " + read.count + " responses" : (hooked ? "hook saw nothing" : "hook not armed") };
    }

    // LiveUAMap: positions from the map's own JavaScript, joined by permalink.
    if (kind === "liveuamap" && capture && Array.isArray(capture.items)) {
      try {
        const r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: probeLiveuamapCoords });
        const probe = r && r[0] && r[0].result;
        if (probe) {
          const byPath = new Map(probe.found.map(([p, la, ln]) => [p, [la, ln]]));
          const byId = new Map((probe.byId || []).map(([id, la, ln]) => [id, [la, ln]]));
          const byTitle = new Map((probe.byTitle || []).map(([t, la, ln]) => [t, [la, ln]]));
          // Same normalisation as the probe's textKey.
          const textKey = (t) => String(t || "").replace(/<[^>]*>/g, " ").toLowerCase().replace(/[^a-z0-9\u0600-\u06ff\u0400-\u04ff]+/g, " ").trim().slice(0, 60);
          const how = { path: 0, id: 0, title: 0 };
          for (const it of capture.items) {
            if (it.lat != null) continue;
            let path = "";
            try { path = new URL(it.url).pathname; } catch (e) { /* no path */ }
            let c2 = path ? byPath.get(path) : null, via = "path";
            if (!c2 && it.eid) { c2 = byId.get(String(it.eid)); via = "id"; }
            if (!c2) {
              const tk = textKey(it.title);
              if (tk.length >= 20) {
                c2 = byTitle.get(tk); via = "title";
                // A popup that shortens or extends the headline: the first 40
                // normalised characters of one must begin the other.
                if (!c2) {
                  const head = tk.slice(0, 40);
                  for (const [k, v] of byTitle) { if (k.length >= 30 && (k.startsWith(head) || tk.startsWith(k.slice(0, 40)))) { c2 = v; break; } }
                }
              }
            }
            if (c2) { it.lat = c2[0]; it.lng = c2[1]; how[via]++; }
          }
          // Still unplaced with an id: click each feed entry and read the
          // popup the site opens (clickProbeLiveuamap).
          let clickDiag = null;
          const needIds = capture.items.filter((i) => i.lat == null && i.eid).map((i) => i.eid);
          if (needIds.length) {
            try {
              const r2 = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: clickProbeLiveuamap, args: [needIds, 25000] });
              const cp = r2 && r2[0] && r2[0].result;
              if (cp) {
                clickDiag = cp.diag;
                const got = new Map(cp.byId.map(([id, la, ln]) => [String(id), [la, ln]]));
                how.click = 0;
                for (const it of capture.items) {
                  if (it.lat != null || !it.eid) continue;
                  const c3 = got.get(String(it.eid));
                  if (c3) { it.lat = c3[0]; it.lng = c3[1]; how.click++; }
                }
              }
            } catch (e) { clickDiag = { error: String((e && e.message) || e).slice(0, 80) }; }
          }
          const joined = how.path + how.id + how.title + (how.click || 0);
          const d = probe.diag || {};
          capture.diag = {
            ...(capture.diag || {}),
            placed: capture.items.filter((i) => i.lat != null).length,
            mapProbe: [d.map || "no map lib", "markers " + d.markers + " (linked " + d.markersLinked + ")", "objects " + d.objects + " (linked " + d.objectsLinked + ")", "ids " + (d.byId || 0) + " · titles " + (d.byTitle || 0), d.layerMaps && d.layerMaps.length ? "id→marker tables " + d.layerMaps.join(" ; ") : "no id→marker table", "joined " + joined + (joined ? " (path " + how.path + " · id " + how.id + " · title " + how.title + (how.click != null ? " · click " + how.click : "") + ")" : ""), clickDiag ? "click probe " + (clickDiag.error ? "failed: " + clickDiag.error : (clickDiag.map ? "clicked " + clickDiag.clicked + " · popups " + clickDiag.opened + " · map moved " + clickDiag.moved + (clickDiag.sample && clickDiag.sample.length ? " e.g. " + clickDiag.sample.join(" ; ") : "") : "no map found")) : "", d.markerSample ? "marker " + d.markerSample : "", d.arrays && d.arrays.length ? "arrays " + d.arrays.join(" ; ") : "", d.scriptPairs ? "script lat/lng pairs " + d.scriptPairs + " e.g. " + d.scriptSample : ""].filter(Boolean).join(" · "),
          };
        }
      } catch (e) { /* the probe is best-effort */ }
    }

    // A collector's own diagnostic (what it waited for and what it found)
    // and the data requests it saw, for the run log either way.
    const own = capture && capture.diag ? " [collector: " + Object.entries(capture.diag).map(([k, v]) => k + " " + v).join(" · ") + "]" : "";
    // Hints: the data requests, each with its sampled status + first 240
    // chars when the collector fetched it — the record shape, in the log.
    const samples = capture && Array.isArray(capture.api) ? capture.api : [];
    const hints = capture && Array.isArray(capture.apiHints) && capture.apiHints.length
      ? capture.apiHints.slice(0, 6).map((u) => { const s = samples.find((a) => a.url === u); return s ? u + " → " + (s.status || "no answer") + (s.sample ? " · " + String(s.sample).replace(/\s+/g, " ").slice(0, 240) : "") : u; })
      : null;
    if (!capture || !capture.items || capture.items.length === 0) {
      let diag = null;
      try {
        const d = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageDiag });
        diag = d && d[0] && d[0].result;
      } catch (e) { /* the diagnostic is best-effort */ }
      return { ok: false, error: EMPTY_MSG[kind] + diagLine(diag, url) + own, diag, hints, url };
    }

    const endpoint = c.dashboardUrl.replace(/\/+$/, "") + ENDPOINTS[kind];
    const body = JSON.stringify(capture);
    const post = () => fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + c.token,
        "X-Capture-Interval-Hours": String(clampInterval(c.intervalHours)),
      },
      body,
    });
    let up = await post();
    let d = await up.json().catch(() => null);
    // A 502/503/504 with NO JSON body is the host's gateway (a restart or a
    // slow moment), not the dashboard's answer — the dashboard always says
    // why. Wait and send the same capture again, twice.
    let retries = 0;
    for (const wait of UPLOAD_RETRY_MS) {
      if (d || ![502, 503, 504].includes(up.status)) break;
      retries++;
      await new Promise((r) => setTimeout(r, wait));
      up = await post();
      d = await up.json().catch(() => null);
    }
    if (!up.ok || !d || !d.ok) {
      const probe = !d ? " — " + (await dashboardAnswers(c)) : "";
      const why = (d && d.error)
        || ("Upload failed (HTTP " + up.status + (d ? "" : " with no body — the host's gateway, not the dashboard") + (retries ? ", also on " + retries + " retr" + (retries === 1 ? "y" : "ies") : "") + ", " + Math.round(body.length / 1024) + " kB" + probe + ")");
      return { ok: false, error: why + own, collected: capture.items.length, hints, url };
    }
    const served = d.fromApi != null
      ? " [dashboard: " + d.fromApi + " rows from the SCCD API body" + (d.parsed != null ? " · " + d.parsed + " parsed" : "") + (d.placed != null ? " · " + d.placed + " with a reported position" : "") + (Array.isArray(d.apiKeys) && d.apiKeys.length ? " · keys: " + d.apiKeys.join(", ") : "") + "]"
      : d.sections ? " [dashboard: " + d.sections + " sections]" : "";
    return { ok: true, collected: capture.items.length, imported: d.imported, updated: d.updated, total: d.total, source: capture.source && capture.source.label, note: (own + served).trim() || undefined, hints, url };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), url };
  } finally {
    if (hooked) await disarmXHook();
    if (winId != null) {
      closingWindows.add(winId);
      try { await chrome.windows.remove(winId); } catch (e) { /* already gone */ }
      await new Promise((r) => setTimeout(r, 600));
      closingWindows.delete(winId);
    }
    else if (created && tab && tab.id != null) { try { await chrome.tabs.remove(tab.id); } catch (e) { /* already gone */ } }
  }
}

async function runCapture() {
  const c = await cfg();
  if (!c.dashboardUrl || !c.token) {
    const r = { ok: false, error: "Set your dashboard URL and upload token in the extension options first." };
    log(r); return r;
  }
  const results = [];
  let anyOk = false, firstErr = null, collected = 0, imported = 0, updated = 0, total = null;
  // Sequential — one background tab at a time is gentler and looks less automated.
  for (const url of c.listUrls) {
    let r = await captureOne(url, c);
    // The tab went away under the capture (closed, discarded, or opened into
    // a window that was closing) — one more try in a fresh tab.
    if (!r.ok && /No tab with id|tab was closed|Frame with ID/i.test(r.error || "")) {
      await new Promise((res) => setTimeout(res, 1500));
      r = await captureOne(url, c);
      if (r.ok) r.note = ((r.note || "") + " [retried: the first tab went away]").trim();
    }
    results.push({ url, ok: r.ok, collected: r.collected, imported: r.imported, source: r.source, error: r.error, note: r.note, hints: r.hints });
    if (r.ok) { anyOk = true; collected += r.collected || 0; imported += r.imported || 0; updated += r.updated || 0; if (r.total != null) total = r.total; }
    else if (!firstErr) firstErr = r.error;
  }
  const summary = anyOk
    ? { ok: true, lists: c.listUrls.length, collected, imported, updated, total, results }
    : { ok: false, error: firstErr || "all captures failed", lists: c.listUrls.length, results };
  log(summary); return summary;
}

// ── Dashboard alert notifications ────────────────────────────────────────────
// Polls /api/alerts/check (stable-id current conditions) and raises an OS
// notification for ids not seen before — so a force-protection RED, severe
// weather at a tracked point, an ordered departure, or an I&W warning reaches
// you while the dashboard tab is closed. The seen-set lives in
// chrome.storage.local (capped); clearing it re-notifies current conditions.
async function checkAlerts() {
  const c = await cfg();
  if (c.alertsEnabled === false || !c.dashboardUrl || !c.token) return;
  try {
    const r = await fetch(c.dashboardUrl.replace(/\/+$/, "") + "/api/alerts/check", {
      headers: { "Authorization": "Bearer " + c.token },
    });
    if (!r.ok) return;
    const d = await r.json();
    const alerts = Array.isArray(d && d.alerts) ? d.alerts : [];
    const stored = await chrome.storage.local.get("alertsSeen");
    const seen = new Set(Array.isArray(stored.alertsSeen) ? stored.alertsSeen : []);
    const fresh = alerts.filter((a) => a && a.id && !seen.has(a.id));
    for (const a of fresh.slice(0, 3)) { // cap a burst — the dashboard has the full list
      chrome.notifications.create("dead-" + a.id, {
        type: "basic",
        iconUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        title: (a.severity === "red" ? "🔴 " : "🟠 ") + (a.title || "Dashboard alert"),
        message: a.sub || "",
        priority: a.severity === "red" ? 2 : 1,
      });
    }
    if (fresh.length) {
      for (const a of fresh) seen.add(a.id);
      chrome.storage.local.set({ alertsSeen: [...seen].slice(-200) });
      chrome.storage.local.set({ lastAlerts: { at: new Date().toISOString(), count: alerts.length, newCount: fresh.length } });
    }
  } catch (e) { /* transient — next poll retries */ }
}
