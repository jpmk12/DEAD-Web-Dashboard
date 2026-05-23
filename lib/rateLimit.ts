// Simple in-memory rate limiter for expensive API endpoints.
// Single-user app — no Redis needed; module-level Map persists across requests within a process.

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
