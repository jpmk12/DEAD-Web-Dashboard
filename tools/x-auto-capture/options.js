// Options page logic — reads/writes chrome.storage.local, triggers a manual run,
// and renders the last-run status the background worker records.

const DEFAULTS = {
  dashboardUrl: "", token: "", listUrl: "https://x.com/i/bookmarks",
  durationSec: 25, maxPosts: 200, hour: 6, enabled: true,
};
const FIELDS = ["dashboardUrl", "token", "listUrl", "durationSec", "maxPosts", "hour"];
const $ = (id) => document.getElementById(id);

async function load() {
  const c = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  for (const f of FIELDS) $(f).value = c[f];
  $("enabled").checked = !!c.enabled;
  renderStatus(c.lastRun);
}

function renderStatus(lastRun) {
  const el = $("status");
  if (!lastRun) { el.textContent = "No run yet. Save your settings, then use “Run now” to test."; return; }
  const when = new Date(lastRun.at).toLocaleString();
  if (lastRun.ok) {
    el.innerHTML = `<span class="ok">✓ Last run ${when}</span>\ncollected ${lastRun.collected} · imported ${lastRun.imported} new` +
      (lastRun.updated ? ` · ${lastRun.updated} updated` : "") + ` · ${lastRun.total} total on dashboard` +
      (lastRun.source ? `\nsource: ${lastRun.source}` : "");
  } else {
    el.innerHTML = `<span class="err">✗ Last run ${when}</span>\n${lastRun.error || "unknown error"}` +
      (lastRun.collected != null ? `\n(collected ${lastRun.collected} before failing)` : "");
  }
}

async function save() {
  const patch = {
    dashboardUrl: $("dashboardUrl").value.trim(),
    token: $("token").value.trim(),
    listUrl: $("listUrl").value.trim() || DEFAULTS.listUrl,
    durationSec: Math.max(5, Math.min(120, Number($("durationSec").value) || 25)),
    maxPosts: Math.max(10, Math.min(200, Number($("maxPosts").value) || 200)),
    hour: Math.max(0, Math.min(23, Number($("hour").value) || 6)),
    enabled: $("enabled").checked,
  };
  await chrome.storage.local.set(patch);
  await chrome.runtime.sendMessage("reschedule");
  const el = $("status");
  el.innerHTML = `<span class="ok">Saved.</span> Daily run ${patch.enabled ? `at ${patch.hour}:00 local` : "disabled"}.`;
}

async function runNow() {
  await save();
  $("status").textContent = "Running… (a background X tab will open, collect, and close — this can take ~30s)";
  const r = await chrome.runtime.sendMessage("run-now");
  renderStatus({ at: new Date().toISOString(), ...r });
}

$("save").addEventListener("click", save);
$("run").addEventListener("click", runNow);
load();
