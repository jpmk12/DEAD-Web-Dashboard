// DEAD X Auto-Capture — background service worker (MV3).
//
// On a daily alarm (or a "Run now" from the options page) it: opens a background
// x.com tab at your configured list URL, injects collector.js to scroll+collect
// the posts (in YOUR logged-in session), then POSTs the dead-x-capture JSON to
// your dashboard's /api/osint/x-import with your per-user upload token. It never
// sends anything to X and never touches credentials — the token only authorizes
// the upload to your own dashboard.

import { collectXPosts } from "./collector.js";

const DEFAULTS = {
  dashboardUrl: "",
  token: "",
  listUrl: "https://x.com/i/bookmarks",
  durationSec: 25,
  maxPosts: 200,
  hour: 6,          // local hour (0-23) for the daily run
  enabled: true,
};

async function cfg() {
  const c = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...c };
}
function log(entry) {
  chrome.storage.local.set({ lastRun: { at: new Date().toISOString(), ...entry } });
}

async function scheduleAlarm() {
  const c = await cfg();
  await chrome.alarms.clear("daily-capture");
  if (!c.enabled) return;
  const now = new Date();
  const next = new Date(now);
  next.setHours(c.hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  chrome.alarms.create("daily-capture", { when: next.getTime(), periodInMinutes: 1440 });
}

chrome.runtime.onInstalled.addListener(scheduleAlarm);
chrome.runtime.onStartup.addListener(scheduleAlarm);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "daily-capture") runCapture(); });

chrome.runtime.onMessage.addListener((m, _sender, send) => {
  const type = typeof m === "string" ? m : m && m.type;
  if (type === "run-now") { runCapture().then(send); return true; }        // async response
  if (type === "reschedule") { scheduleAlarm().then(() => send({ ok: true })); return true; }
  return false;
});

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

async function runCapture() {
  const c = await cfg();
  if (!c.dashboardUrl || !c.token) {
    const r = { ok: false, error: "Set your dashboard URL and upload token in the extension options first." };
    log(r); return r;
  }
  let tab = null, created = false;
  try {
    tab = await chrome.tabs.create({ url: c.listUrl, active: false });
    created = true;
    await waitForTabLoad(tab.id, 20000);
    await new Promise((r) => setTimeout(r, 3500)); // let X's SPA render the first posts

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectXPosts,
      args: [Math.max(5, Number(c.durationSec) || 25) * 1000, Number(c.maxPosts) || 200],
    });
    const capture = results && results[0] && results[0].result;
    if (!capture || !capture.items || capture.items.length === 0) {
      const r = { ok: false, error: "No posts collected — check the list URL and that you're logged into X in this browser." };
      log(r); return r;
    }

    const endpoint = c.dashboardUrl.replace(/\/+$/, "") + "/api/osint/x-import";
    const up = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + c.token },
      body: JSON.stringify(capture),
    });
    const d = await up.json().catch(() => ({}));
    if (!up.ok || !d.ok) {
      const r = { ok: false, error: (d && d.error) || ("Upload failed (HTTP " + up.status + ")"), collected: capture.items.length };
      log(r); return r;
    }
    const r = { ok: true, collected: capture.items.length, imported: d.imported, updated: d.updated, total: d.total, source: capture.source && capture.source.label };
    log(r); return r;
  } catch (e) {
    const r = { ok: false, error: String((e && e.message) || e) };
    log(r); return r;
  } finally {
    if (created && tab && tab.id != null) { try { await chrome.tabs.remove(tab.id); } catch (e) { /* tab already gone */ } }
  }
}
