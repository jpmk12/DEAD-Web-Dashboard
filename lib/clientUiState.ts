// Client helpers for the cross-device UI-state store (/api/ui-state).
// Reads pull the whole blob; writes are debounced and coalesced so rapid
// toggles (map layers, dismissals) collapse into a single round-trip.

export const UI_KEYS = {
  osintDismissed: "osint.dismissed",
  osintAircraftProvider: "osint.aircraftProvider",
  osintMaritimeProvider: "osint.maritimeProvider",
  osintAircraftSource: "osint.aircraftSource",
  osintMaritimeSource: "osint.maritimeSource",
  crisisLayers: "crisisMap.layers",
  newsletterQuietDismissed: "newsletter.quietDismissed",
} as const;

export async function fetchUiState(): Promise<Record<string, unknown>> {
  try {
    const r = await fetch("/api/ui-state");
    if (!r.ok) return {};
    const d = await r.json();
    return d?.state && typeof d.state === "object" && !Array.isArray(d.state) ? d.state : {};
  } catch {
    return {};
  }
}

let pending: Record<string, unknown> = {};
let timer: ReturnType<typeof setTimeout> | null = null;

export function patchUiState(patch: Record<string, unknown>) {
  pending = { ...pending, ...patch };
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
