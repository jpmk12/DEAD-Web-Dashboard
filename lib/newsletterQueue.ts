// The newsletter QUEUE — PURE, client-safe, unit-tested.
//
// Fourteen unread rows, oldest five days, was the walkthrough's experience
// (REVIEW-2026-10 N8). A queue shows per-source unread counts and the age
// of the oldest, offers Catch me up (the digest) as the way to clear it,
// and by default lists only the rows that EARNED a place — a watchlist hit
// or a thread match — with the reason on the row. The routine rest folds
// behind "show all". Nothing is hidden from the digest.

import type { NewsletterSummary } from "./types";

export interface QueueReason { kind: "watch" | "thread" | "kept"; text: string }

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
const STOP = new Set(["war", "wave", "watch", "hedge", "rebuild", "shaping", "force", "news", "alert", "update", "daily", "weekly"]);

/** Why a newsletter earned a default row; null when it did not. Kept rows
 *  always earn one — the operator pinned them. */
export function queueReason(
  n: Pick<NewsletterSummary, "id" | "subject" | "bullets">,
  watchlist: string[],
  threads: { label: string }[],
  kept: Set<string>,
): QueueReason | null {
  const text = `${n.subject} ${n.bullets.join(" ")}`.toLowerCase();
  for (const term of watchlist) {
    const t = term.trim().toLowerCase();
    if (t.length >= 3 && text.includes(t)) return { kind: "watch", text: `⚑ ${term.trim()}` };
  }
  for (const th of threads) {
    const ws = words(th.label).filter((w) => !STOP.has(w));
    if (ws.length && ws.every((w) => text.includes(w))) return { kind: "thread", text: `thread · ${th.label}` };
  }
  if (kept.has(n.id)) return { kind: "kept", text: "kept" };
  return null;
}

export interface SourceCount { source: string; count: number }

export function perSource(newsletters: Pick<NewsletterSummary, "source">[]): SourceCount[] {
  const m = new Map<string, number>();
  for (const n of newsletters) m.set(n.source, (m.get(n.source) ?? 0) + 1);
  return [...m.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

/** Age in whole days of the oldest newsletter; null when none parse. */
export function oldestAgeDays(newsletters: Pick<NewsletterSummary, "date">[], nowMs = Date.now()): number | null {
  let oldest: number | null = null;
  for (const n of newsletters) {
    const t = Date.parse(n.date);
    if (Number.isFinite(t) && (oldest === null || t < oldest)) oldest = t;
  }
  return oldest === null ? null : Math.max(0, Math.floor((nowMs - oldest) / 86_400_000));
}
