import type { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { getDb } from "./db";
import { scopeClause } from "./userScope";

// Keep-in-touch / relationship cadence. A roster of important people, each with
// a check-in cadence (days). "lastContacted" is set manually (mark-contacted),
// and the app surfaces who's due/overdue. No Gmail polling — deterministic.

export interface Contact {
  id: string;
  name: string;
  email: string | null;
  cadenceDays: number;
  tier: string | null;
  lastContacted: string | null; // YYYY-MM-DD, null = never
  notes: string | null;
  createdAt: string;
}

export type ContactState = "never" | "overdue" | "due" | "soon" | "fresh";
export interface ContactStatus {
  nextDue: string | null;   // YYYY-MM-DD, null when never contacted
  daysUntil: number | null; // next_due − today (negative = overdue); null when never
  state: ContactState;
}

const SOON_DAYS = 7;

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (isNaN(d.getTime())) return ymd;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

// Pure — unit-tested. Never-contacted is the most urgent (you've added them but
// haven't reached out yet).
export function contactStatus(c: Pick<Contact, "lastContacted" | "cadenceDays">, today: string): ContactStatus {
  if (!c.lastContacted) return { nextDue: null, daysUntil: null, state: "never" };
  const nextDue = addDays(c.lastContacted, Math.max(1, c.cadenceDays));
  const daysUntil = dayDiff(today, nextDue);
  const state: ContactState = daysUntil < 0 ? "overdue" : daysUntil === 0 ? "due" : daysUntil <= SOON_DAYS ? "soon" : "fresh";
  return { nextDue, daysUntil, state };
}

// Roster ordered by urgency: never first, then most-overdue, then soonest.
// Pure — unit-tested.
export function sortByDue<T extends Pick<Contact, "lastContacted" | "cadenceDays" | "name">>(contacts: T[], today: string): T[] {
  const rank = (c: T): number => {
    const s = contactStatus(c, today);
    if (s.state === "never") return -1e9;        // most urgent
    return s.daysUntil ?? 0;                       // ascending: overdue (neg) → fresh (pos)
  };
  return [...contacts].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

interface ContactRow extends RowDataPacket {
  id: string; name: string; email: string | null; cadence_days: number;
  tier: string | null; last_contacted: string | null; notes: string | null; created_at: Date;
}
function rowToContact(r: ContactRow): Contact {
  return {
    id: r.id, name: r.name, email: r.email, cadenceDays: r.cadence_days,
    tier: r.tier, lastContacted: r.last_contacted, notes: r.notes,
    createdAt: r.created_at.toISOString(),
  };
}

export async function listContacts(userEmail: string): Promise<Contact[]> {
  const pool = await getDb();
  const sc = scopeClause(userEmail);
  const [rows] = await pool.query<ContactRow[]>(
    `SELECT id, name, email, cadence_days, tier, last_contacted, notes, created_at FROM contacts WHERE ${sc.clause} ORDER BY name`,
    sc.params,
  );
  return rows.map(rowToContact);
}

export async function createContact(userEmail: string, c: {
  name: string; email?: string | null; cadenceDays?: number; tier?: string | null; notes?: string | null;
}): Promise<Contact> {
  const pool = await getDb();
  const id = randomUUID();
  const cadenceDays = Number.isFinite(c.cadenceDays) ? Math.min(3650, Math.max(1, c.cadenceDays!)) : 90;
  const now = new Date();
  await pool.execute(
    "INSERT INTO contacts (id, user_email, name, email, cadence_days, tier, last_contacted, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)",
    [id, userEmail, c.name, c.email ?? null, cadenceDays, c.tier ?? null, c.notes ?? null, now],
  );
  return { id, name: c.name, email: c.email ?? null, cadenceDays, tier: c.tier ?? null, lastContacted: null, notes: c.notes ?? null, createdAt: now.toISOString() };
}

// Partial edit. Only the provided fields change; markContacted sets the date.
export async function updateContact(userEmail: string, id: string, patch: {
  name?: string; email?: string | null; cadenceDays?: number; tier?: string | null; notes?: string | null; lastContacted?: string | null;
}): Promise<void> {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.name !== undefined) { sets.push("name = ?"); vals.push(patch.name); }
  if (patch.email !== undefined) { sets.push("email = ?"); vals.push(patch.email); }
  if (patch.cadenceDays !== undefined) { sets.push("cadence_days = ?"); vals.push(Math.min(3650, Math.max(1, patch.cadenceDays))); }
  if (patch.tier !== undefined) { sets.push("tier = ?"); vals.push(patch.tier); }
  if (patch.notes !== undefined) { sets.push("notes = ?"); vals.push(patch.notes); }
  if (patch.lastContacted !== undefined) { sets.push("last_contacted = ?"); vals.push(patch.lastContacted); }
  if (sets.length === 0) return;
  const pool = await getDb();
  const sc = scopeClause(userEmail);
  await pool.execute(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ? AND ${sc.clause}`, [...vals, id, ...sc.params]);
}

export async function deleteContact(userEmail: string, id: string): Promise<void> {
  const pool = await getDb();
  const sc = scopeClause(userEmail);
  await pool.execute(`DELETE FROM contacts WHERE id = ? AND ${sc.clause}`, [id, ...sc.params]);
}
