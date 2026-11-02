// What a failed Gmail call was, in a sentence safe to show — PURE, tested
// (tests/gmailErrors.test.ts). googleapis errors carry `code` / `status` and
// `errors[].reason`; Gmail answers a per-user rate limit as 429 OR as 403 with
// reason rateLimitExceeded / userRateLimitExceeded, so the reason decides.
// Only the class and Gmail's reason word are repeated — never the message,
// which can carry request ids.

export type GmailFailureClass = "rate" | "auth" | "other";

export interface GmailFailure { cls: GmailFailureClass; reason: string }

const RATE_REASONS = /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|concurrentLimitExceeded/i;

export function gmailFailure(err: unknown): GmailFailure {
  const e = (err ?? {}) as { code?: unknown; status?: unknown; errors?: unknown; response?: { status?: unknown; data?: { error?: { errors?: unknown } } } };
  const status = Number(e.code ?? e.status ?? e.response?.status ?? NaN);
  const list = (Array.isArray(e.errors) ? e.errors : Array.isArray(e.response?.data?.error?.errors) ? e.response!.data!.error!.errors as unknown[] : []) as { reason?: unknown }[];
  const reason = list.map((x) => (typeof x?.reason === "string" ? x.reason : "")).find(Boolean) ?? "";
  if (status === 429 || RATE_REASONS.test(reason)) return { cls: "rate", reason: "Gmail rate limit — retried once, still refused" };
  if (status === 401 || (status === 403 && /auth|permission|scope|forbidden/i.test(reason || "forbidden"))) {
    return { cls: "auth", reason: `Gmail refused the account (${Number.isFinite(status) ? status : "auth"}${reason ? ` ${reason}` : ""}) — sign in again` };
  }
  return { cls: "other", reason: Number.isFinite(status) ? `Gmail error ${status}${reason ? ` ${reason}` : ""}` : "Gmail unreachable" };
}

export function isGmailRateLimit(err: unknown): boolean {
  return gmailFailure(err).cls === "rate";
}
