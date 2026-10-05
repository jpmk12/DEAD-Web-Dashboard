// Which watched location the Glance Posture tile should land on — PURE,
// client-safe, tested.
//
// The tile's colour is earned by ONE location; the click should go there.
// Before 2026-10-05 it opened Regional with the default selection (the first
// country in the rail — "Russia", which was not why the tile was red).
// Ranking: a RED that escalated today and is not chronic › any RED that
// escalated today › a non-chronic RED › a RED base › any RED › the worst of
// the rest. A chronic RED is still a RED, but a NEW one is the news.

import type { ForceAssessment } from "./forceProtection";
import { isWorse } from "./severity";

export function postureTarget(list: ForceAssessment[]): ForceAssessment | null {
  if (list.length === 0) return null;
  const escalated = (a: ForceAssessment) => !!a.previousComposite && isWorse(a.composite, a.previousComposite);
  const chronic = (a: ForceAssessment) => a.chronicity?.state === "chronic";
  const reds = list.filter((a) => a.composite === "red");
  return reds.find((a) => escalated(a) && !chronic(a))
    ?? reds.find(escalated)
    ?? reds.find((a) => !chronic(a))
    ?? reds.find((a) => a.kind === "base")
    ?? reds[0]
    ?? list.slice().sort((a, b) => (isWorse(a.composite, b.composite) ? -1 : isWorse(b.composite, a.composite) ? 1 : 0))[0]
    ?? null;
}
