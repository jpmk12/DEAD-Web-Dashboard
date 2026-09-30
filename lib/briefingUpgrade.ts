// PURE, client-safe: the one rule that lets a day-cached morning brief be
// regenerated ONCE — when it was built before newsletters or OSINT signals
// had landed and those inputs exist now. Shared by the client prefetch
// (decides whether to re-ask) and the /api/briefing route (decides whether
// the re-ask actually spends), so the two cannot disagree.
//
// Bounded by construction: a brief marked `upgraded` never upgrades again,
// a brief with no recorded `inputs` (pre-dating this) never upgrades, and
// only a ZERO → some transition counts — "3 newsletters, now 5" is not a
// missing section, it is a newer feed, and the day cache exists precisely so
// a moving feed does not re-spend Opus all day.

export interface BriefInputs {
  articles: number;
  newsletters: number;
  osint: number;
  events: number;
}

export interface BriefUpgradeRecord {
  inputs?: BriefInputs;
  upgraded?: boolean;
}

export function shouldUpgradeBrief(cached: BriefUpgradeRecord | null | undefined, now: BriefInputs): boolean {
  if (!cached || cached.upgraded || !cached.inputs) return false;
  const was = cached.inputs;
  const gainedNewsletters = (was.newsletters ?? 0) === 0 && now.newsletters > 0;
  const gainedOsint = (was.osint ?? 0) === 0 && now.osint > 0;
  return gainedNewsletters || gainedOsint;
}
