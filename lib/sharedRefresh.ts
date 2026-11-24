// One Google token refresh per refresh token, shared by every request that
// needs it (2026-11-24, the load-time review).
//
// Why: the access token lives an hour; the session cookie 30 days. The first
// page load after the hour fires ~50 API requests at once, and each one runs
// the NextAuth `jwt` callback with the SAME expired token — before this, each
// made its own call to Google's token endpoint, in parallel, before doing its
// own work. Route handlers cannot rewrite the session cookie, so the refreshed
// token was not even kept: every request kept refreshing until the client's
// /api/auth/session call happened to write the cookie.
//
// `createSharedRefresher(fn)` returns `refresh(key)`: concurrent callers with
// the same key share ONE in-flight call, and a success is reused until
// `marginMs` before it expires (so requests still carrying the old cookie get
// the already-refreshed token). A failure is never cached — the next caller
// tries again. Entries past their expiry are pruned on each call.

export interface RefreshResult {
  accessToken: string;
  accessTokenExpires: number;
  refreshToken: string;
}

export function createSharedRefresher(
  fn: (key: string) => Promise<RefreshResult>,
  opts: { marginMs?: number; now?: () => number; maxEntries?: number } = {},
) {
  const marginMs = opts.marginMs ?? 5 * 60 * 1000;
  const now = opts.now ?? Date.now;
  const maxEntries = opts.maxEntries ?? 64;
  const inflight = new Map<string, Promise<RefreshResult>>();
  const done = new Map<string, RefreshResult>();

  function prune(t: number) {
    for (const [k, v] of done) if (v.accessTokenExpires - marginMs <= t) done.delete(k);
    while (done.size > maxEntries) done.delete(done.keys().next().value as string);
  }

  return function refresh(key: string): Promise<RefreshResult> {
    const t = now();
    prune(t);
    const hit = done.get(key);
    if (hit && hit.accessTokenExpires - marginMs > t) return Promise.resolve(hit);
    const running = inflight.get(key);
    if (running) return running;
    const p = fn(key)
      .then((r) => { done.set(key, r); return r; })
      .finally(() => { inflight.delete(key); });
    inflight.set(key, p);
    return p;
  };
}
