// Which alerts does THIS device still need to hear about? PURE, unit-tested.
//
// The alert check returns the CURRENT alert-worthy conditions with stable ids
// and no per-client watermark — every consumer keeps its own seen-set. For the
// capture extension that set lives in chrome.storage; for web push it has to
// live server-side per subscription, because a push is sent TO a device that is
// not asking. This module is the arithmetic on that set.
//
// Discipline: a notification is a claim on attention. Never re-notify an id
// that is still in effect; forget an id only once the condition has CLEARED
// (so a red that clears and comes back is, correctly, news again); and keep the
// remembered set small — it is a JSON column, not a log.

import type { AlertItem } from "./alerts";

/** How many cleared ids to remember before dropping the oldest. */
export const SEEN_CAP = 200;

export interface PushSelection {
  /** Alerts this subscription has not been told about. */
  fresh: AlertItem[];
  /** The seen-set to store after this dispatch: everything current, plus what
   *  was seen before, oldest-first and capped. */
  nextSeen: string[];
}

export function selectFresh(alerts: AlertItem[], seen: string[]): PushSelection {
  const seenSet = new Set(seen);
  const fresh = alerts.filter((a) => a.id && !seenSet.has(a.id));
  const currentIds = alerts.map((a) => a.id).filter(Boolean);
  const currentSet = new Set(currentIds);
  // Keep only ids still current: once a condition clears, forgetting it is
  // what lets its return be reported. Then append the new ones.
  const kept = seen.filter((id) => currentSet.has(id));
  const merged = [...kept, ...currentIds.filter((id) => !seenSet.has(id))];
  const nextSeen = merged.length > SEEN_CAP ? merged.slice(merged.length - SEEN_CAP) : merged;
  return { fresh, nextSeen };
}

/** Collapse a batch into one notification body — a phone shows one card per
 *  push, and four pushes for one refresh is noise. Red first. */
export function summarize(fresh: AlertItem[]): { title: string; body: string; tag: string } | null {
  if (fresh.length === 0) return null;
  const ordered = fresh.slice().sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "red" ? -1 : 1));
  const reds = ordered.filter((a) => a.severity === "red").length;
  const head = ordered[0];
  if (ordered.length === 1) {
    return { title: head.title, body: head.sub, tag: head.id };
  }
  const title = reds > 0
    ? `${reds} red alert${reds === 1 ? "" : "s"}${ordered.length > reds ? ` · ${ordered.length - reds} amber` : ""}`
    : `${ordered.length} new alerts`;
  const body = ordered.slice(0, 4).map((a) => a.title).join("\n");
  return { title, body, tag: `batch-${ordered.map((a) => a.id).join("|").slice(0, 120)}` };
}
