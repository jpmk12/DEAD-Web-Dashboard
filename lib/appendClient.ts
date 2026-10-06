// Client side of the Append-to command (REVIEW-2026-10 §9 D4). Every door
// — the selection chip, a Thesis, a Save-to-Docs button, the assistant, ⌘K —
// calls `openAppend` with what it knows; the picker (components/AppendPicker)
// chooses the log, shows the entry, posts it. Pure client helpers, no React.

export interface AppendPayload {
  text: string;
  /** Where it came from, in words: "News · Foreign Policy", "OSINT", "assistant", "selection on Email". */
  source: string;
  sourceTitle?: string;
  sourceUrl?: string;
  thread?: string;
  link?: { type: "article" | "email" | "event"; id: string; title?: string };
  /** A log id to preselect (the "Append to China references" shortcut). */
  targetId?: string;
}

export function openAppend(p: AppendPayload): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AppendPayload>("docs:append", { detail: p }));
}

const RECENTS_KEY = "docs.appendRecents";
const LAST_KEY = "docs.appendLast";

/** Most recently appended-to log ids, newest first (per browser). */
export function appendRecents(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 12) : []; } catch { return []; }
}
export function noteAppended(id: string, title: string): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify([id, ...appendRecents().filter((x) => x !== id)].slice(0, 12)));
    localStorage.setItem(LAST_KEY, JSON.stringify({ id, title }));
  } catch { /* storage may be unavailable */ }
}
/** The last log appended to — the one-tap "Append to <title>" shortcut. */
export function lastAppendTarget(): { id: string; title: string } | null {
  try { const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null"); return v && typeof v.id === "string" && typeof v.title === "string" ? v : null; } catch { return null; }
}

/** The effective day for an entry — the device's calendar day (never guessed server-side). */
export const todayYmd = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
