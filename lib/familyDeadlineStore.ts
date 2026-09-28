// Server-only persistence for family deadlines. All judgement lives in the
// PURE lib/familyDeadlines.ts; this file only reads and writes rows.
//
// Scoped by user_email even though the Family tab is owner-only today: the
// rows name the user's children, and retrofitting a key onto a table that
// already holds that is worse than carrying one from the start (phase 1 of the
// crew split had to rebuild four primary keys to do exactly this).

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import type { DeadlineState, StoredDeadline } from "./familyDeadlines";

interface Row extends RowDataPacket {
  id: string;
  title: string;
  detail: string | null;
  due_iso: string | null;
  person_id: string | null;
  source_id: string;
  buried: number;
  first_seen: Date;
  last_seen: Date;
  state: string;
  state_at: Date | null;
}

const toStored = (r: Row): StoredDeadline => ({
  id: r.id,
  title: r.title,
  detail: r.detail ?? "",
  dueISO: r.due_iso,
  personId: r.person_id,
  sourceId: r.source_id,
  buried: r.buried === 1,
  firstSeen: r.first_seen.toISOString(),
  lastSeen: r.last_seen.toISOString(),
  state: (r.state as DeadlineState) ?? "open",
  stateAt: r.state_at ? r.state_at.toISOString() : null,
});

/** Everything we hold for this user. The pane decides what to show — a done
 *  deadline is still part of the record this feature exists to accumulate. */
export async function listDeadlines(userEmail: string, limit = 300): Promise<StoredDeadline[]> {
  try {
    const pool = await getDb();
    const [rows] = await pool.query<Row[]>(
      `SELECT * FROM family_deadlines WHERE user_email = ? ORDER BY first_seen DESC LIMIT ?`,
      [userEmail, Math.min(500, Math.max(1, limit))],
    );
    return rows.map(toStored);
  } catch {
    // Best-effort: no store is "no stored deadlines", which degrades the pane
    // to the live extraction rather than to an error.
    return [];
  }
}

/**
 * Upsert what a fresh extraction produced.
 *
 * The UPDATE clause deliberately does NOT touch `state`, `state_at` or
 * `first_seen` — those belong to the user's handling and to history, not to
 * the extractor. It also coalesces `due_iso` so a re-read that lost the date
 * cannot erase one we already had.
 */
export async function upsertDeadlines(userEmail: string, rows: StoredDeadline[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const pool = await getDb();
    const placeholders: string[] = [];
    const values: (string | number | Date | null)[] = [];
    for (const d of rows) {
      placeholders.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      values.push(
        d.id, userEmail, d.title, d.detail || null, d.dueISO, d.personId, d.sourceId,
        d.buried ? 1 : 0, new Date(d.firstSeen), new Date(d.lastSeen),
        d.state, d.stateAt ? new Date(d.stateAt) : null,
      );
    }
    await pool.execute(
      `INSERT INTO family_deadlines
         (id, user_email, title, detail, due_iso, person_id, source_id, buried, first_seen, last_seen, state, state_at)
       VALUES ${placeholders.join(", ")}
       ON DUPLICATE KEY UPDATE
         title    = VALUES(title),
         detail   = VALUES(detail),
         due_iso  = COALESCE(family_deadlines.due_iso, VALUES(due_iso)),
         buried   = VALUES(buried),
         last_seen = VALUES(last_seen)`,
      values,
    );
  } catch {
    /* best-effort — a persistence failure must never break the digest */
  }
}

/** Record the user's handling. Returns false when the row is not theirs. */
export async function setDeadlineState(
  userEmail: string, id: string, state: DeadlineState,
): Promise<boolean> {
  try {
    const pool = await getDb();
    const [res] = await pool.execute(
      `UPDATE family_deadlines SET state = ?, state_at = ? WHERE id = ? AND user_email = ?`,
      [state, state === "open" ? null : new Date(), id, userEmail],
    );
    return (res as { affectedRows?: number }).affectedRows === 1;
  } catch {
    return false;
  }
}

/** Drop handled rows older than `days`. Lapsed OPEN rows are never pruned —
 *  they stay until the user clears them, which is the whole point. */
export async function pruneHandledDeadlines(userEmail: string, days = 180): Promise<void> {
  try {
    const pool = await getDb();
    await pool.execute(
      `DELETE FROM family_deadlines
        WHERE user_email = ? AND state <> 'open' AND state_at IS NOT NULL AND state_at < ?`,
      [userEmail, new Date(Date.now() - days * 86_400_000)],
    );
  } catch {
    /* best-effort */
  }
}
