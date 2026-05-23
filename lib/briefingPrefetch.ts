// Module-level store for background brief generation.
// prefetchBriefing() fires once articles+newsletters are loaded and keeps
// the result in clientCache so BriefingModal can display it instantly.

import { clientCache, CACHE_TTL } from "./clientCache";

export const CACHE_KEY = "briefing:result";

let inflight: Promise<void> | null = null;

export function prefetchBriefing(
  articles: unknown[],
  newsletters: unknown[],
  events: unknown[],
): void {
  if (articles.length === 0) return;
  if (clientCache.isFresh(CACHE_KEY)) return;
  if (inflight) return;

  inflight = fetch("/api/briefing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ articles, newsletters, events }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (!data.error) {
        clientCache.set(CACHE_KEY, data.briefing, CACHE_TTL.NEWS);
      }
    })
    .catch(() => {})
    .finally(() => { inflight = null; });
}

export function getInflight(): Promise<void> | null {
  return inflight;
}
