// Bill-sighting history (server-only).
//
// The silence watch cannot work from a single fetch: knowing that the water
// bill is late requires knowing when it usually arrives, which is memory, not
// a snapshot. Every statement we see is recorded once, keyed by its Gmail
// message id, so re-fetching the same window never double-counts a cycle or
// skews an average.

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import type { BillSighting } from "./householdSignals";

export interface SightingRow extends BillSighting {
  dueISO: string | null;
  subject: string;
}

interface Row extends RowDataPacket {
  biller_id: string;
  seen_date: string;
  amount_cents: number | null;
  due_date: string | null;
  subject: string | null;
}

export async function recordSightings(
  rows: { messageId: string; billerId: string; seenISO: string; amountCents: number | null; dueISO: string | null; subject: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const pool = await getDb();
    // Amount and due date can improve on a re-read (a better extraction), so
    // they update; seen_date is the arrival fact and never moves.
    for (const r of rows) {
      await pool.execute(
        `INSERT INTO household_bills (message_id, biller_id, seen_date, amount_cents, due_date, subject, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           amount_cents = VALUES(amount_cents),
           due_date     = VALUES(due_date),
           subject      = VALUES(subject)`,
        [r.messageId.slice(0, 80), r.billerId.slice(0, 40), r.seenISO.slice(0, 10),
         r.amountCents, r.dueISO, r.subject.slice(0, 255), Date.now()],
      );
    }
  } catch (err) {
    console.error("household bill record failed:", err);
  }
}

// Sightings for the given billers, newest first. Bounded by days so a long-
// running install doesn't drag its whole history into every request.
export async function getSightings(billerIds: string[], days = 400): Promise<SightingRow[]> {
  if (billerIds.length === 0) return [];
  try {
    const pool = await getDb();
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const [rows] = await pool.query<Row[]>(
      `SELECT biller_id, seen_date, amount_cents, due_date, subject
         FROM household_bills
        WHERE biller_id IN (?) AND seen_date >= ?
        ORDER BY seen_date DESC`,
      [billerIds, cutoff],
    );
    return rows.map((r) => ({
      billerId: r.biller_id,
      seenISO: r.seen_date,
      amountCents: r.amount_cents,
      dueISO: r.due_date,
      subject: r.subject ?? "",
    }));
  } catch (err) {
    console.error("household bill read failed:", err);
    return [];
  }
}

// Keep a little over a year so an annual cadence still has two data points.
export async function pruneHouseholdBills(): Promise<void> {
  try {
    const pool = await getDb();
    const cutoff = new Date(Date.now() - 500 * 86_400_000).toISOString().slice(0, 10);
    await pool.execute("DELETE FROM household_bills WHERE seen_date < ?", [cutoff]);
  } catch { /* best effort */ }
}
