// Client side of the ONE Track command (lib/trackingRegistry.ts is the rule,
// /api/track the door). Every "track this" affordance in the app calls
// `openTrackPicker` with what it knows — an ICAO, a country name, a place —
// and the picker (components/TrackPicker.tsx) resolves, offers the roles,
// posts, and shows Undo. Pure client helpers, no React.

import { toast } from "./feedback";
import { clientCache } from "./clientCache";

export interface TrackPrefill {
  kind?: "airfield" | "country" | "place";
  query?: string;
  icao?: string;
  country?: string;
  label?: string;
  lat?: number;
  lon?: number;
}

/** Open the Track picker (TabShell mounts it) with an optional prefill. */
export function openTrackPicker(prefill: TrackPrefill = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TrackPrefill>("track:open", { detail: prefill }));
}

export interface TrackResponse {
  ok?: boolean;
  error?: string;
  changes?: string[];
  warnings?: string[];
  undo?: Record<string, unknown> | null;
}

/** Tell every surface that reads the tracking lists to reload. */
export function announceTrackingChanged(): void {
  if (typeof window === "undefined") return;
  clientCache.clear();
  window.dispatchEvent(new CustomEvent("tracking:changed"));
  window.dispatchEvent(new CustomEvent("force-locations:changed"));
  window.dispatchEvent(new CustomEvent("dashboard-cache-cleared"));
}

/**
 * POST one track request and report it. Returns the server's body (or a
 * body with `error`). The caller decides whether to show Undo; the toast
 * here names what changed so a one-tap button still reads back.
 */
export async function postTrack(body: Record<string, unknown>, opts: { quiet?: boolean } = {}): Promise<TrackResponse> {
  try {
    const r = await fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "track", ...body }) });
    const d = (await r.json().catch(() => ({}))) as TrackResponse;
    if (!r.ok) {
      if (!opts.quiet) toast.error("Could not change tracking", d.error || `HTTP ${r.status}`);
      return { error: d.error || `HTTP ${r.status}` };
    }
    if (d.changes?.length) announceTrackingChanged();
    if (!opts.quiet) {
      if (d.changes?.length) toast.ok(d.changes.join(" · "), d.warnings?.length ? d.warnings.join(" · ") : undefined);
      else if (d.warnings?.length) toast.warn(d.warnings.join(" · "));
      else toast.info("Nothing to change");
    }
    return d;
  } catch (e) {
    if (!opts.quiet) toast.error("Could not change tracking", e);
    return { error: e instanceof Error ? e.message : "network" };
  }
}
