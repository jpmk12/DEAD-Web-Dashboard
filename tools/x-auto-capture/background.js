// DEAD X Auto-Capture — background service worker (MV3).
//
// On a schedule (or a "Run now" from options) it sweeps each configured X list:
// opens a background x.com tab, injects collector.js to scroll+collect in YOUR
// logged-in session, then POSTs the dead-x-capture JSON to your dashboard's
// /api/osint/x-import with your per-user upload token. It never sends anything to
// X and never touches credentials — the token only authorizes the upload.

import { collectXPosts } from "./collector.js";
import { extractArticle } from "./article.js";
import { collectLiveuamap } from "./liveuamap.js";
import { collectMofcom } from "./mofcom.js";
import { collectUkmto } from "./ukmto.js";

const DEFAULTS = {
  dashboardUrl: "",
  token: "",
  listUrls: ["https://x.com/i/bookmarks"], // one or more views to sweep each run
  durationSec: 25,
  maxPosts: 200,
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

// Capture + upload ONE target URL. Returns a per-target result.
async function captureOne(url, c) {
  const kind = targetKind(url);
  let tab = null, created = false;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    created = true;
    await waitForTabLoad(tab.id, 20000);
    await new Promise((r) => setTimeout(r, 3500)); // let the SPA render

    const dur = Math.max(5, Number(c.durationSec) || 25) * 1000;
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: COLLECTORS[kind],
      args: [dur, Number(c.maxPosts) || (kind === "liveuamap" ? 300 : 200)],
    });
    const capture = results && results[0] && results[0].result;
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
    const up = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + c.token,
        "X-Capture-Interval-Hours": String(clampInterval(c.intervalHours)),
      },
      body: JSON.stringify(capture),
    });
    const d = await up.json().catch(() => ({}));
    if (!up.ok || !d.ok) {
      return { ok: false, error: (d && d.error) || ("Upload failed (HTTP " + up.status + ")") + own, collected: capture.items.length, hints, url };
    }
    const served = d.fromApi != null ? " [dashboard: " + d.fromApi + " rows from the SCCD API body]" : d.sections ? " [dashboard: " + d.sections + " sections]" : "";
    return { ok: true, collected: capture.items.length, imported: d.imported, updated: d.updated, total: d.total, source: capture.source && capture.source.label, note: (own + served).trim() || undefined, hints, url };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), url };
  } finally {
    if (created && tab && tab.id != null) { try { await chrome.tabs.remove(tab.id); } catch (e) { /* already gone */ } }
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
    const r = await captureOne(url, c);
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
