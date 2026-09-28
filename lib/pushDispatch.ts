// Web-push dispatch — server-only.
//
// HOW IT FIRES (be honest about this): GoDaddy Node.js Hosting has no cron and
// no always-on worker, so nothing here runs on a timer. Dispatch PIGGYBACKS on
// the alert check: whenever anything calls /api/alerts/check — the capture
// extension's 15-minute alarm poll, a dashboard tab's own heartbeat, or a
// service worker's periodic sync on an installed PWA — the fresh alert list is
// compared against every subscription's seen-set and the differences are
// pushed. So a phone with the app installed gets told about a new RED as soon
// as ANY client asks the server, which in practice is within the extension's
// poll cadence. If nothing polls, nothing is sent — the endpoint says so.
//
// Rate-limited to one dispatch pass per DISPATCH_MIN_GAP regardless of how
// often the check is hit; the alert list itself is 5-min cached upstream.
//
// VAPID keys come from the environment (see .env.example). Without them the
// feature is simply off: subscribe reports `configured:false`, dispatch no-ops.

import webpush from "web-push";
import type { AlertItem } from "./alerts";
import { selectFresh, summarize } from "./pushSelect";
import { listSubscriptions, markPushed, setSeen, deleteSubscription } from "./pushStore";

export const DISPATCH_MIN_GAP = 4 * 60 * 1000;

export interface VapidConfig { publicKey: string; privateKey: string; subject: string }

export function vapidConfig(): VapidConfig | null {
  const publicKey = (process.env.VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY ?? "").trim();
  const subject = (process.env.VAPID_SUBJECT ?? "").trim() || (process.env.OWNER_EMAIL ? `mailto:${process.env.OWNER_EMAIL.trim()}` : "");
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

let lastPass = 0;
let passing: Promise<DispatchReport> | null = null;

export interface DispatchReport {
  ran: boolean;
  reason?: string;
  subscriptions: number;
  sent: number;
  dropped: number;
}

export async function dispatchPush(alerts: AlertItem[], opts: { force?: boolean } = {}): Promise<DispatchReport> {
  const cfg = vapidConfig();
  if (!cfg) return { ran: false, reason: "vapid not configured", subscriptions: 0, sent: 0, dropped: 0 };
  if (!opts.force && Date.now() - lastPass < DISPATCH_MIN_GAP) {
    return { ran: false, reason: "rate-limited", subscriptions: 0, sent: 0, dropped: 0 };
  }
  if (passing) return passing;
  lastPass = Date.now();
  passing = pass(alerts, cfg).finally(() => { passing = null; });
  return passing;
}

async function pass(alerts: AlertItem[], cfg: VapidConfig): Promise<DispatchReport> {
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  const subs = await listSubscriptions().catch(() => []);
  let sent = 0, dropped = 0;

  for (const s of subs) {
    const { fresh, nextSeen } = selectFresh(alerts, s.seen);
    const note = summarize(fresh);
    if (!note) {
      // Seen-set housekeeping only when the current set actually moved.
      if (nextSeen.length !== s.seen.length || nextSeen.some((id, i) => id !== s.seen[i])) {
        await setSeen(s.endpoint, nextSeen).catch(() => {});
      }
      continue;
    }
    const payload = JSON.stringify({
      title: note.title,
      body: note.body,
      tag: note.tag,
      url: "/",
      severity: fresh.some((a) => a.severity === "red") ? "red" : "amber",
      at: Date.now(),
    });
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 60 * 60, urgency: "high" },
      );
      await markPushed(s.endpoint, nextSeen).catch(() => {});
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      // 404/410: the browser unsubscribed or the endpoint expired — drop it so
      // we stop encrypting to a dead address. Anything else is transient.
      if (code === 404 || code === 410) {
        await deleteSubscription(s.endpoint).catch(() => {});
        dropped++;
      }
    }
  }
  return { ran: true, subscriptions: subs.length, sent, dropped };
}

/** For the setup card / a diag: send one test notification to a subscription. */
export async function sendTestPush(sub: { endpoint: string; p256dh: string; auth: string }): Promise<{ ok: boolean; status?: number; error?: string }> {
  const cfg = vapidConfig();
  if (!cfg) return { ok: false, error: "vapid not configured" };
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ title: "DEAD's Dashboard", body: "Alerts are on for this device.", tag: "test", url: "/", severity: "amber", at: Date.now() }),
      { TTL: 120 },
    );
    return { ok: true };
  } catch (e) {
    const err = e as { statusCode?: number; message?: string };
    return { ok: false, status: err.statusCode, error: err.message?.slice(0, 200) };
  }
}
