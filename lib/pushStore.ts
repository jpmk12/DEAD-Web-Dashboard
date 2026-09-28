// Web-push subscriptions — server-only.
//
// One row per browser/device endpoint, owned by the user who enabled it. The
// row also carries that device's seen-set (which alert ids it has already been
// told about), because the alert check keeps no watermark and a push goes to a
// device that is not asking. Keys (p256dh/auth) are the browser's, not ours —
// they authorise us to encrypt TO that device and nothing else.

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";

export interface PushSubscriptionRow {
  endpoint: string;
  userEmail: string;
  p256dh: string;
  auth: string;
  label: string;
  seen: string[];
  createdAt: string;
  lastPushAt: string | null;
}

interface Row extends RowDataPacket {
  endpoint: string; user_email: string; p256dh: string; auth: string; label: string;
  seen_ids: unknown; created_at: Date; last_push_at: Date | null;
}

const parseSeen = (v: unknown): string[] => {
  const raw = typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, 400) : [];
};

const toRow = (r: Row): PushSubscriptionRow => ({
  endpoint: r.endpoint, userEmail: r.user_email, p256dh: r.p256dh, auth: r.auth, label: r.label,
  seen: parseSeen(r.seen_ids), createdAt: r.created_at.toISOString(),
  lastPushAt: r.last_push_at ? r.last_push_at.toISOString() : null,
});

export async function saveSubscription(input: { endpoint: string; p256dh: string; auth: string; userEmail: string; label?: string }): Promise<void> {
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO push_subscriptions (endpoint, user_email, p256dh, auth, label, seen_ids, created_at)
       VALUES (?, ?, ?, ?, ?, JSON_ARRAY(), NOW(3))
     ON DUPLICATE KEY UPDATE user_email = VALUES(user_email), p256dh = VALUES(p256dh), auth = VALUES(auth), label = VALUES(label)`,
    [input.endpoint.slice(0, 1024), input.userEmail, input.p256dh.slice(0, 256), input.auth.slice(0, 128), (input.label ?? "").slice(0, 80)],
  );
}

export async function deleteSubscription(endpoint: string, userEmail?: string): Promise<void> {
  const pool = await getDb();
  if (userEmail) await pool.execute("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_email = ?", [endpoint, userEmail]);
  else await pool.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", [endpoint]);
}

export async function listSubscriptions(userEmail?: string): Promise<PushSubscriptionRow[]> {
  const pool = await getDb();
  const [rows] = userEmail
    ? await pool.query<Row[]>("SELECT * FROM push_subscriptions WHERE user_email = ? ORDER BY created_at DESC", [userEmail])
    : await pool.query<Row[]>("SELECT * FROM push_subscriptions ORDER BY created_at DESC");
  return rows.map(toRow);
}

export async function countSubscriptions(userEmail: string): Promise<number> {
  const pool = await getDb();
  const [rows] = await pool.query<(RowDataPacket & { n: number })[]>(
    "SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_email = ?", [userEmail],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function markPushed(endpoint: string, seen: string[]): Promise<void> {
  const pool = await getDb();
  await pool.execute("UPDATE push_subscriptions SET seen_ids = ?, last_push_at = NOW(3) WHERE endpoint = ?", [JSON.stringify(seen), endpoint]);
}

/** Seen-set refresh without a push (nothing new, but the current set moved). */
export async function setSeen(endpoint: string, seen: string[]): Promise<void> {
  const pool = await getDb();
  await pool.execute("UPDATE push_subscriptions SET seen_ids = ? WHERE endpoint = ?", [JSON.stringify(seen), endpoint]);
}
