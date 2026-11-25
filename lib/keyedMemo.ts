// A small keyed memo for server reads that several requests make at once
// (2026-11-25, the load-time review: `/api/calendar` had no cache and the
// calendar-trip sync read the same calendars again on the same page load).
//
// `memo.get(key, fn)`: a value younger than `ttlMs` is returned as is;
// concurrent callers with one key share ONE in-flight call; a failure is
// never cached (the next caller tries again). `forget(key)` drops one entry,
// `forget()` drops all — a write calls it so the next read is fresh.
// PURE apart from the injected clock; tested in tests/keyedMemo.test.ts.

export function createKeyedMemo<T>(ttlMs: number, opts: { now?: () => number; maxEntries?: number } = {}) {
  const now = opts.now ?? Date.now;
  const maxEntries = opts.maxEntries ?? 128;
  const done = new Map<string, { at: number; value: T }>();
  const inflight = new Map<string, Promise<T>>();
  let generation = 0;

  return {
    get(key: string, fn: () => Promise<T>): Promise<T> {
      const t = now();
      const hit = done.get(key);
      if (hit && t - hit.at < ttlMs) return Promise.resolve(hit.value);
      const running = inflight.get(key);
      if (running) return running;
      const gen = generation;
      const p = fn()
        .then((value) => {
          // A write that landed while this read was in flight wins: the
          // read is returned to its callers but not kept.
          if (gen === generation) {
            done.set(key, { at: now(), value });
            while (done.size > maxEntries) done.delete(done.keys().next().value as string);
          }
          return value;
        })
        .finally(() => { inflight.delete(key); });
      inflight.set(key, p);
      return p;
    },
    forget(key?: string): void {
      generation++;
      if (key === undefined) { done.clear(); inflight.clear(); return; }
      done.delete(key);
      inflight.delete(key);
    },
  };
}
