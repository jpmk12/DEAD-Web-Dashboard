// Client helpers for the cross-device UI-state store (/api/ui-state).
// Reads pull the whole blob; writes are debounced and coalesced so rapid
// toggles (map layers, dismissals) collapse into a single round-trip.

import { sharedGet } from "./sharedGet";

export const UI_KEYS = {
  osintDismissed: "osint.dismissed",
  crisisLayers: "crisisMap.layers",
  crisisView: "crisisMap.view",
  crisisAor: "crisisMap.aor",
  crisisBasemap: "crisisMap.basemap",
  newsletterQuietDismissed: "newsletter.quietDismissed",
  mailDatesDismissed: "calendar.mailDatesDismissed",
  // Email action items: keys (lib/emailLearning actionKey) the user ticked, and
  // the ones that went to Tasks / a Doc — remembered across devices (E6).
  emailActionsDone: "email.actionsDone",
  emailActionsAdded: "email.actionsAdded",
} as const;

// Five surfaces read the blob at mount (2026-11-24, the load-time review: it
// was four requests at page load). They share one request through sharedGet,
// and every value this page has written since is laid over what comes back,
// so a shared read can never undo a toggle made a moment before it landed.
let written: Record<string, unknown> = {};

export async function fetchUiState(): Promise<Record<string, unknown>> {
  const { ok, body } = await sharedGet<{ state?: unknown }>("/api/ui-state");
  const st = ok && body?.state && typeof body.state === "object" && !Array.isArray(body.state) ? (body.state as Record<string, unknown>) : {};
  return { ...st, ...written };
}

let pending: Record<string, unknown> = {};
let timer: ReturnType<typeof setTimeout> | null = null;

export function patchUiState(patch: Record<string, unknown>) {
  pending = { ...pending, ...patch };
  written = { ...written, ...patch };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const body = pending;
    pending = {};
    timer = null;
    fetch("/api/ui-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch: body }),
    }).catch(() => {});
  }, 600);
}
