// Options page logic — reads/writes chrome.storage.local, triggers a manual run,
// and renders the last-run status the background worker records.

const DEFAULTS = {
  dashboardUrl: "", token: "", listUrls: ["https://x.com/i/bookmarks"],
  durationSec: 25, maxPosts: 200, intervalHours: 24, hour: 6, enabled: true,
};
const $ = (id) => document.getElementById(id);

async function load() {
  const raw = await chrome.storage.local.get(null);
  const c = { ...DEFAULTS, ...raw };
  if (!Array.isArray(c.listUrls) || !c.listUrls.length) {
    c.listUrls = (typeof raw.listUrl === "string" && raw.listUrl) ? [raw.listUrl] : DEFAULTS.listUrls;
  }
  $("dashboardUrl").value = c.dashboardUrl;
  $("token").value = c.token;
  $("listUrls").value = c.listUrls.join("\n");
  $("intervalHours").value = c.intervalHours;
  $("hour").value = c.hour;
  $("durationSec").value = c.durationSec;
  $("maxPosts").value = c.maxPosts;
  $("enabled").checked = !!c.enabled;
  renderStatus(raw.lastRun, raw.lastArticle);
}

function renderStatus(lastRun, lastArticle) {
  const el = $("status");
  const art = lastArticle
    ? `\n\nLast article capture ${new Date(lastArticle.at).toLocaleString()}: ` +
      (lastArticle.ok ? `✓ “${escapeHtml(lastArticle.title || "captured")}” (${escapeHtml(lastArticle.source || "")}, ${lastArticle.total} total)` : `✗ ${escapeHtml(lastArticle.error || "failed")}`)
    : "\n\nTip: click the toolbar icon while reading an article to capture it.";
  if (!lastRun) { el.innerHTML = "No list run yet. Save your settings, then use “Run now” to test." + art; return; }
  const when = new Date(lastRun.at).toLocaleString();
  const perList = Array.isArray(lastRun.results) && lastRun.results.length > 1
    ? "\n" + lastRun.results.map((r) => `  • ${r.source || r.url}: ${r.ok ? `${r.collected} collected` : "✗ " + (r.error || "failed")}`).join("\n")
    : "";
  if (lastRun.ok) {
    el.innerHTML = `<span class="ok">✓ Last run ${when}</span>\n${lastRun.lists || 1} list(s) · collected ${lastRun.collected} · imported ${lastRun.imported} new` +
      (lastRun.updated ? ` · ${lastRun.updated} updated` : "") + (lastRun.total != null ? ` · ${lastRun.total} total on dashboard` : "") +
      escapeHtml(perList) + art;
  } else {
    el.innerHTML = `<span class="err">✗ Last run ${when}</span>\n${lastRun.error || "unknown error"}` + escapeHtml(perList) + art;
  }
}
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

async function save() {
  const listUrls = $("listUrls").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const patch = {
    dashboardUrl: $("dashboardUrl").value.trim(),
    token: $("token").value.trim(),
    listUrls: listUrls.length ? listUrls : DEFAULTS.listUrls,
    intervalHours: Math.max(3, Math.min(24, Number($("intervalHours").value) || 24)),
    durationSec: Math.max(5, Math.min(120, Number($("durationSec").value) || 25)),
    maxPosts: Math.max(10, Math.min(200, Number($("maxPosts").value) || 200)),
    hour: Math.max(0, Math.min(23, Number($("hour").value) || 6)),
    enabled: $("enabled").checked,
  };
  await chrome.storage.local.set(patch);
  await chrome.runtime.sendMessage("reschedule");
  const cadence = patch.intervalHours >= 24 ? `daily at ${patch.hour}:00 local` : `every ${patch.intervalHours}h`;
  $("status").innerHTML = `<span class="ok">Saved.</span> ${patch.enabled ? `Runs ${cadence} across ${patch.listUrls.length} list(s).` : "Scheduling disabled."}`;
}

async function runNow() {
  await save();
  $("status").textContent = "Running… (a background X tab opens per list, collects, and closes — this can take ~30s each)";
  const r = await chrome.runtime.sendMessage("run-now");
  renderStatus({ at: new Date().toISOString(), ...r });
}

$("save").addEventListener("click", save);
$("run").addEventListener("click", runNow);
load();
