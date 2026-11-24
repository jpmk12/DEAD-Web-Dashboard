// One request for a JSON GET that several components ask for at once
// (2026-11-24, the load-time review: at page load `/api/user-prefs` was
// fetched by four components, `/api/ui-state` by four, `/api/demand-horizon`
// by two — each a separate round trip that re-ran auth and the DB reads).
//
// `sharedGet(url)` gives every caller within `reuseMs` of a request the same
// promise; the reuse window is short on purpose — it coalesces the burst at
// mount, never serves a stale read later. `{ fresh: true }` always starts a
// new request (after a write, or on a "changed" event) and the next plain
// callers share THAT one. A non-OK reply resolves `{ ok: false, status }`
// with a null body; a network error resolves the same with status 0 — never
// a rejection, so a caller's `.then` chain reads the shape it always did.

export interface SharedReply<T> { ok: boolean; status: number; body: T | null }

const entries = new Map<string, { at: number; p: Promise<SharedReply<unknown>> }>();

export function sharedGet<T = unknown>(url: string, opts: { fresh?: boolean; reuseMs?: number } = {}): Promise<SharedReply<T>> {
  const reuseMs = opts.reuseMs ?? 5_000;
  const hit = entries.get(url);
  if (!opts.fresh && hit && Date.now() - hit.at < reuseMs) return hit.p as Promise<SharedReply<T>>;
  const p: Promise<SharedReply<unknown>> = fetch(url)
    .then(async (r) => ({ ok: r.ok, status: r.status, body: (await r.json().catch(() => null)) as unknown }))
    .catch(() => ({ ok: false, status: 0, body: null }));
  entries.set(url, { at: Date.now(), p });
  return p as Promise<SharedReply<T>>;
}

/** Forget a URL so the next caller asks the server (after a write). */
export function forgetShared(url: string): void { entries.delete(url); }
