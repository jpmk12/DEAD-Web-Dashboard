// Name a MySQL write failure in words safe to show the user — PURE.
//
// Every store route used to answer "database unavailable" for ANY throw
// from the driver, which is right for a refused connection and wrong for
// everything else: the UKMTO capture of 2026-10-26 was refused by
// `ER_DATA_TOO_LONG` on one column (a value longer than its VARCHAR) and
// the extension reported the database as down while it answered every
// other query fine. The distinction decides what the user does next —
// wait, or send the row shape to be fixed — so the reply must carry it.
//
// The raw driver message can carry hosts and request ids; only the error
// CODE and, for the row-shape class, the column or table the server named
// are repeated. Everything else stays in the server log.

export interface DbFailure {
  /** `unavailable` — the server could not be reached or refused the session;
   *  `rejected` — the server answered and refused the row (too long, null in
   *  a NOT NULL column, a missing table or column); `unknown` — anything else. */
  kind: "unavailable" | "rejected" | "unknown";
  /** The driver's error code when it has one (`ER_DATA_TOO_LONG`, `ECONNREFUSED`). */
  code: string | null;
  /** One short sentence for the reply. */
  text: string;
}

const UNAVAILABLE = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENOTFOUND", "EPIPE", "PROTOCOL_CONNECTION_LOST",
  "ER_ACCESS_DENIED_ERROR", "ER_CON_COUNT_ERROR", "ER_TOO_MANY_USER_CONNECTIONS", "PROTOCOL_SEQUENCE_TIMEOUT",
]);

/** The column or table MySQL named, e.g. "Data too long for column 'incident_at' at row 1" → "column 'incident_at'". */
function subjectIn(message: string): string | null {
  const col = /column '([^']{1,64})'/i.exec(message);
  if (col) return `column '${col[1]}'`;
  const tbl = /table '([^']{1,128})'/i.exec(message);
  if (tbl) return `table '${tbl[1].replace(/^[^.]*\./, "")}'`;
  return null;
}

export function describeDbError(err: unknown): DbFailure {
  const e = err as { code?: unknown; sqlMessage?: unknown; message?: unknown } | null;
  const code = typeof e?.code === "string" && e.code ? e.code : null;
  const message = typeof e?.sqlMessage === "string" ? e.sqlMessage : typeof e?.message === "string" ? e.message : "";
  if (code && UNAVAILABLE.has(code)) return { kind: "unavailable", code, text: `database unavailable (${code})` };
  if (code === "ER_DATA_TOO_LONG" || code === "WARN_DATA_TRUNCATED") {
    const s = subjectIn(message);
    return { kind: "rejected", code, text: `the database refused the row — a value is too long for ${s ?? "a column"} (${code})` };
  }
  if (code === "ER_BAD_NULL_ERROR" || code === "ER_NO_DEFAULT_FOR_FIELD") {
    const s = subjectIn(message);
    return { kind: "rejected", code, text: `the database refused the row — ${s ?? "a required column"} cannot be empty (${code})` };
  }
  if (code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR") {
    const s = subjectIn(message);
    return { kind: "rejected", code, text: `the database has no ${s ?? (code === "ER_NO_SUCH_TABLE" ? "such table" : "such column")} — the schema did not initialise (${code})` };
  }
  if (code === "ER_LOCK_WAIT_TIMEOUT" || code === "ER_LOCK_DEADLOCK") return { kind: "unavailable", code, text: `the database is busy — try again (${code})` };
  if (code) return { kind: "unknown", code, text: `database error (${code})` };
  return { kind: "unknown", code: null, text: "database error" };
}
