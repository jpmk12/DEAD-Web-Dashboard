// Server-only persistence for I&W analyst annotations. All judgement lives in
// the PURE lib/annotations.ts; this file only reads and writes rows. Shared
// per problem, attributed by email — the decision-log pattern.

import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import type { Annotation } from "./annotations";

interface Row extends RowDataPacket {
  id: string;
  problem_id: string;
  indicator_id: string | null;
  note: string;
  by_email: string;
  created_at: Date;
  resolved_at: Date | null;
  resolved_by: string | null;
}

const toEntry = (r: Row): Annotation => ({
  id: r.id,
  problemId: r.problem_id,
  indicatorId: r.indicator_id,
  note: r.note,
  by: r.by_email,
  createdAt: r.created_at.toISOString(),
  resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
  resolvedBy: r.resolved_by,
});

/** Every note for a problem, newest first (the caller sorts for display).
 *  NULL when the store did not answer — a dead database is UNAVAILABLE, never
 *  "no notes" (an analyst's standing note on a known outage must not vanish
 *  silently on the day the database is down). */
export async function listAnnotations(problemId: string, limit = 60): Promise<Annotation[] | null> {
  try {
    const pool = await getDb();
    // EVERY open note, then the newest resolved ones up to the limit — an old
    // standing note must never fall off behind newer resolved ones (code
    // review 2026-10-28: a plain newest-60 dropped it).
    const [rows] = await pool.query<Row[]>(
      `(SELECT * FROM warning_annotations WHERE problem_id = ? AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 200)
       UNION ALL
       (SELECT * FROM warning_annotations WHERE problem_id = ? AND resolved_at IS NOT NULL ORDER BY created_at DESC LIMIT ?)`,
      [problemId, problemId, Math.min(200, Math.max(1, limit))],
    );
    return rows.map(toEntry);
  } catch {
    return null;
  }
}

export async function createAnnotation(input: { problemId: string; indicatorId: string | null; note: string; by: string }): Promise<Annotation | null> {
  try {
    const pool = await getDb();
    const id = randomUUID();
    const now = new Date();
    await pool.execute(
      `INSERT INTO warning_annotations (id, problem_id, indicator_id, note, by_email, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.problemId.slice(0, 64), input.indicatorId?.slice(0, 64) ?? null, input.note, input.by.slice(0, 255), now],
    );
    return { id, problemId: input.problemId, indicatorId: input.indicatorId, note: input.note, by: input.by, createdAt: now.toISOString(), resolvedAt: null, resolvedBy: null };
  } catch {
    // A failed write must be visible — the caller turns null into an error.
    return null;
  }
}

/** Resolve an OPEN note. One-way: an already-resolved note is a conflict,
 *  not an update. Any crew member may resolve (the board is shared). */
export async function resolveAnnotation(id: string, by: string): Promise<boolean> {
  try {
    const pool = await getDb();
    const [res] = await pool.execute(
      `UPDATE warning_annotations SET resolved_at = ?, resolved_by = ? WHERE id = ? AND resolved_at IS NULL`,
      [new Date(), by.slice(0, 255), id],
    );
    return (res as { affectedRows?: number }).affectedRows === 1;
  } catch {
    return false;
  }
}

/** Remove a note — only its author, and only while open. */
export async function deleteOpenAnnotation(id: string, by: string): Promise<boolean> {
  try {
    const pool = await getDb();
    const [res] = await pool.execute(
      `DELETE FROM warning_annotations WHERE id = ? AND by_email = ? AND resolved_at IS NULL`,
      [id, by],
    );
    return (res as { affectedRows?: number }).affectedRows === 1;
  } catch {
    return false;
  }
}
