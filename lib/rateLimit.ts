// Simple in-memory rate limiter for expensive API endpoints. Module-level Map
// persists across requests within a process (no Redis needed at this scale).
// MULTI-USER: personal-action routes MUST scope the key per user
// (e.g. `chat:${email}`) so one crew member's action never rate-limits
// another's. Only genuinely shared/team routes that gate a single shared cache
// (news_overview, markets_brief, osint_situation, threads) keep a global key.

const lastCall = new Map<string, number>();

// Returns true if the request is allowed, false if it should be rate-limited.
// `minIntervalMs` is the minimum milliseconds between allowed calls.
export function checkRateLimit(endpoint: string, minIntervalMs: number): boolean {
  const now = Date.now();
  const last = lastCall.get(endpoint) ?? 0;
  if (now - last < minIntervalMs) return false;
  lastCall.set(endpoint, now);
  return true;
}
