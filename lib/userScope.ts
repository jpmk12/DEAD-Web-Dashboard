import { isOwner } from "./allowlist";

// The owner-legacy scoping rule, consolidated in ONE place (pre-go-live
// cleanup). Pre-multi-user rows carry user_email = '' and are honoured as the
// OWNER's legacy rows: reads prefer the exact-email row and fall back to ''
// only for the owner. PURE apart from the env read inside isOwner — imports
// from ./allowlist, NEVER ./currentUser (which pulls next-auth and breaks
// vitest collection).

// SQL WHERE fragment for reads/mutations scoped to one user.
export function scopeClause(email: string): { clause: string; params: string[] } {
  return isOwner(email)
    ? { clause: "user_email IN (?, '')", params: [email] }
    : { clause: "user_email = ?", params: [email] };
}

// Row picker for queries that already fetched `user_email IN (?, '')`:
// the exact-email row wins; the '' legacy row counts only for the owner.
export function pickUserRow<T extends { user_email: string }>(
  rows: T[],
  email: string,
): T | undefined {
  return rows.find((r) => r.user_email === email)
    ?? (isOwner(email) ? rows.find((r) => r.user_email === "") : undefined);
}
