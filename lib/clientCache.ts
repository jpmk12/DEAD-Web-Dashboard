// Module-level in-memory cache — persists across tab switches within a session.
// Uses stale-while-revalidate: peek() returns stale data while fresh data loads.

interface Entry<T> {
  data: T;
  ts: number;
  ttlMs: number;
}

const store = new Map<string, Entry<unknown>>();

export const clientCache = {
  /** Returns data only if it's still within its TTL. */
  get<T>(key: string): T | null {
    const e = store.get(key);
    if (!e) return null;
    if (Date.now() - e.ts > e.ttlMs) { store.delete(key); return null; }
    return e.data as T;
  },

  /** Returns data regardless of staleness — for stale-while-revalidate. */
  peek<T>(key: string): T | null {
    const e = store.get(key);
    return e ? (e.data as T) : null;
  },

  set<T>(key: string, data: T, ttlMs: number): void {
    store.set(key, { data, ts: Date.now(), ttlMs });
  },

  isFresh(key: string): boolean {
    const e = store.get(key);
    return !!e && Date.now() - e.ts <= e.ttlMs;
  },

  delete(key: string): void {
    store.delete(key);
  },

  /** Drop all entries. Used after a prefs save invalidates derived data
   *  across multiple tabs (email priorities, news sort, calendar context). */
  clear(): void {
    store.clear();
  },
};

export const CACHE_TTL = {
  NEWS:        15 * 60 * 1000, // 15 min — RSS feeds update often
  NEWSLETTERS: 30 * 60 * 1000, // 30 min — email changes less frequently
  CALENDAR:    15 * 60 * 1000, // 15 min
  EMAIL:       10 * 60 * 1000, // 10 min — most time-sensitive
  DIGEST:      30 * 60 * 1000, // 30 min — weekly digest changes slowly
} as const;
