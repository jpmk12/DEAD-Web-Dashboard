// Server-only persistence for the I&W decision log. All judgement lives in the
// PURE lib/decisionLog.ts; this file only reads and writes rows.
//
// SHARED per problem, attributed by email — the crew maintains one board, the
// same call as `sitrep_limfacs`. A decision log that were private per user
// would fragment the record the board exists to accumulate.

import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { dueAtFor, type DecisionCall, type DecisionEntry, type DecisionOutcome } from "./decisionLog";

interface Row extends RowDataPacket {
  id: string;
  problem_id: string;
  indicator_id: string | null;
  call_kind: string;
  expectation: string;
  horizon_days: number;
  created_at: Date;
  due_at: Date;
  outcome: string | null;
  scored_at: Date | null;
  score_note: string | null;
  by_email: string;
}

const toEntry = (r: Row): DecisionEntry => ({
  id: r.id,
  problemId: r.problem_id,
  indicatorId: r.indicator_id,
  call: r.call_kind as DecisionCall,
  expectation: r.expectation,
  horizonDays: r.horizon_days,
  createdAt: r.created_at.toISOString(),
  dueAt: r.due_at.toISOString(),
  outcome: (r.outcome as DecisionOutcome | null) ?? null,
  scoredAt: r.scored_at ? r.scored_at.toISOString() : null,
  scoreNote: r.score_note,
  by: r.by_email,
});

/** Every entry for a problem, newest first. The caller orders for display via
 *  `sortForDisplay` — ordering is a presentation decision, not a query one. */
export async function listDecisions(problemId: string, limit = 60): Promise<DecisionEntry[]> {
  try {
    const pool = await getDb();
    const [rows] = await pool.query<Row[]>(
      `SELECT * FROM warning_decisions WHERE problem_id = ? ORDER BY created_at DESC LIMIT ?`,
      [problemId, Math.min(200, Math.max(1, limit))],
    );
    return rows.map(toEntry);
  } catch {
    // Best-effort like every other history read here: no log is "no log", which
    // the UI renders as an empty panel rather than an error.
    return [];
  }
}

/** Open entries past their horizon, across ALL problems — powers the "you owe
 *  this board a score" prompt without fetching every problem's full history. */
export async function listDueDecisions(limit = 20): Promise<DecisionEntry[]> {
  try {
    const pool = await getDb();
    const [rows] = await pool.query<Row[]>(
      `SELECT * FROM warning_decisions
         WHERE outcome IS NULL AND due_at <= ?
         ORDER BY due_at ASC LIMIT ?`,
      [new Date(), Math.min(100, Math.max(1, limit))],
    );
    return rows.map(toEntry);
  } catch {
    return [];
  }
}

export async function createDecision(input: {
  problemId: string;
  indicatorId: string | null;
  call: DecisionCall;
  expectation: string;
  horizonDays: number;
  by: string;
}): Promise<DecisionEntry | null> {
  try {
    const pool = await getDb();
    const id = randomUUID();
    const now = new Date();
    const due = new Date(dueAtFor(input.horizonDays, now.getTime()));
    await pool.execute(
      `INSERT INTO warning_decisions
         (id, problem_id, indicator_id, call_kind, expectation, horizon_days, created_at, due_at, by_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.problemId.slice(0, 64), input.indicatorId?.slice(0, 64) ?? null, input.call,
       input.expectation, input.horizonDays, now, due, input.by.slice(0, 255)],
    );
    return {
      id, problemId: input.problemId, indicatorId: input.indicatorId, call: input.call,
      expectation: input.expectation, horizonDays: input.horizonDays,
      createdAt: now.toISOString(), dueAt: due.toISOString(),
      outcome: null, scoredAt: null, scoreNote: null, by: input.by,
    };
  } catch {
    // A failed write must be visible — the caller turns null into an error the
    // user sees, rather than a row that silently never existed.
    return null;
  }
}

/** Score an OPEN entry. Deliberately refuses to overwrite an existing outcome:
 *  the value of this log is that it records what you thought at the time, and a
 *  re-scoreable entry is one you can quietly make yourself right about. */
export async function scoreDecision(
  id: string, outcome: DecisionOutcome, note: string | null,
): Promise<boolean> {
  try {
    const pool = await getDb();
    const [res] = await pool.execute(
      `UPDATE warning_decisions
          SET outcome = ?, scored_at = ?, score_note = ?
        WHERE id = ? AND outcome IS NULL`,
      [outcome, new Date(), note?.slice(0, 400) ?? null, id],
    );
    return (res as { affectedRows?: number }).affectedRows === 1;
  } catch {
    return false;
  }
}

/** Remove an entry. Only its author may call this (enforced at the route) —
 *  and only while OPEN, for the same reason scoring is one-way. */
export async function deleteOpenDecision(id: string, by: string): Promise<boolean> {
  try {
    const pool = await getDb();
    const [res] = await pool.execute(
      `DELETE FROM warning_decisions WHERE id = ? AND by_email = ? AND outcome IS NULL`,
      [id, by],
    );
    return (res as { affectedRows?: number }).affectedRows === 1;
  } catch {
    return false;
  }
}
