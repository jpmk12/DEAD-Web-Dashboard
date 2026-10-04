// PURE, client-safe: the rules that let a day-cached morning brief be
// regenerated — bounded — when it was built before its inputs had landed.
// Shared by the client prefetch (decides whether to re-ask) and the
// /api/briefing route (decides whether the re-ask actually spends), so the
// two cannot disagree.
//
// Two thin-brief bugs, same shape:
//  • 2026-09-30: the first POST of the day went out before newsletters and
//    OSINT signals had loaded, the model wrote a short brief, and the day
//    cache locked it in. Fix: one upgrade when either input goes 0 → some.
//  • 2026-10-04: the brief was a single headline ("State ordered departure in
//    effect for Jordan …") and nothing else — all day. The modal's fallback
//    path had posted the moment it opened on a phone, before the news feed
//    had loaded: ZERO ARTICLES. The model built a headline from the force-
//    posture line, every section came back empty, and the empty-brief guard
//    passed because the headline existed. Articles were not part of the
//    upgrade rule, so nothing ever replaced it. Fix: articles count too, a
//    SECTIONLESS brief upgrades whenever more articles exist than it was
//    built from, and the whole thing is capped by a per-day generation count
//    instead of one boolean (a boolean strands a brief whose single upgrade
//    was spent on newsletters while articles were still zero).
//
// Still bounded by construction: a brief with no recorded `inputs` never
// upgrades; only a ZERO → some transition counts for a brief WITH sections
// ("3 newsletters, now 5" is a newer feed, not a missing section); and no
// brief regenerates more than MAX_GENERATIONS times a day.

export interface BriefInputs {
  articles: number;
  newsletters: number;
  osint: number;
  events: number;
}

export interface BriefUpgradeRecord {
  inputs?: BriefInputs;
  /** Legacy single-upgrade flag (pre-generations); read as generations = 2. */
  upgraded?: boolean;
  /** How many times today's brief has been generated, this one included. */
  generations?: number;
  keyDevelopments?: string[];
  topStories?: string[];
  suggestedFocus?: string[];
}

/** Model calls allowed per user per day for the brief, upgrades included. */
export const MAX_GENERATIONS = 3;

/** How many generations a cached brief represents (legacy `upgraded` = 2). */
export function generationsOf(cached: BriefUpgradeRecord | null | undefined): number {
  if (!cached) return 0;
  if (typeof cached.generations === "number" && cached.generations > 0) return cached.generations;
  return cached.upgraded ? 2 : 1;
}

/** A headline with no sections under it — the brief the Glance card renders
 *  as one line. Not worth a day of cache when better inputs exist. */
export function isSectionless(b: BriefUpgradeRecord | null | undefined): boolean {
  if (!b) return true;
  return (b.keyDevelopments?.length ?? 0) === 0
    && (b.topStories?.length ?? 0) === 0
    && (b.suggestedFocus?.length ?? 0) === 0;
}

export function shouldUpgradeBrief(cached: BriefUpgradeRecord | null | undefined, now: BriefInputs): boolean {
  if (!cached || !cached.inputs) return false;
  if (generationsOf(cached) >= MAX_GENERATIONS) return false;
  const was = cached.inputs;
  const gained = (k: keyof BriefInputs) => (was[k] ?? 0) === 0 && (now[k] ?? 0) > 0;
  if (gained("newsletters") || gained("osint") || gained("articles")) return true;
  // A brief that came back with no sections at all is a stopgap, not the
  // day's brief: regenerate as soon as there is more to read than it saw.
  if (isSectionless(cached) && (now.articles ?? 0) > (was.articles ?? 0)) return true;
  return false;
}
