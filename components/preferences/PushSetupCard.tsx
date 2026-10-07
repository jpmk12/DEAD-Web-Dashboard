"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/feedback";

// "Alerts on this device" — the client half of web push.
//
// Registers /sw.js, asks the OS for permission, subscribes with the server's
// VAPID public key and posts the subscription. State is read from the browser
// each time (permission + an existing subscription), never assumed from
// localStorage, so the card cannot claim alerts are on when the user revoked
// them in system settings.

type ServerState = { configured: boolean; publicKey: string | null; devices: number };

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const deviceLabel = (): string => {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "device";
  const standalone = (window.matchMedia?.("(display-mode: standalone)").matches) || (navigator as { standalone?: boolean }).standalone;
  return `${os}${standalone ? " · installed" : " · browser"}`;
};

export default function PushSetupCard() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [server, setServer] = useState<ServerState | null>(null);
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState(false);

  const refresh = useCallback(async () => {
    const ok = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    setInstalled(!!(window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone));
    if (!ok) return;
    setPermission(Notification.permission);
    try {
      const r = await fetch("/api/push/subscribe");
      if (r.ok) setServer(await r.json());
    } catch { /* leave null → "unknown" */ }
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      setSubscribed(!!sub);
    } catch { setSubscribed(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const enable = async () => {
    if (!server?.publicKey) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") { toast.warn("Notifications were not allowed for this site."); return; }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(server.publicKey) as BufferSource,
      });
      const r = await fetch("/api/push/subscribe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), label: deviceLabel(), test: true }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(j.error || "Could not save the subscription."); return; }
      // Best-effort periodic sync on installed Chromium — quietly absent elsewhere.
      try {
        const ps = (reg as ServiceWorkerRegistration & { periodicSync?: { register: (tag: string, o: { minInterval: number }) => Promise<void> } }).periodicSync;
        await ps?.register("dead-alert-check", { minInterval: 15 * 60 * 1000 });
      } catch { /* not granted / not supported */ }
      toast.ok(j.test?.ok ? "Alerts on — a test notification is on its way." : "Alerts on for this device.");
      await refresh();
    } catch (e) {
      toast.error(`Could not enable alerts: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      toast.info("Alerts off for this device.");
      await refresh();
    } finally { setBusy(false); }
  };

  const status = (() => {
    if (supported === false) return { dot: "bg-slate-600", text: "This browser cannot receive push notifications. On iPhone, add the dashboard to your Home Screen first (Share → Add to Home Screen), then open it from there." };
    if (server && !server.configured) return { dot: "bg-slate-600", text: "Push is not configured on the server — set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (see .env.example)." };
    if (permission === "denied") return { dot: "bg-red-500", text: "Notifications are blocked for this site in the browser/OS settings. Allow them there, then try again." };
    if (subscribed && permission === "granted") return { dot: "bg-emerald-500", text: `Alerts are ON for this device${server ? ` · ${server.devices} device${server.devices === 1 ? "" : "s"} enabled on your account` : ""}.` };
    return { dot: "bg-amber-500", text: "Alerts are off for this device." };
  })();

  const canEnable = supported && server?.configured && permission !== "denied" && !subscribed;

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Alerts on this device</label>
      <p className="text-[10px] text-slate-600 mb-2">
        OS notifications for force-protection RED, life-threatening weather at tracked points, ordered departures, and I&amp;W warning/alert — the same conditions the capture extension raises. Nothing else is ever pushed.
      </p>
      <div className="p-3 bg-slate-800/70 border border-slate-700/80 rounded-lg space-y-2">
        <div className="flex items-start gap-2">
          <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${status.dot}`} aria-hidden />
          <p className="text-xs text-slate-300 leading-snug">{status.text}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEnable && (
            <button type="button" onClick={enable} disabled={busy}
              className="text-[11px] font-bold uppercase tracking-wider bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3 py-1.5 rounded-md disabled:opacity-50">
              {busy ? "Enabling…" : "Enable alerts"}
            </button>
          )}
          {subscribed && (
            <button type="button" onClick={disable} disabled={busy}
              className="text-xs px-3 py-1.5 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50">
              {busy ? "…" : "Turn off on this device"}
            </button>
          )}
          {!installed && supported && (
            <span className="text-[10px] text-slate-500">
              Tip: install the app (browser menu → Install / Add to Home Screen) so alerts arrive with the browser closed.
            </span>
          )}
        </div>
        <p className="text-[10px] text-slate-600 leading-snug">
          How delivery works: this host has no scheduler, so pushes go out whenever any client checks in — the capture extension&rsquo;s poll (every 15 min by default), an open dashboard tab, or an installed app&rsquo;s background sync. If nothing is polling, nothing is sent.
        </p>
      </div>
    </div>
  );
}
