// Shared user feedback — one channel for "did that work?".
//
// Client-only, dependency-free. Before this, 23 components carried their own
// error state with 54 different "failed / could not" strings, success was
// usually silent, and the only shared feedback element in the app was the
// session-expired banner. A user could press Track, Done, Dismiss or Log call
// and have no idea whether anything happened unless the row moved.
//
// This is deliberately a window event, not React context: it reaches every
// component (including ones mounted through `dynamic()` and modals) with no
// provider plumbing, the same way `app:navigate`, `docs:search` and
// `osint:set-pane` already work. `ToastHost` listens; anything calls `notify`.

export type FeedbackTone = "ok" | "warn" | "error" | "info";

export interface Feedback {
  tone: FeedbackTone;
  text: string;
  /** Optional second line — the evidence or the fix. */
  detail?: string;
  /** Override auto-dismiss (ms). Errors default longer than successes. */
  ttlMs?: number;
}

export const FEEDBACK_EVENT = "app:toast";

/** Default lifetimes. An error deserves long enough to be read; a success
 *  should get out of the way. */
export const DEFAULT_TTL: Record<FeedbackTone, number> = { ok: 3500, info: 4500, warn: 6000, error: 8000 };

export function notify(f: Feedback): void {
  if (typeof window === "undefined") return;
  const text = (f.text ?? "").trim();
  if (!text) return;
  window.dispatchEvent(new CustomEvent<Feedback>(FEEDBACK_EVENT, { detail: { ...f, text } }));
}

/** Convenience wrappers so call sites read as intent. */
export const toast = {
  ok: (text: string, detail?: string) => notify({ tone: "ok", text, detail }),
  info: (text: string, detail?: string) => notify({ tone: "info", text, detail }),
  warn: (text: string, detail?: string) => notify({ tone: "warn", text, detail }),
  /** Accepts the thrown value directly so the catch block stays one line. */
  error: (text: string, err?: unknown) =>
    notify({ tone: "error", text, detail: err instanceof Error ? err.message : typeof err === "string" ? err : undefined }),
};

/** Hook form, for components that prefer it. Stable identity — no deps. */
export function useFeedback() {
  return toast;
}
