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

const DEFAULTS = {
  dashboardUrl: "",
  token: "",
  listUrls: ["https://x.com/i/bookmarks"], // one or more views to sweep each run
  durationSec: 25,
  maxPosts: 200,
  intervalHours: 24,                        // how often to capture; 6 = active watching
  hour: 6,                                  // preferred local hour, honored only when intervalHours >= 24
  enabled: true,
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
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "capture") runCapture(); });

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
// + the events ingest; everything else is treated as an X list.
function targetKind(url) {
  try { return /(^|\.)liveuamap\.com$/.test(new URL(url).hostname) ? "liveuamap" : "x"; }
  catch (e) { return "x"; }
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
      func: kind === "liveuamap" ? collectLiveuamap : collectXPosts,
      args: [dur, Number(c.maxPosts) || (kind === "liveuamap" ? 300 : 200)],
    });
    const capture = results && results[0] && results[0].result;
    if (!capture || !capture.items || capture.items.length === 0) {
      return { ok: false, error: kind === "liveuamap" ? "No events collected — is this a LiveUAMap region page?" : "No posts collected — check the URL and that you're logged into X.", url };
    }

    const endpoint = c.dashboardUrl.replace(/\/+$/, "") + (kind === "liveuamap" ? "/api/capture/events" : "/api/osint/x-import");
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
      return { ok: false, error: (d && d.error) || ("Upload failed (HTTP " + up.status + ")"), collected: capture.items.length, url };
    }
    return { ok: true, collected: capture.items.length, imported: d.imported, updated: d.updated, total: d.total, source: capture.source && capture.source.label, url };
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
    results.push({ url, ok: r.ok, collected: r.collected, imported: r.imported, source: r.source, error: r.error });
    if (r.ok) { anyOk = true; collected += r.collected || 0; imported += r.imported || 0; updated += r.updated || 0; if (r.total != null) total = r.total; }
    else if (!firstErr) firstErr = r.error;
  }
  const summary = anyOk
    ? { ok: true, lists: c.listUrls.length, collected, imported, updated, total, results }
    : { ok: false, error: firstErr || "all captures failed", lists: c.listUrls.length, results };
  log(summary); return summary;
}
