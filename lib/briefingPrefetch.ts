// Module-level store for background brief generation.
// prefetchBriefing() fires once articles+newsletters are loaded and keeps
// the result in clientCache so BriefingModal can display it instantly.
//
// The thin-brief bug (2026-09-30): the brief is day-cached, so WHATEVER
// inputs the first POST carries are the day's brief. After the August spend
// cut the OSINT feed stopped loading in the background, and newsletters
// often land after the first articles — so the first POST went out with no
// OSINT signals and no newsletter bullets, the model wrote a short brief,
// and it was cached for the day. TabShell now gates the first POST on every
// input reporting (or a grace timer), and this module allows ONE bounded
// upgrade: if the brief it holds was generated with zero newsletters or zero
// OSINT signals and those have since arrived, it asks once more. The server
// applies the same rule (`shouldUpgradeBrief`), so a re-ask never spends
// unless it really adds a section, and never more than once a day.

import { clientCache, CACHE_TTL } from "./clientCache";
import { shouldUpgradeBrief, generationsOf, MAX_GENERATIONS, type BriefInputs, type BriefUpgradeRecord } from "./briefingUpgrade";

export const CACHE_KEY = "briefing:result";

let inflight: Promise<void> | null = null;
/** What the brief now in clientCache was generated (or served) from — its
 *  inputs, its generation count and whether it has any sections — so the
 *  SAME rule the server applies can decide whether a re-ask would spend. */
let lastBrief: BriefUpgradeRecord | null = null;
/** Re-asks this page has made; together with the server's generation count
 *  this keeps the client from asking past MAX_GENERATIONS. */
let reasksThisSession = 0;
/** The server rate-limits generation to one per 15 s per user; an upgrade
 *  re-ask arriving inside that window would 429 and be lost. */
const UPGRADE_GAP_MS = 16_000;
let lastPostAt = 0;
let upgradeTimer: ReturnType<typeof setTimeout> | null = null;

export function prefetchBriefing(
  articles: unknown[],
  newsletters: unknown[],
  events: unknown[],
  osint: unknown[] = [],
): void {
  if (articles.length === 0) return;
  const inputs: BriefInputs = { articles: articles.length, newsletters: newsletters.length, osint: osint.length, events: events.length };

  if (clientCache.isFresh(CACHE_KEY)) {
    // Held brief is thin and the missing inputs are here now: a bounded
    // re-ask, spaced past the server's rate limit. The server applies the
    // same rule, so a re-ask it disagrees with costs one cached read.
    const canReask = lastBrief
      && generationsOf(lastBrief) + reasksThisSession < MAX_GENERATIONS
      && shouldUpgradeBrief(lastBrief, inputs);
    if (canReask && !upgradeTimer) {
      const wait = Math.max(0, UPGRADE_GAP_MS - (Date.now() - lastPostAt));
      upgradeTimer = setTimeout(() => {
        upgradeTimer = null;
        reasksThisSession += 1;
        post(articles, newsletters, events, osint, inputs);
      }, wait);
    }
    return;
  }
  if (inflight) return;
  post(articles, newsletters, events, osint, inputs);
}

function post(articles: unknown[], newsletters: unknown[], events: unknown[], osint: unknown[], inputs: BriefInputs): void {
  // Device IANA zone so the brief's "today"/schedule/weather match the device
  // the user is reading on; the server resolves request → saved pref → default.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  lastPostAt = Date.now();

  inflight = fetch("/api/briefing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ articles, newsletters, events, osint, tz }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (!data.error) {
        clientCache.set(CACHE_KEY, data.briefing, CACHE_TTL.NEWS);
        // Prefer the server's own record of what the brief was built from
        // (a cached brief from another device carries its inputs); else ours.
        const b = (data.briefing ?? {}) as BriefUpgradeRecord;
        lastBrief = { ...b, inputs: b.inputs ?? inputs };
      }
    })
    .catch(() => {})
    .finally(() => { inflight = null; });
}

export function getInflight(): Promise<void> | null {
  return inflight;
}
