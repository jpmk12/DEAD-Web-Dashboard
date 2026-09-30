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
import { shouldUpgradeBrief, type BriefInputs } from "./briefingUpgrade";

export const CACHE_KEY = "briefing:result";

let inflight: Promise<void> | null = null;
/** The inputs the brief now in clientCache was generated (or served) with. */
let lastInputs: BriefInputs | null = null;
let upgradedThisSession = false;
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
    // Held brief is thin and the missing inputs are here now: one re-ask,
    // spaced past the server's rate limit.
    if (!upgradedThisSession && lastInputs && shouldUpgradeBrief({ inputs: lastInputs }, inputs) && !upgradeTimer) {
      const wait = Math.max(0, UPGRADE_GAP_MS - (Date.now() - lastPostAt));
      upgradeTimer = setTimeout(() => {
        upgradeTimer = null;
        upgradedThisSession = true;
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
        const b = data.briefing as { inputs?: BriefInputs } | undefined;
        lastInputs = b?.inputs ?? inputs;
        if (b && (b as { upgraded?: boolean }).upgraded) upgradedThisSession = true;
      }
    })
    .catch(() => {})
    .finally(() => { inflight = null; });
}

export function getInflight(): Promise<void> | null {
  return inflight;
}
