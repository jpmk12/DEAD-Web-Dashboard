// Module-level store for background weekly-digest generation.
// prefetchDigest() fires on app mount and keeps the result in clientCache
// so the digest modal opens instantly. Mirrors briefingPrefetch.ts.

import { clientCache, CACHE_TTL } from "./clientCache";

// Bumped to :v2 when the server-side field caps grew (commit Reading Patterns
// fix). Pre-fix cached values had truncated text; the version suffix makes
// every client read a fresh value once the new build deploys.
export const CACHE_KEY = "digest:result:v2";

let inflight: Promise<void> | null = null;

export function prefetchDigest(): void {
  if (clientCache.isFresh(CACHE_KEY)) return;
  if (inflight) return;

  inflight = fetch("/api/digest", { method: "GET" })
    .then((r) => r.json())
    .then((data) => {
      if (!data.error && data.digest) {
        clientCache.set(CACHE_KEY, data.digest, CACHE_TTL.DIGEST);
      }
    })
    .catch(() => {})
    .finally(() => { inflight = null; });
}

export function getInflight(): Promise<void> | null {
  return inflight;
}
