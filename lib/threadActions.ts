// Client-side actions on a thread card (REVIEW-2026-10 N6) — plain fetch
// helpers over routes that already exist. No model call anywhere here.
//
//   saveThreadToDocs — creates or appends a 🧵 thread doc whose Trace the
//     Docs tab renders as a timeline (lib/threadTrajectory.threadDocMarkdown).
//   followThread / unfollowThread — the watchlist (owner-only route), which
//     already pins matching threads ⚑ and feeds Glance and the alerts.
//   askAboutThread — seeds the ONE assistant with the thread.

import type { NewsThread } from "./types";
import { threadDocMarkdown } from "./threadTrajectory";

export const threadDocTitle = (label: string): string => `Thread: ${label}`;

export async function saveThreadToDocs(thread: NewsThread, dateYmd: string): Promise<{ id: string; created: boolean }> {
  const title = threadDocTitle(thread.label);
  const titles = await fetch("/api/documents/titles").then((r) => (r.ok ? r.json() : { docs: [] })) as { docs?: { id: string; title: string }[] };
  const existing = (titles.docs ?? []).find((d) => d.title.toLowerCase() === title.toLowerCase());
  if (existing) {
    const cur = await fetch(`/api/documents/${existing.id}`).then((r) => (r.ok ? r.json() : null)) as { document?: { content?: string }; content?: string } | null;
    const content = cur?.document?.content ?? cur?.content ?? "";
    const next = threadDocMarkdown(thread, dateYmd, content);
    const r = await fetch(`/api/documents/${existing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: next }) });
    if (!r.ok) throw new Error(`Could not update the thread doc (HTTP ${r.status})`);
    return { id: existing.id, created: false };
  }
  const r = await fetch("/api/documents", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, content: threadDocMarkdown(thread, dateYmd), tags: ["thread", thread.label.toLowerCase()], docType: "thread" }),
  });
  if (!r.ok) throw new Error(`Could not create the thread doc (HTTP ${r.status})`);
  const j = await r.json() as { document?: { id: string }; id?: string };
  return { id: j.document?.id ?? j.id ?? "", created: true };
}

/** Title-case the label for the watchlist ("IRAN WAR" → "Iran war"); the
 *  watchlist matches case-insensitively, so this only affects display. */
export const followTerm = (label: string): string => {
  const l = label.trim().toLowerCase();
  return l ? l[0].toUpperCase() + l.slice(1) : l;
};

export const isFollowed = (label: string, watchlist: string[]): boolean =>
  watchlist.some((w) => w.trim().toLowerCase() === label.trim().toLowerCase());

export async function followThread(label: string, follow: boolean): Promise<void> {
  const r = await fetch("/api/osint/watchlist-suggestions", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: follow ? "add" : "remove", term: followTerm(label) }),
  });
  if (!r.ok) throw new Error(r.status === 403 ? "Only the owner can edit the watchlist" : `HTTP ${r.status}`);
}

export function askAboutThread(thread: NewsThread): void {
  const prompt = `Explain the ${thread.label} thread and what it means for my squadron. Headline: ${thread.headline}`;
  window.dispatchEvent(new CustomEvent("assistant:open", { detail: { prompt } }));
}
