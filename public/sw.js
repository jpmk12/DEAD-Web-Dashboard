// DEAD's Dashboard service worker — push notifications ONLY.
//
// Deliberately NO fetch handler and NO caching. The dashboard is a live
// picture of a moving world; a cached copy that looks current is worse than
// a login page. This worker exists so the app can be installed and so the OS
// can wake it to show an alert. Everything it shows came from the server at
// push time; tapping opens (or focuses) the dashboard.

self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "DEAD's Dashboard", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "DEAD's Dashboard";
  const opts = {
    body: data.body || "",
    tag: data.tag || "dead-alert",
    renotify: true,
    icon: "/icon-192.png",
    badge: "/badge-96.png",
    data: { url: data.url || "/", at: data.at || Date.now() },
    requireInteraction: data.severity === "red",
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) { await c.focus(); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});

// Installed PWAs on Chromium can be woken periodically. When they are, ask the
// server for the current alert list — that request is what drives push
// dispatch for EVERY subscribed device (the host has no cron), so an installed
// phone keeps the whole crew's alerts flowing even when no desktop is open.
self.addEventListener("periodicsync", (event) => {
  if (event.tag !== "dead-alert-check") return;
  event.waitUntil(fetch("/api/alerts/check", { credentials: "include" }).catch(() => {}));
});
