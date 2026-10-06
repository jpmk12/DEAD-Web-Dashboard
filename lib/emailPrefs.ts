// Server-only store for the user's own calls on individual emails
// (`email_prefs`): the per-message priority override, the Keep flag, and the
// model's call at the time — which makes every override a correction for
// lib/emailLearning.ts. Also the per-message action-item cache.

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import type { EmailPriority, ActionItem } from "./types";
import type { Correction } from "./emailLearning";

const KEEP_DAYS = 90;
const ACTION_TTL_MS = 14 * 86_400_000;
const VALID = new Set<EmailPriority>(["High", "Medium", "Low"]);

export interface EmailPref {
  prioritySet: EmailPriority | null;
  priorityModel: EmailPriority | null;
  keep: boolean;
}

interface PrefRow extends RowDataPacket {
  message_id: string;
  account_email: string;
  priority_set: string | null;
  priority_model: string | null;
  keep: number;
  sender: string;
  subject: string;
  updated_at: number;
}

const asPriority = (v: unknown): EmailPriority | null => (typeof v === "string" && VALID.has(v as EmailPriority) ? (v as EmailPriority) : null);

/** Prefs for a set of messages, keyed by message id. */
export async function getEmailPrefs(userEmail: string, items: { id: string; accountEmail: string }[]): Promise<Map<string, EmailPref>> {
  const out = new Map<string, EmailPref>();
  if (!userEmail || items.length === 0) return out;
  const pool = await getDb();
  const tuples = items.map(() => "(?, ?)").join(",");
  const params: string[] = [userEmail];
  for (const it of items) params.push(it.id, it.accountEmail);
  const [rows] = await pool.query<PrefRow[]>(
    `SELECT message_id, account_email, priority_set, priority_model, keep FROM email_prefs
      WHERE user_email = ? AND (message_id, account_email) IN (${tuples})`,
    params,
  );
  for (const r of rows) out.set(r.message_id, { prioritySet: asPriority(r.priority_set), priorityModel: asPriority(r.priority_model), keep: r.keep === 1 });
  return out;
}

/** The kept message ids among `ids` on one account — the mark-read guard. */
export async function keptIds(userEmail: string, accountEmail: string, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!userEmail || !ids.length) return out;
  const pool = await getDb();
  const [rows] = await pool.query<PrefRow[]>(
    `SELECT message_id FROM email_prefs WHERE user_email = ? AND account_email = ? AND keep = 1 AND message_id IN (${ids.map(() => "?").join(",")})`,
    [userEmail, accountEmail, ...ids],
  );
  for (const r of rows) out.add(r.message_id);
  return out;
}

/**
 * Upsert one message's pref. `prioritySet` undefined = leave as is; null =
 * clear the override. `keep` undefined = leave as is. The model's priority
 * and the sender/subject are recorded on the first write and refreshed
 * when supplied, so a correction keeps the evidence it was made against.
 */
export async function setEmailPref(userEmail: string, input: {
  accountEmail: string; messageId: string;
  prioritySet?: EmailPriority | null; keep?: boolean;
  priorityModel?: EmailPriority | null; sender?: string; subject?: string;
}): Promise<void> {
  const pool = await getDb();
  const now = Date.now();
  const sets: string[] = ["updated_at = VALUES(updated_at)"];
  if (input.prioritySet !== undefined) sets.push("priority_set = VALUES(priority_set)");
  if (input.keep !== undefined) sets.push("keep = VALUES(keep)");
  if (input.priorityModel !== undefined) sets.push("priority_model = COALESCE(priority_model, VALUES(priority_model))");
  if (input.sender !== undefined) sets.push("sender = VALUES(sender)");
  if (input.subject !== undefined) sets.push("subject = VALUES(subject)");
  await pool.execute(
    `INSERT INTO email_prefs (user_email, account_email, message_id, priority_set, priority_model, keep, sender, subject, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE ${sets.join(", ")}`,
    [userEmail, input.accountEmail, input.messageId, input.prioritySet ?? null, input.priorityModel ?? null, input.keep ? 1 : 0,
     (input.sender ?? "").slice(0, 255), (input.subject ?? "").slice(0, 255), now],
  );
  pool.execute("DELETE FROM email_prefs WHERE updated_at < ? AND keep = 0", [now - KEEP_DAYS * 86_400_000]).catch(() => {});
}

/** The user's corrections (overrides with a recorded model call), newest first. */
export async function listCorrections(userEmail: string, sinceMs: number): Promise<Correction[]> {
  if (!userEmail) return [];
  const pool = await getDb();
  const [rows] = await pool.query<PrefRow[]>(
    `SELECT message_id, account_email, priority_set, priority_model, sender, subject, updated_at FROM email_prefs
      WHERE user_email = ? AND priority_set IS NOT NULL AND updated_at >= ?
      ORDER BY updated_at DESC LIMIT 400`,
    [userEmail, sinceMs],
  );
  const out: Correction[] = [];
  for (const r of rows) {
    const set = asPriority(r.priority_set);
    if (!set) continue;
    out.push({ messageId: r.message_id, accountEmail: r.account_email, prioritySet: set, priorityModel: asPriority(r.priority_model), sender: r.sender, subject: r.subject, at: Number(r.updated_at) });
  }
  return out;
}

// ---- action-item cache ------------------------------------------------------

interface ActionRow extends RowDataPacket { message_id: string; actions: unknown }

export async function getCachedActions(items: { id: string; accountEmail: string }[]): Promise<Map<string, ActionItem[]>> {
  const out = new Map<string, ActionItem[]>();
  if (!items.length) return out;
  const pool = await getDb();
  const tuples = items.map(() => "(?, ?)").join(",");
  const params: (string | number)[] = [];
  for (const it of items) params.push(it.id, it.accountEmail);
  params.push(Date.now() - ACTION_TTL_MS);
  const [rows] = await pool.query<ActionRow[]>(
    `SELECT message_id, actions FROM email_action_cache WHERE (message_id, account_email) IN (${tuples}) AND cached_at >= ?`,
    params,
  );
  for (const r of rows) out.set(r.message_id, Array.isArray(r.actions) ? (r.actions as ActionItem[]) : []);
  return out;
}

/** Store per message — an EMPTY list is stored too, so a no-action email is not re-asked. */
export async function cacheActions(rows: { id: string; accountEmail: string; actions: ActionItem[] }[]): Promise<void> {
  if (!rows.length) return;
  const pool = await getDb();
  const now = Date.now();
  const placeholders = rows.map(() => "(?, ?, CAST(? AS JSON), ?)").join(",");
  const values: (string | number)[] = [];
  for (const r of rows) values.push(r.id, r.accountEmail, JSON.stringify(r.actions), now);
  await pool.query(
    `INSERT INTO email_action_cache (message_id, account_email, actions, cached_at) VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE actions = VALUES(actions), cached_at = VALUES(cached_at)`,
    values,
  );
  pool.execute("DELETE FROM email_action_cache WHERE cached_at < ?", [now - ACTION_TTL_MS]).catch(() => {});
}
