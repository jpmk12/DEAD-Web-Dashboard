"use client";

// Shared client-side fetch for the Force Protection board, so the three surfaces
// that need it — the Crisis map's Forces layer, the side-panel board, and the
// Glance needs-you-now strip — don't each fire their own request. A short
// clientCache TTL plus in-flight de-duplication means at most one network call
// per ~minute across the whole app; a watch-list edit (force-locations:changed)
// invalidates it so edits show immediately.

import { clientCache } from "./clientCache";
import type { ForceAssessment } from "./forceProtection";

export interface FpResponse {
  assessments?: ForceAssessment[];
  sources?: { gps: boolean; acled: boolean; aviationWx: boolean; notams: "live" | "down" | "off"; conflict: string };
  empty?: boolean;
}

const KEY = "force-protection";
const TTL = 60_000;
let inflight: Promise<FpResponse> | null = null;

export async function getForceProtectionData(force = false): Promise<FpResponse> {
  if (!force) {
    const cached = clientCache.get<FpResponse>(KEY);
    if (cached) return cached;
    if (inflight) return inflight; // join the in-flight request rather than duplicate it
  }
  inflight = (async () => {
    try {
      const res = await fetch("/api/force-protection");
      const out: FpResponse = (res.ok ? await res.json() : null) ?? { assessments: [] };
      clientCache.set(KEY, out, TTL);
      return out;
    } catch {
      return { assessments: [] };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Invalidate when the watched countries/bases change so the next read is fresh.
if (typeof window !== "undefined") {
  window.addEventListener("force-locations:changed", () => clientCache.delete(KEY));
}
